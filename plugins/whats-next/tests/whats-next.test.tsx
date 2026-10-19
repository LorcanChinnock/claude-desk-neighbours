import { expect, mock, test } from 'claude-code/testing'
import type { ModelForkResult, On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { NOTHING_LEFT, briefingAsk } from '../hooks/register'

const BRIEFING = 'Goal: add the auth tests in src/auth.test.ts. Verify with npm test.'

const HINT = { component: 'PromptHint', props: { isDraft: false, isWorking: false, hint: '? for shortcuts' } } as const
const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const
const PANE = {
  component: 'Pane',
  requestId: 'whats-next',
  props: { title: 'x', isFocused: true, bodyColumns: 90, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

type World = {
  clock: ReturnType<typeof mock.clock>
  session: ReturnType<typeof mock.session>
  reply: ModelForkResult
  percent: number | undefined
  sessionId: string
  forks: string[]
  opened: string[]
  closed: string[]
  cleared: string[]
  submitted: { text: string; asUser?: true }[]
  box: string
  copied: string[]
  toasts: string[]
  logs: string[]
}

function world(on: On): World {
  const w: World = {
    clock: mock.clock(on),
    session: mock.session(on),
    reply: { isAnswered: true, text: `\n${BRIEFING}\n`, usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 1, cache_creation_input_tokens: 0 } },
    percent: undefined,
    sessionId: 'sess-1',
    forks: [],
    opened: [],
    closed: [],
    cleared: [],
    submitted: [],
    box: '',
    copied: [],
    toasts: [],
    logs: [],
  }
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.id', () => ({ value: w.sessionId }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000, percent: w.percent }, rateLimits: [] } }))
  on('model.fork', ($, e) => {
    w.forks.push(e.prompt)
    return { value: w.reply }
  })
  on('ui.open', ($, e) => {
    w.opened.push(e.id)
    return { value: { isPlaced: true as const } }
  })
  on('ui.close', ($, e) => {
    w.closed.push(e.id)
    return { value: undefined }
  })
  on('command.run', { command: 'clear' }, () => {
    w.cleared.push(w.sessionId)
    w.sessionId = 'sess-2'
    return { text: '' }
  })
  on('prompt.submit', ($, e) => {
    w.submitted.push({ text: e.text, asUser: e.origin.kind === 'plugin' ? e.origin.asUser : undefined })
    return { text: e.text }
  })
  on('prompt.fill', ($, e) => {
    w.box = e.text
    return { isFilled: true }
  })
  on('ui.copy', ($, e) => {
    w.copied.push(e.text)
    return { value: { isCopied: true as const } }
  })
  on('ui.toast', ($, e) => {
    w.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.log', ($, e) => {
    w.logs.push(e.text)
    return { value: undefined }
  })
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  return w
}

async function start($: Engine): Promise<void> {
  await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
}

async function turnDone($: Engine): Promise<void> {
  await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' })
}

/** Drafts from the status-row button and returns the review pane. */
async function drafted($: Engine, w: World, surface: 'terminal' | 'desktop' = 'terminal') {
  const hint = await $.ui.mount({ plugin: 'whats-next', surface, ...HINT })
  await hint.press({ key: 'desk-3-whats-next' })
  await hint.unmount()
  expect(w.opened).toEqual(['whats-next'])
  return $.ui.mount({ plugin: 'whats-next', surface, ...PANE })
}

test('the status row button sits in key order', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    return (
      <Box key="desk-hint" flexDirection="row" columnGap={2}>
        <Text>? for shortcuts</Text>
        <Button key="desk-9-other" plain label="📎 other" onPress={() => undefined} />
        <Button key="desk-2-your-serve" plain label="🎾 your serve" onPress={() => undefined} />
        <Button key="desk-0-first" plain label="🥇 first" onPress={() => undefined} />
      </Box>
    )
  })
  for (const surface of ['terminal', 'desktop'] as const) {
    const hint = await $.ui.mount({ plugin: 'whats-next', surface, ...HINT })
    expect((await hint.findAll({ type: 'Button' })).map(b => b.text)).toEqual(['🥇 first', '🎾 your serve', '⏭️ whats next', '📎 other'])
    await hint.unmount()
  }
})

test('the button drafts a briefing from a fork of the session and opens it for review', async ($, on) => {
  const w = world(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    w.opened = []
    const pane = await drafted($, w, surface)
    expect(await pane.find({ type: 'Text', text: BRIEFING })).toBeDefined()
    for (const key of ['act-start', 'act-edit', 'act-copy', 'act-cancel']) expect(await pane.find({ key })).toBeDefined()
    await pane.unmount()
  }
  expect(w.forks).toEqual([briefingAsk(''), briefingAsk('')])
  expect(w.submitted).toEqual([])
})

test('/whats-next drafts once the command is done, steered by its focus', async ($, on) => {
  const w = world(on)
  const { text } = await $.command.run({
    command: 'whats-next',
    args: ' the auth tests ',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 100 },
  })
  expect(text).toBe("⏭️ Writing the briefing for what's next")
  expect(w.forks).toEqual([])
  await w.clock.advance(1)
  await w.clock.settle()
  expect(w.forks).toEqual([briefingAsk('the auth tests')])
  expect(w.forks[0]).toContain('The next task is: the auth tests')
  expect(w.opened).toEqual(['whats-next'])
})

