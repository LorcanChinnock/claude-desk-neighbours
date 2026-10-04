import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { checkIn, crumbsIn } from '../hooks/register'

const USAGE = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const ROOT = '/work/payments-service'
const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 160, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

type World = { clock: ReturnType<typeof mock.clock>; store: Map<string, unknown>; box: { text: string }; sent: string[]; asked: number; footerBeneath: string | null }

function world(on: On, claimVerdict = 'yes'): World {
  const w: World = { clock: mock.clock(on), store: new Map(), box: { text: '' }, sent: [], asked: 0, footerBeneath: null }
  on('session.repo', () => ({ value: { root: ROOT, remote: null, internal: false, name: null } }))
  on('session.root', () => ({ value: ROOT }))
  on('store.get', ($, e) => ({ value: w.store.get(e.key) }))
  on('store.set', ($, e) => {
    w.store.set(e.key, e.value)
    return { value: undefined }
  })
  on('model.complete', () => {
    w.asked += 1
    return { value: { isAnswered: true as const, text: claimVerdict, usage: USAGE } }
  })
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: w.footerBeneath ?? e.answer }))
  on('prompt.submit', ($, e) => {
    if (e.origin.kind === 'plugin') {
      expect(e.origin.asUser).toBe(true)
      w.sent.push(e.text)
    }
    return { text: e.text }
  })
  on('prompt.read', () => ({ value: { text: w.box.text, cursor: w.box.text.length } }))
  on('prompt.fill', ($, e) => {
    w.box.text = e.mode === 'append' ? w.box.text + e.text : e.text
    return { isFilled: true }
  })
  on('tool.call', { tool: 'Edit' }, ($, e) => ({
    result: {
      filePath: e.file_path,
      oldString: e.old_string,
      newString: e.new_string,
      originalFile: '',
      structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 2, lines: e.new_string.split('\n').map(l => `+${l}`) }],
      userModified: false,
      replaceAll: false,
    },
  }))
  on('tool.call', { tool: 'Bash' }, ($, e) =>
    e.command.includes('fail')
      ? { isError: true as const, result: 'Exit code 1', text: 'Exit code 1\n1 failing' }
      : { result: { stdout: 'ok', stderr: '', interrupted: false }, text: 'ok' },
  )
  return w
}

const edit = (file: string, text: string) => ({ tool: 'Edit' as const, file_path: `${ROOT}/${file}`, old_string: 'x', new_string: text })
const finish = (answer: string) => ({ answer, durationMs: 1000, isAborted: false, turnId: 't', reason: 'answer' as const })

test('crumbs are found in added lines only, and a moved TODO is not new', async () => {
  const found = crumbsIn('src/api.ts', [
    { newStart: 40, lines: [' const a = 1', '+console.log(a)', '-// TODO: tidy', '+// TODO: tidy', '+// TODO: new one'] },
  ])
  expect(found).toEqual([
    { kind: 'console.log', file: 'src/api.ts', line: 41 },
    { kind: 'TODO', file: 'src/api.ts', line: 43 },
  ])
  expect(crumbsIn('README.md', [{ newStart: 1, lines: ['+console.log(x)'] }])).toEqual([])
  expect(crumbsIn('tests/test_api.py', [{ newStart: 1, lines: ['+print(x)'] }])).toEqual([])
  expect(crumbsIn('app.py', [{ newStart: 1, lines: ['+print(x)'] }])).toHaveLength(1)
})

