import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine, EngineCall } from 'claude-code/testing'

import { lastDayBefore, localDay, recapLines } from '../hooks/register'

const USAGE = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const ROOT = '/work/payments-service'
const MORNING = new Date(2026, 9, 3, 9, 0).getTime()
const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const
const RECAP = 'Done: retry logic for webhook sends, tests green\nPending: idempotency key on refunds\nWaiting on you: keep or drop the old cache?'

// The kit's Engine type leaves out prompt.edit, which its runtime serves as it does every event.
const promptEdit = ($: Engine) => ($ as Engine & { prompt: { edit: EngineCall<'prompt.edit'> } }).prompt.edit
const keystroke = { origin: { kind: 'composer' as const }, text: '', cursor: 0, start: 0, end: 0, inputText: 'h' }
const finish = { answer: 'ok', durationMs: 1000, isAborted: false, turnId: 't', reason: 'answer' as const }

type World = { clock: ReturnType<typeof mock.clock>; forks: number }

function world(on: On, store: Record<string, unknown> = {}): World {
  const w: World = { clock: mock.clock(on, { now: MORNING }), forks: 0 }
  mock.store(on, store)
  on('session.repo', () => ({ value: { root: ROOT, remote: null, internal: false, name: null } }))
  on('session.root', () => ({ value: ROOT }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.messages', () => ({ value: [] }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('model.fork', () => {
    w.forks += 1
    return { value: { isAnswered: true as const, text: RECAP, usage: USAGE } }
  })
  on('model.complete', () => ({ value: { isAnswered: true as const, text: 'webhook retries', usage: USAGE } }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('prompt.edit', ($, e) => ({ text: e.inputText, cursor: e.inputText.length }))
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  return w
}

test('recap lines come back in order, waiting first, empties dropped', async () => {
  expect(recapLines(RECAP)).toEqual([
    'Waiting on you: keep or drop the old cache?',
    'Done: retry logic for webhook sends, tests green',
    'Pending: idempotency key on refunds',
  ])
  expect(recapLines('Done: shipped it\nPending: none')).toEqual(['Done: shipped it'])
  const days = [
    { day: '2026-09-30', sessionId: 'a', repo: 'web-app', topic: 'old' },
    { day: '2026-10-02', sessionId: 'b', repo: 'web-app', topic: 'login copy fixes' },
    { day: '2026-10-03', sessionId: 'c', repo: 'web-app', topic: 'today' },
  ]
  expect(lastDayBefore(days, '2026-10-03')?.entries.map(e => e.sessionId)).toEqual(['b'])
})

test('the first keystroke after twenty idle minutes shows the recap, made once', async ($, on) => {
  const w = world(on)
  await promptEdit($)(keystroke)
  await w.clock.settle()
  expect(w.forks).toBe(0)

  await $.turn.complete(finish)
  await w.clock.advance(21 * 60_000)
  await promptEdit($)(keystroke)
  await w.clock.settle()

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'previously-on', surface, ...BAND })
    const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text.trim())
    expect(texts).toEqual([
      '📺 Previously on payments-service…',
      'Waiting on you: keep or drop the old cache?',
      'Done: retry logic for webhook sends, tests green',
      'Pending: idempotency key on refunds',
    ])
    await ui.unmount()
  }

  const ui = await $.ui.mount({ plugin: 'previously-on', surface: 'terminal', ...BAND })
  expect((await ui.find({ key: 'previously-dismiss' }))?.props.hotkey).toBe('0')
  await ui.press({ key: 'previously-dismiss' })
  expect(await ui.find({ type: 'Text' })).toBeUndefined()

  await w.clock.advance(30 * 60_000)
  await promptEdit($)(keystroke)
  await w.clock.settle()
  expect(w.forks).toBe(1)
  expect(await ui.find({ type: 'Text', text: /Previously on/ })).toBeDefined()
})

test('the first session of the day shows yesterday once; /standup lists both days', async ($, on) => {
  const today = localDay(MORNING)
  const yesterday = localDay(MORNING - 86_400_000)
  const w = world(on, {
    days: [
      { day: yesterday, sessionId: 'a', repo: 'payments-service', topic: 'webhook retries' },
      { day: yesterday, sessionId: 'b', repo: 'web-app', topic: 'login copy fixes' },
      { day: today, sessionId: 'c', repo: 'payments-service', topic: 'idempotency keys' },
    ],
  })
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await w.clock.settle()
  const ui = await $.ui.mount({ plugin: 'previously-on', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: '📺 Yesterday: payments-service (webhook retries) · web-app (login copy fixes)' })).toBeDefined()

  await $.prompt.submit({ text: 'hi', wait: false, origin: { kind: 'composer' } })
  await w.clock.settle()
  expect(await ui.find({ type: 'Text' })).toBeUndefined()
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await w.clock.settle()
  expect(await ui.find({ type: 'Text' })).toBeUndefined()

  const { text } = await $.command.run({ command: 'standup', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
  expect(text).toBe('**Yesterday**\n- payments-service: webhook retries\n- web-app: login copy fixes\n\n**Today**\n- payments-service: idempotency keys')
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
      plugin: 'previously-on',
      surface,
      component: 'PromptHint',
      props: { isDraft: false, isWorking: false, hint: '? for shortcuts' },
    })
    expect((await hint.findAll({ type: 'Button' })).map(b => b.text)).toEqual(['🥇 first', '📺 on air', '📎 other'])
    await hint.press({ key: 'desk-5-previously-on' })
    await hint.unmount()
  }
  expect(opened).toEqual(['previously-on', 'previously-on'])

  for (const surface of ['terminal', 'desktop'] as const) {
    const pane = await $.ui.mount({
      plugin: 'previously-on',
      surface,
      component: 'Pane',
      requestId: 'previously-on',
      props: { title: 'x', isFocused: true, bodyColumns: 90, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
    })
    expect(await pane.find({ type: 'Text', text: '📺 Previously On' })).toBeDefined()
    await pane.unmount()
  }
})
