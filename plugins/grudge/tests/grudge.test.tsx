import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { applySwap, extractSwap } from '../hooks/register'

const USAGE = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const ROOT = '/work/payments-service'
const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

/** The world beneath the plugin: a repo, and a store the test can read back. */
function world(on: On, entries: Record<string, unknown> = {}): Map<string, unknown> {
  const store = new Map(Object.entries(entries))
  on('session.repo', () => ({ value: { root: ROOT, remote: null, internal: false, name: null } }))
  on('session.root', () => ({ value: ROOT }))
  on('store.get', ($, e) => ({ value: store.get(e.key) }))
  on('store.set', ($, e) => {
    store.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  return store
}

/** The engine's own drawing beneath the plugins: nothing, as the band has. */
function nothingBeneath(on: On): void {
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
}

const COMPOSE = { model: 'm', promptModel: 'm', surfaces: [], tools: [], outputStyle: null, traits: [] } as const

test('swaps are read from the wording, whole words only', async () => {
  expect(extractSwap('use pnpm, not npm')).toEqual({ from: 'npm', to: 'pnpm' })
  expect(extractSwap("don't use npm, use pnpm")).toEqual({ from: 'npm', to: 'pnpm' })
  expect(extractSwap('use the logger, not console')).toBe(null)
  expect(extractSwap('use pip, not npm')).toBe(null)

  const swap = { from: 'npm', to: 'pnpm' }
  expect(applySwap('npm install', swap)).toBe('pnpm install')
  expect(applySwap('cd web && npm run build', swap)).toBe('cd web && pnpm run build')
  expect(applySwap('cat .npmrc', swap)).toBe('cat .npmrc')
  expect(applySwap('npm ci', swap)).toBe('npm ci')
  expect(applySwap('echo npm install', swap)).toBe('echo npm install')
})

test('a held swap fixes the command before it runs and counts the hit', async ($, on) => {
  const clock = mock.clock(on)
  const store = world(on, {
    grudges: [{ id: 4, rule: 'use pnpm, not npm', scope: 'repo', repo: ROOT, heldAt: 0, hits: 30, swap: { from: 'npm', to: 'pnpm' } }],
  })
  const ran: string[] = []
  on('tool.call', { tool: 'Bash' }, ($, e) => {
    ran.push(e.command)
    return { result: { stdout: '', stderr: '', interrupted: false } }
  })

  await $.tool.call({ tool: 'Bash', command: 'npm install && npm test' })
  expect(ran).toEqual(['pnpm install && pnpm test'])
  await $.tool.call({ tool: 'Bash', command: 'cat .npmrc' })
  expect(ran[1]).toBe('cat .npmrc')

  await clock.settle()
  expect((store.get('grudges') as { hits: number }[])[0]?.hits).toBe(31)
})

test('held rules ride the system prompt', async ($, on) => {
  world(on, {
    grudges: [
      { id: 1, rule: 'British spelling in comments', scope: 'global', repo: null, heldAt: 0, hits: 0, swap: null },
      { id: 2, rule: 'other repo rule', scope: 'repo', repo: '/elsewhere', heldAt: 0, hits: 0, swap: null },
    ],
  })
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'hi', scope: 'shared' as const }] }))
  const { sections } = await $.prompt.compose(COMPOSE)
  const mine = sections.find(s => s.id === 'grudge:rules')
  expect(mine?.text).toContain('- British spelling in comments')
  expect(mine?.text).not.toContain('other repo rule')
})