test('Start clears the context, leaves a breadcrumb, then sends the briefing as the first turn', async ($, on) => {
  const w = world(on)
  const pane = await drafted($, w)
  await pane.press({ key: 'act-start' })
  expect(w.closed).toEqual(['whats-next'])
  expect(w.cleared).toEqual(['sess-1'])
  expect(w.submitted).toEqual([{ text: BRIEFING, asUser: true }])
  const notes = w.session.appended().map(row => row.message.content)
  expect(notes).toEqual([[{ type: 'text', text: '⏭️ Continued from session sess-1. /resume it for the full history.' }]])
  expect(await pane.find({ key: 'act-start' })).toBeUndefined()
})

test('Edit clears the context and puts the briefing in the prompt box instead of sending it', async ($, on) => {
  const w = world(on)
  const pane = await drafted($, w)
  await pane.press({ key: 'act-edit' })
  expect(w.cleared).toEqual(['sess-1'])
  expect(w.box).toBe(BRIEFING)
  expect(w.submitted).toEqual([])
})

test('Copy puts the briefing on the clipboard and keeps the pane', async ($, on) => {
  const w = world(on)
  const pane = await drafted($, w)
  await pane.press({ key: 'act-copy' })
  expect(w.copied).toEqual([BRIEFING])
  expect(w.toasts).toEqual(['⏭️ Briefing copied'])
  expect(w.closed).toEqual([])
  expect(w.cleared).toEqual([])
})

test('Cancel closes the pane and drops the briefing, leaving the session as it was', async ($, on) => {
  const w = world(on)
  const pane = await drafted($, w)
  await pane.press({ key: 'act-cancel' })
  expect(w.closed).toEqual(['whats-next'])
  expect(w.cleared).toEqual([])
  expect(w.submitted).toEqual([])
  expect(await pane.find({ type: 'Text', text: /No briefing yet/ })).toBeDefined()
})

test('it says so in one line when nothing is left, and when there is nothing to brief from', async ($, on) => {
  const w = world(on)
  w.reply = { isAnswered: true, text: ` ${NOTHING_LEFT}\n`, usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } }
  const hint = await $.ui.mount({ plugin: 'whats-next', surface: 'terminal', ...HINT })
  await hint.press({ key: 'desk-3-whats-next' })
  expect(w.logs).toEqual(['⏭️ Nothing left to do'])
  w.reply = { isAnswered: false, reason: 'nothing-to-fork' }
  await hint.press({ key: 'desk-3-whats-next' })
  expect(w.toasts).toEqual(['⏭️ No briefing: nothing to brief from yet'])
  expect(w.opened).toEqual([])
})

test('the band nudges once a session when the context passes the threshold', async ($, on) => {
  const w = world(on)
  await start($)
  w.percent = 69
  await turnDone($)
  const band = await $.ui.mount({ plugin: 'whats-next', surface: 'terminal', ...BAND })
  expect(await band.find({ key: 'nudge-start' })).toBeUndefined()

  w.percent = 72
  await turnDone($)
  expect(await band.find({ type: 'Text', text: 'Context is 72% full.' })).toBeDefined()
  await band.press({ key: 'nudge-dismiss' })
  expect(await band.find({ key: 'nudge-start' })).toBeUndefined()

  w.percent = 90
  await turnDone($)
  expect(await band.find({ key: 'nudge-start' })).toBeUndefined()

  // A new session (after /clear) gets its own nudge, and the button drafts.
  w.sessionId = 'sess-2'
  await turnDone($)
  await band.press({ key: 'nudge-start' })
  expect(w.forks).toEqual([briefingAsk('')])
  expect(await band.find({ key: 'nudge-start' })).toBeUndefined()
})

test('the nudge threshold comes from settings, and 0 turns it off', { options: { nudgePercent: 0 } }, async ($, on) => {
  const w = world(on)
  await start($)
  w.percent = 99
  await turnDone($)
  const band = await $.ui.mount({ plugin: 'whats-next', surface: 'terminal', ...BAND })
  expect(await band.find({ key: 'nudge-start' })).toBeUndefined()
})

test('a subagent finishing does not nudge', { options: { nudgePercent: 50 } }, async ($, on) => {
  const w = world(on)
  await start($)
  w.percent = 60
  await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer', agentId: 'a1' })
  const band = await $.ui.mount({ plugin: 'whats-next', surface: 'terminal', ...BAND })
  expect(await band.find({ key: 'nudge-start' })).toBeUndefined()
  await turnDone($)
  expect(await band.find({ type: 'Text', text: 'Context is 60% full.' })).toBeDefined()
})

test('the ask forbids pointing back at the old conversation', () => {
  const ask = briefingAsk('')
  expect(ask).toContain('[Image #N]')
  expect(ask).toContain(NOTHING_LEFT)
  expect(ask).toContain('How to verify')
})