test('only a real check step is learned, as it would be run again', () => {
  // Plain checks, and what they were piped into or redirected to dropped.
  expect(checkIn('pnpm test')).toBe('pnpm test')
  expect(checkIn('pnpm test 2>&1 | tail -25')).toBe('pnpm test')
  expect(checkIn('pnpm test > out.txt')).toBe('pnpm test')
  expect(checkIn('CI=1 pnpm test -- --test-reporter=dot')).toBe('CI=1 pnpm test -- --test-reporter=dot')
  // The check step out of a chain, with a cd straight before it kept.
  expect(checkIn('git rm -q src/cache.js && grep -rn cache src test; pnpm test')).toBe('pnpm test')
  expect(checkIn('cd web && pnpm test')).toBe('cd web && pnpm test')

  // A heredoc that writes a test file is not a check, whatever its body says; one that then runs it is.
  const writes = "cat >> tests/shrink-ray.test.tsx <<'EOF'\nawait run('pnpm test')\nEOF"
  expect(checkIn(writes)).toBe(null)
  expect(checkIn(`${writes}\npnpm test`)).toBe('pnpm test')

  // Check words that are not run as a check.
  expect(checkIn('echo pnpm test')).toBe(null)
  expect(checkIn('grep -rn "npm test" .')).toBe(null)
  expect(checkIn('cat plugins/receipts/tests/receipts.test.tsx')).toBe(null)

  // Too long to run again whole is skipped, never cut.
  expect(checkIn(`pnpm test ${'--flag '.repeat(40)}`)).toBe(null)
})

test('a claim with nothing run since the edit gets a footer and a band', async ($, on) => {
  const w = world(on)
  await $.turn.start({ text: 'fix auth', turnId: 't1' })
  await $.tool.call(edit('src/auth.ts', 'const ok = true\nconsole.log(ok)'))
  const { text } = await $.turn.complete(finish('Fixed: login works now.'))
  expect(text).toBe('🧾 No receipt: nothing ran since edit to src/auth.ts · 1 crumb (console.log auth.ts:2)')

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'receipts', surface, ...BAND })
    expect(await ui.find({ key: 'receipts-run' })).toBeDefined()
    expect(await ui.find({ key: 'receipts-sweep' })).toBeDefined()
    expect(await ui.find({ key: 'receipts-rule' })).toBeUndefined()
    await ui.unmount()
  }
  const ui = await $.ui.mount({ plugin: 'receipts', surface: 'terminal', ...BAND })
  expect((await ui.find({ key: 'receipts-run' }))?.props.hotkey).toBe('6')
  expect((await ui.find({ key: 'receipts-sweep' }))?.props.hotkey).toBe('7')
  await ui.press({ key: 'receipts-sweep' })
  await w.clock.settle()
  expect(w.sent).toEqual(['Remove these leftovers: console.log in src/auth.ts:2.'])
  expect(w.box.text).toBe('')
  expect(await ui.find({ key: 'receipts-sweep' })).toBeUndefined()
})

test('a verified turn says nothing, and the command is learned', async ($, on) => {
  const w = world(on)
  await $.turn.start({ text: 'fix auth', turnId: 't1' })
  await $.tool.call(edit('src/auth.ts', 'const ok = true'))
  await $.tool.call({ tool: 'Bash', command: 'pnpm test' })
  const { text } = await $.turn.complete(finish('Fixed, tests pass.'))
  expect(text).toBe('Fixed, tests pass.')
  expect(w.asked).toBe(0)

  await w.clock.settle()
  expect(w.store.get(`verify:${ROOT}`)).toBe('pnpm test')
})

test('writing a test file with a heredoc is no receipt, and is never learned', async ($, on) => {
  const w = world(on)
  await $.turn.start({ text: 'add a test', turnId: 't1' })
  await $.tool.call(edit('src/auth.ts', 'const ok = true'))
  await $.tool.call({ tool: 'Bash', command: "cat >> tests/auth.test.ts <<'EOF'\ntest('ok', () => run('pnpm test'))\nEOF" })
  const { text } = await $.turn.complete(finish('Done, tests pass.'))
  expect(text).toBe('🧾 No receipt: nothing ran since edit to src/auth.ts')

  await w.clock.settle()
  expect(w.store.get(`verify:${ROOT}`)).toBe(undefined)
})

test('a check in a chain is learned on its own, not the chain', async ($, on) => {
  const w = world(on)
  await $.turn.start({ text: 'x', turnId: 't1' })
  await $.tool.call({ tool: 'Bash', command: 'git rm -q src/cache.js && pnpm test 2>&1 | tail -25' })
  await w.clock.settle()
  expect(w.store.get(`verify:${ROOT}`)).toBe('pnpm test')
})

