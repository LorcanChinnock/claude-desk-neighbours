import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine, EngineCall } from 'claude-code/testing'

import { shrink } from '../hooks/register'

const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const
const HINT = { component: 'PromptHint', props: { isDraft: false, isWorking: false, hint: '? for shortcuts' } } as const

const TRACE = [
  'TypeError: Cannot read properties of undefined (reading "id")',
  '    at handler (/work/app/src/auth.ts:41:7)',
  ...Array.from({ length: 30 }, (_, i) => `    at Layer.handle (/work/app/node_modules/express/lib/router/layer.js:${i}:5)`),
  '    at main (/work/app/src/server.ts:9:3)',
]
const NOISY_LOG = [
  ...Array.from({ length: 600 }, () => '2026-10-03T09:12:44.120Z WARN retrying webhook send'),
  ...TRACE,
  ...Array.from({ length: 600 }, (_, i) => `2026-10-03T09:12:45.${i}Z INFO tick ${i}`),
].join('\n')

// The kit's Engine type leaves out prompt.edit, which its runtime serves as it does every event.
const promptEdit = ($: Engine) => ($ as Engine & { prompt: { edit: EngineCall<'prompt.edit'> } }).prompt.edit

type World = { clock: ReturnType<typeof mock.clock>; files: Map<string, string>; box: { text: string } }

function world(on: On): World {
  const w: World = { clock: mock.clock(on, { now: 1_000 }), files: new Map(), box: { text: '' } }
  mock.store(on)
  mock.env(on, { HOME: '/home/me' })
  on('session.id', () => ({ value: 'sess-1' }))
  on('fs.write', ($, e) => {
    w.files.set(e.path, e.text)
    return { value: undefined }
  })
  on('ui.render', ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const tail = e.component === 'PromptHint' ? e.props.tail : undefined
    return <Box>{tail !== undefined && <Text>{tail}</Text>}</Box>
  })
  on('prompt.edit', ($, e) => {
    const text = e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end)
    w.box.text = text
    return { text, cursor: e.start + e.inputText.length }
  })
  on('prompt.read', () => ({ value: { text: w.box.text, cursor: w.box.text.length } }))
  on('prompt.fill', ($, e) => {
    w.box.text = e.mode === 'append' ? w.box.text + e.text : e.text
    return { isFilled: true }
  })
  return w
}

test('shrinking collapses repeats, strips timestamps and folds framework frames', async () => {
  const out = shrink(NOISY_LOG, { head: 12, tail: 12, errors: 15 }, false) ?? ''
  expect(out).toContain('WARN retrying webhook send ×600')
  expect(out).not.toContain('2026-10-03T')
  expect(out).toContain('    at handler (/work/app/src/auth.ts:41:7)')
  expect(out).toContain('    at main (/work/app/src/server.ts:9:3)')
  expect(out).toContain('framework frames')
  expect(out.split('\n').length).toBeLessThan(45)

  const json = JSON.stringify({ users: Array.from({ length: 500 }, (_, i) => ({ id: i, name: `user ${i}` })) }, null, 2)
  expect(shrink(json, { head: 12, tail: 12, errors: 15 }, false)).toContain('JSON shape: { users: [500 × { id: number, name: string }] }')
})

test('test output keeps failures and the summary, drops the passes', async () => {
  const run = [
    ' RUN  v2.1.0 /work/app',
    ...Array.from({ length: 200 }, (_, i) => ` ✓ src/thing${i}.test.ts (3 tests) 12ms`),
    ' ✗ src/auth.test.ts > rejects expired tokens',
    '   AssertionError: expected 401 to be 403',
    ' Tests  1 failed | 600 passed (601)',
  ].join('\n')
  const out = shrink(run, { head: 20, tail: 20, errors: 30 }, true) ?? ''
  expect(out).not.toContain('thing7.test.ts')
  expect(out).toContain('AssertionError: expected 401 to be 403')
  expect(out).toContain('Tests  1 failed | 600 passed (601)')
})

