import { expect, mock, test } from 'claude-code/testing'
import type { ModelForkResult, On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { NOTHING_LEFT, RESEARCH, briefingAsk, researchAsk } from '../hooks/register'

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
  forkReply: ModelForkResult | null
  isModelDown: boolean
  forks: string[]
  completes: { model: string; prompt: string }[]
  ran: string[]
  opened: string[]
  narrow: boolean
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
    forkReply: null,
    isModelDown: false,
    forks: [],
    completes: [],
    ran: [],
    opened: [],
    narrow: false,
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
    return { value: w.forkReply ?? w.reply }
  })
  on('session.model', () => {
    if (w.isModelDown) throw new Error('model unavailable')
    return { value: 'claude-opus-5-5' }
  })
  on('process.run', ($, e) => {
    const command = e.argv.join(' ')
    w.ran.push(command)
    if (command.startsWith('gh issue list --assignee')) return { value: { exitCode: 1, stdout: '', stderr: 'gh: not logged in\nrun gh auth login', isStdoutTruncated: false, isStderrTruncated: false } }
    return { value: { exitCode: 0, stdout: `out of ${command}\n`, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('model.complete', ($, e) => {
    w.completes.push({ model: e.model, prompt: e.prompt })
    return { value: w.reply }
  })
  on('ui.open', ($, e) => {
    w.opened.push(e.id)
    return { value: w.narrow ? { isPlaced: false as const, reason: 'unasked panes seat from 144 columns; 80 now' } : { isPlaced: true as const } }
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

test('it says so in one line when nothing is left', async ($, on) => {
  const w = world(on)
  w.reply = { isAnswered: true, text: ` ${NOTHING_LEFT}\n`, usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } }
  const hint = await $.ui.mount({ plugin: 'whats-next', surface: 'terminal', ...HINT })
  await hint.press({ key: 'desk-3-whats-next' })
  expect(w.logs).toEqual(['⏭️ Nothing left to do'])
  expect(w.opened).toEqual([])
})

test('a blank session works out the next task from the repo and GitHub instead', async ($, on) => {
  const w = world(on)
  w.forkReply = { isAnswered: false, reason: 'nothing-to-fork' }
  const { text } = await $.command.run({
    command: 'whats-next',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 100 },
  })
  expect(text).toBe("⏭️ Writing the briefing for what's next")
  await w.clock.advance(1)
  await w.clock.settle()
  expect(w.ran).toEqual(RESEARCH.map(r => r.argv.join(' ')))
  expect(w.toasts).toEqual(['⏭️ Looking at the repo and GitHub for the next task'])
  expect(w.completes).toHaveLength(1)
  const { model, prompt } = w.completes[0]!
  expect(model).toBe('claude-opus-5-5')
  expect(prompt).toContain('## pull requests\nout of gh pr status')
  expect(prompt).toContain('## issues assigned to me\n(failed: gh: not logged in)')
  expect(prompt).toBe(researchAsk('', prompt.slice(prompt.indexOf('<findings>\n') + 11, prompt.lastIndexOf('\n</findings>'))))
  expect(w.opened).toEqual(['whats-next'])
  const pane = await $.ui.mount({ plugin: 'whats-next', surface: 'terminal', ...PANE })
  expect(await pane.find({ type: 'Text', text: BRIEFING })).toBeDefined()
})

test('a pane too narrow to draw unasked waits behind a band that opens it', async ($, on) => {
  const w = world(on)
  w.narrow = true
  const band = await $.ui.mount({ plugin: 'whats-next', surface: 'terminal', ...BAND })
  const hint = await $.ui.mount({ plugin: 'whats-next', surface: 'terminal', ...HINT })
  await hint.press({ key: 'desk-3-whats-next' })
  expect(await band.find({ type: 'Text', text: '⏭️ The briefing is ready.' })).toBeDefined()

  w.narrow = false
  await band.press({ key: 'ready-open' })
  expect(w.opened).toEqual(['whats-next', 'whats-next'])
  expect(await band.find({ key: 'ready-open' })).toBeUndefined()
})

test('Discard on the band drops the waiting briefing', async ($, on) => {
  const w = world(on)
  w.narrow = true
  const band = await $.ui.mount({ plugin: 'whats-next', surface: 'terminal', ...BAND })
  const hint = await $.ui.mount({ plugin: 'whats-next', surface: 'terminal', ...HINT })
  await hint.press({ key: 'desk-3-whats-next' })
  await band.press({ key: 'ready-discard' })
  expect(w.closed).toEqual(['whats-next'])
  expect(await band.find({ key: 'ready-open' })).toBeUndefined()
  const pane = await $.ui.mount({ plugin: 'whats-next', surface: 'terminal', ...PANE })
  expect(await pane.find({ type: 'Text', text: /No briefing yet/ })).toBeDefined()
})

test('a briefing that throws says so instead of going quiet', async ($, on) => {
  const w = world(on)
  w.isModelDown = true
  w.forkReply = { isAnswered: false, reason: 'nothing-to-fork' }
  const hint = await $.ui.mount({ plugin: 'whats-next', surface: 'terminal', ...HINT })
  await hint.press({ key: 'desk-3-whats-next' })
  expect(w.toasts.at(-1)).toBe('⏭️ Could not write the briefing')
})

test('a failed briefing says why in one line', async ($, on) => {
  const w = world(on)
  w.reply = { isAnswered: false, reason: 'empty-reply' }
  const hint = await $.ui.mount({ plugin: 'whats-next', surface: 'terminal', ...HINT })
  await hint.press({ key: 'desk-3-whats-next' })
  expect(w.toasts).toEqual(['⏭️ No briefing: empty-reply'])
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

test('the research ask fences the findings as data and keeps the focus', () => {
  const ask = researchAsk('the auth tests', '## open issues\n#7 auth')
  expect(ask).toContain('The next task is: the auth tests')
  expect(ask).toContain('<findings>\n## open issues\n#7 auth\n</findings>')
  expect(ask).toContain(NOTHING_LEFT)
  expect(ask).toContain('How to verify')
})