test('a failing test run still counts as run; the footer appends to one beneath', async ($, on) => {
  const w = world(on)
  await $.turn.start({ text: 'x', turnId: 't1' })
  await $.tool.call(edit('src/a.ts', 'const a = 1'))
  await $.tool.call({ tool: 'Bash', command: 'pnpm test fail' })
  expect((await $.turn.complete(finish('Done.'))).text).toBe('Done.')

  await $.turn.start({ text: 'y', turnId: 't2' })
  await $.tool.call(edit('src/b.ts', 'debugger'))
  w.footerBeneath = '📎 another mod'
  const { text } = await $.turn.complete(finish('Here is the change; I have not run anything.'))
  expect(text).toBe('📎 another mod\n🧾 1 crumb (debugger b.ts:1)')
})

test('the second missing receipt offers to make it a rule', async ($, on) => {
  const w = world(on)
  w.store.set(`verify:${ROOT}`, 'pnpm test')
  for (const turnId of ['t1', 't2']) {
    await $.turn.start({ text: 'go', turnId })
    await $.tool.call(edit('src/auth.ts', 'const ok = true'))
    await $.turn.complete(finish('Done, it works now.'))
  }
  const ui = await $.ui.mount({ plugin: 'receipts', surface: 'terminal', ...BAND })
  expect((await ui.find({ key: 'receipts-rule' }))?.props.hotkey).toBe('8')
  // A draft is the person's to finish, so the text joins it and nothing is sent.
  w.box.text = 'Also,'
  await ui.press({ key: 'receipts-rule' })
  expect(w.box.text).toBe('Also, From now on, always run `pnpm test` before saying something is done.')
  expect(w.sent).toEqual([])

  await $.prompt.submit({ text: w.box.text, wait: false, origin: { kind: 'composer' } })
  await w.clock.settle()
  expect(await ui.find({ key: 'receipts-rule' })).toBeUndefined()
})

test('the receipts line goes below what the band already holds', async ($, on) => {
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>🎾 Your serve: a line from a mod beneath</Text>
  })
  const w = world(on)
  await $.turn.start({ text: 'go', turnId: 't1' })
  await $.tool.call(edit('src/auth.ts', 'debugger'))
  await $.turn.complete(finish('Here it is.'))
  await w.clock.settle()
  const ui = await $.ui.mount({ plugin: 'receipts', surface: 'terminal', ...BAND })
  const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
  expect(texts).toEqual(['🎾 Your serve: a line from a mod beneath', '🧾 1 crumb (debugger auth.ts:1)'])
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
      plugin: 'receipts',
      surface,
      component: 'PromptHint',
      props: { isDraft: false, isWorking: false, hint: '? for shortcuts' },
    })
    expect((await hint.findAll({ type: 'Button' })).map(b => b.text)).toEqual(['🥇 first', '🧾 watching', '📎 other'])
    await hint.press({ key: 'desk-3-receipts' })
    await hint.unmount()
  }
  expect(opened).toEqual(['receipts', 'receipts'])

  for (const surface of ['terminal', 'desktop'] as const) {
    const pane = await $.ui.mount({
      plugin: 'receipts',
      surface,
      component: 'Pane',
      requestId: 'receipts',
      props: { title: 'x', isFocused: true, bodyColumns: 90, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
    })
    expect(await pane.find({ type: 'Text', text: '🧾 Receipts' })).toBeDefined()
    await pane.unmount()
  }
})

for (const source of ['clear', 'resume'] as const) {
  test(`after /${source} the learned check command loads again`, async ($, on) => {
    const w = world(on)
    w.store.set(`verify:${ROOT}`, 'pnpm test')
    on('classic.SessionStart', () => ({}))
    const checks = async () => {
      const pane = await $.ui.mount({ plugin: 'receipts', surface: 'terminal', component: 'Pane', requestId: 'receipts', props: { title: 'x', isFocused: true, bodyColumns: 90, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} } })
      const text = (await pane.findAll({ type: 'Text' })).map(t => t.text).join(' | ')
      await pane.unmount()
      return text
    }

    // A cleared or resumed session's state starts empty, and no session.start fires to fill it.
    expect(await checks()).toContain('not learned yet')
    await $.classic.SessionStart({ source })
    await w.clock.settle()
    expect(await checks()).toContain('pnpm test')
  })
}