test('a big paste lands shrunk, its original saved, and Undo restores it exactly', async ($, on) => {
  const w = world(on)
  const r = await promptEdit($)({ origin: { kind: 'composer' }, text: 'see: ', cursor: 5, start: 5, end: 5, inputText: NOISY_LOG })
  expect(r.text).toContain('[shrink-ray: 1,233 → ')
  expect(r.text).toContain('full paste: /home/me/.claude/shrink-ray/sess-1/paste-1000.txt]')
  expect(w.files.get('/home/me/.claude/shrink-ray/sess-1/paste-1000.txt')).toBe(NOISY_LOG)

  const ui = await $.ui.mount({ plugin: 'shrink-ray', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: /🔫 Shrunk 1,233 → \d+ lines/ })).toBeDefined()
  await ui.press({ key: 'shrink-undo' })
  expect(w.box.text).toBe(`see: ${NOISY_LOG}`)
})

test('undo expires after ten seconds; small pastes and typing pass untouched', async ($, on) => {
  const w = world(on)
  const small = await promptEdit($)({ origin: { kind: 'composer' }, text: '', cursor: 0, start: 0, end: 0, inputText: 'a\nb\nc' })
  expect(small.text).toBe('a\nb\nc')

  await promptEdit($)({ origin: { kind: 'composer' }, text: '', cursor: 0, start: 0, end: 0, inputText: NOISY_LOG })
  const ui = await $.ui.mount({ plugin: 'shrink-ray', surface: 'terminal', ...BAND })
  expect(await ui.find({ key: 'shrink-undo' })).toBeDefined()
  await w.clock.advance(10_001)
  expect(await ui.find({ key: 'shrink-undo' })).toBeUndefined()

  const hint = await $.ui.mount({ plugin: 'shrink-ray', surface: 'terminal', ...HINT })
  expect(await hint.find({ type: 'Button', text: /^🔫 [\d.]+k? deflected$/ })).toBeDefined()
})

// The kit cannot raise session.append through a plugin (its bottom throws, and a test
// hook that answers without next is skipped by that event's rule), so the output path's
// transform is checked directly: what the model would read of a failing command.
test('long command output keeps the exit code line and every error line', async () => {
  const output = [
    'Exit code 1',
    ...Array.from({ length: 300 }, (_, i) => `\x1b[32mcompiling\x1b[0m module ${i}`),
    'error[E0308]: mismatched types',
    ...Array.from({ length: 300 }, (_, i) => `  [${'='.repeat(20)}>    ] ${i % 100}%`),
    'error: could not compile `app` due to 1 previous error',
  ].join('\n')
  const out = shrink(output, { head: 20, tail: 20, errors: 30 }, true) ?? ''
  expect(out.split('\n')[0]).toBe('Exit code 1')
  expect(out).toContain('error[E0308]: mismatched types')
  expect(out).toContain('error: could not compile `app` due to 1 previous error')
  expect(out).not.toContain('\x1b[')
  expect(out).not.toContain('%')
  expect(out.split('\n').length).toBeLessThan(60)
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
      plugin: 'shrink-ray',
      surface,
      component: 'PromptHint',
      props: { isDraft: false, isWorking: false, hint: '? for shortcuts' },
    })
    expect((await hint.findAll({ type: 'Button' })).map(b => b.text)).toEqual(['🥇 first', '🔫 armed', '📎 other'])
    await hint.press({ key: 'desk-4-shrink-ray' })
    await hint.unmount()
  }
  expect(opened).toEqual(['shrink-ray', 'shrink-ray'])

  for (const surface of ['terminal', 'desktop'] as const) {
    const pane = await $.ui.mount({
      plugin: 'shrink-ray',
      surface,
      component: 'Pane',
      requestId: 'shrink-ray',
      props: { title: 'x', isFocused: true, bodyColumns: 90, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
    })
    expect(await pane.find({ type: 'Text', text: '🔫 Shrink Ray' })).toBeDefined()
    await pane.unmount()
  }
})