test('a lasting correction is offered, and Hold keeps it', async ($, on) => {
  const clock = mock.clock(on)
  const store = world(on)
  nothingBeneath(on)
  on('model.complete', () => ({
    value: { isAnswered: true as const, text: '{"lasting": true, "rule": "use pnpm, not npm", "scope": "repo"}', usage: USAGE },
  }))
  on('prompt.submit', ($, e) => ({ text: e.text }))

  await $.prompt.submit({ text: 'no, use pnpm not npm', wait: false, origin: { kind: 'composer' } })
  await clock.settle()

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'grudge', surface, ...BAND })
    expect(await ui.find({ type: 'Text', text: /Hold a grudge\? "use pnpm, not npm"/ })).toBeDefined()
    await ui.unmount()
  }

  const ui = await $.ui.mount({ plugin: 'grudge', surface: 'terminal', ...BAND })
  expect((await ui.find({ key: 'grudge-hold' }))?.props.hotkey).toBe('4')
  expect((await ui.find({ key: 'grudge-nah' }))?.props.hotkey).toBe('5')
  await ui.press({ key: 'grudge-hold' })
  const stored = store.get('grudges') as { rule: string; scope: string; repo: string; swap: unknown }[]
  expect(stored).toHaveLength(1)
  expect(stored[0]).toMatchObject({ rule: 'use pnpm, not npm', scope: 'repo', repo: ROOT, swap: { from: 'npm', to: 'pnpm' } })
  expect(await ui.find({ type: 'Text', text: /Hold a grudge/ })).toBeUndefined()
})

test('a one-off fix costs nothing', async ($, on) => {
  world(on)
  let asked = 0
  on('model.complete', () => {
    asked += 1
    return { value: { isAnswered: true as const, text: '{}', usage: USAGE } }
  })
  on('prompt.submit', ($, e) => ({ text: e.text }))
  await $.prompt.submit({ text: 'look at the auth module please', wait: false, origin: { kind: 'composer' } })
  expect(asked).toBe(0)
})

test('its hint item joins the shared row in key order, and a click opens its pane', async ($, on) => {
  const opened: string[] = []
  on('ui.render', { component: 'PromptHint' }, ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    return (
      <Box key="desk-hint" flexDirection="row" columnGap={2}>
        <Text>? for shortcuts</Text>
        <Button key="desk-9-other" plain label="📎 other" onPress={() => undefined} />
        <Button key="desk-0-first" plain label="🥇 first" onPress={() => undefined} />
      </Box>
    )
  })
  on('ui.panes', () => ({ value: [] }))
  on('ui.open', ($, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true as const } }
  })
  world(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const hint = await $.ui.mount({
      plugin: 'grudge',
      surface,
      component: 'PromptHint',
      props: { isDraft: false, isWorking: false, hint: '? for shortcuts' },
    })
    expect((await hint.findAll({ type: 'Button' })).map(b => b.text)).toEqual(['🥇 first', '😤 no grudges', '📎 other'])
    await hint.press({ key: 'desk-1-grudge' })
    await hint.unmount()
  }
  expect(opened).toEqual(['grudges', 'grudges'])

  for (const surface of ['terminal', 'desktop'] as const) {
    const pane = await $.ui.mount({
      plugin: 'grudge',
      surface,
      component: 'Pane',
      requestId: 'grudges',
      props: { title: 'x', isFocused: true, bodyColumns: 90, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
    })
    expect(await pane.find({ type: 'Text', text: '😤 Grudges' })).toBeDefined()
    await pane.unmount()
  }
})

test('after /clear the rules list loads again', async ($, on) => {
  const clock = mock.clock(on)
  world(on, { grudges: [{ id: 1, rule: 'use pnpm, not npm', scope: 'repo', repo: ROOT, heldAt: 0, hits: 0, swap: null }] })
  nothingBeneath(on)
  on('classic.SessionStart', () => ({}))
  const label = async () => {
    const hint = await $.ui.mount({ plugin: 'grudge', surface: 'terminal', component: 'PromptHint', props: { isDraft: false, isWorking: false, hint: '' } })
    const text = (await hint.find({ key: 'desk-1-grudge' }))?.text
    await hint.unmount()
    return text
  }

  // A cleared session's state starts empty, and no session.start fires to fill it.
  expect(await label()).toBe('😤 no grudges')
  await $.classic.SessionStart({ source: 'clear' })
  await clock.settle()
  expect(await label()).toBe('😤 1 grudge')
})
