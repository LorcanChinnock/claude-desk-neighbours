import { atom, read } from 'claude-code'
import type { EngineInterface, Register, RenderElement, RenderNode } from 'claude-code'

const COMMAND = 'whats-next'
const LABEL = '⏭️ whats next'
const PANE = 'whats-next'
const TITLE = "⏭️ What's Next"

const DRAFT = { plugin: 'whats-next', key: 'draft' } as const
const NUDGE = { plugin: 'whats-next', key: 'nudge' } as const
const NUDGED_IN = { plugin: 'whats-next', key: 'nudgedIn' } as const
const IS_DRAFTING = { plugin: 'whats-next', key: 'isDrafting' } as const

const draft = atom(DRAFT, null)
const nudge = atom(NUDGE, null)
const nudgedIn = atom(NUDGED_IN, null)
const isDrafting = atom(IS_DRAFTING, false)

export const NOTHING_LEFT = 'NOTHING_LEFT'

// Asked of a fork of the session, so it sees the whole conversation from the main thread's prompt cache.
export function briefingAsk(focus: string): string {
  return [
    'I am about to clear this conversation and start the next task in a fresh session that will see none of it.',
    focus === ''
      ? 'Work out the next task from this conversation: the next thing still to do, not something already done.'
      : `The next task is: ${focus}`,
    `If nothing is left to do, reply with exactly ${NOTHING_LEFT} and nothing else.`,
    "Otherwise reply with only the new session's first message to Claude, with no preamble. It must stand on its own:",
    '- Goal: the task and why it matters.',
    '- Current state: what is done, the branch or worktree, and the working directory.',
    '- Files: the paths that matter.',
    '- Decisions and constraints agreed, with the reasons.',
    '- What was tried and failed, and gotchas found.',
    '- How to verify it, and what done looks like.',
    '- Later: the tasks after this one, as a short list.',
    'Never refer to "above", "earlier", "as discussed" or [Image #N]: state the facts, and give a file path for anything the new session must look at.',
  ].join('\n')
}

let nudgeAt = 70

async function whatsNext($: EngineInterface, focus = ''): Promise<void> {
  if (await read($, isDrafting)) return
  await $.state.set(IS_DRAFTING, true)
  await $.state.set(NUDGE, null)
  try {
    const reply = await $.model.fork({ prompt: briefingAsk(focus) })
    if (!reply.isAnswered) {
      $.ui.toast(`⏭️ No briefing: ${reply.reason === 'nothing-to-fork' ? 'nothing to brief from yet' : reply.reason}`)
      return
    }
    const text = reply.text.trim()
    if (text === NOTHING_LEFT) {
      $.ui.log('⏭️ Nothing left to do')
      return
    }
    await $.state.set(DRAFT, text)
    await $.ui.open({ id: PANE, title: TITLE, focus: true, closeOnEscape: true })
  } finally {
    await $.state.set(IS_DRAFTING, false)
  }
}

async function cancel($: EngineInterface): Promise<void> {
  await $.ui.close({ id: PANE })
  await $.state.set(DRAFT, null)
}

/** Clears the conversation, leaving a note of where it came from so `/resume` can find the old one. */
async function clearFor($: EngineInterface): Promise<string | null> {
  const text = await read($, draft)
  if (text === null) return null
  await cancel($)
  const from = await $.session.id()
  await $.command.run({ command: 'clear' })
  await $.session.append({
    message: { type: 'system', content: [{ type: 'text', text: `⏭️ Continued from session ${from}. /resume it for the full history.` }] },
  })
  return text
}

async function start($: EngineInterface): Promise<void> {
  const text = await clearFor($)
  if (text !== null) await $.prompt.submit({ text, asUser: true })
}

async function edit($: EngineInterface): Promise<void> {
  const text = await clearFor($)
  if (text !== null) await $.prompt.fill({ text })
}

async function copy($: EngineInterface, surface: 'terminal' | 'desktop' | 'mobile' | 'vscode'): Promise<void> {
  const text = await read($, draft)
  if (text === null) return
  const copied = await $.ui.copy({ text, surface })
  $.ui.toast(copied.isCopied ? '⏭️ Briefing copied' : '⏭️ Could not copy the briefing')
}

async function checkFill($: EngineInterface): Promise<void> {
  const id = await $.session.id()
  if ((await read($, nudgedIn)) === id) return
  const { percent } = (await $.session.usage()).context
  if (percent === undefined || percent < nudgeAt) return
  await $.state.set(NUDGED_IN, id)
  await $.state.set(NUDGE, percent)
}

const failed = ($: EngineInterface) => () => $.ui.toast('⏭️ Could not start the fresh session')

// The hint line under the prompt can be shared with other mods. What's Next adds its item to a row
// keyed `desk-hint` after the engine's own hint; items on it are kept in order by their keys, so
// the row reads the same in any load order.
const DESK = 'desk-hint'

function keyOf(node: RenderNode | undefined): string {
  if (typeof node !== 'object' || node === null || !('props' in node)) return ''
  const key = (node.props as Record<string, unknown> | undefined)?.key
  return typeof key === 'string' ? key : ''
}

export function joinDesk(below: RenderElement, mine: RenderElement, wrap: (children: RenderNode[]) => RenderElement): RenderElement {
  if (below.type !== 'Box' || keyOf(below) !== DESK) return wrap([below, mine])
  const [line, ...items] = below.children ?? []
  const sorted = [...items.filter(n => keyOf(n) !== keyOf(mine)), mine].sort((a, b) => keyOf(a).localeCompare(keyOf(b)))
  return { ...below, children: line === undefined ? sorted : [line, ...sorted] }
}

export const register: Register = (on, options) => {
  nudgeAt = Number(options.nudgePercent ?? 70)

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: '⏭️ Brief the next task and start it in a fresh context',
      argumentHint: '[focus]',
    })
    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    // The fork would hold up the command, so it starts once the command is done.
    const focus = e.args.trim()
    $.clock.after(1, () => void whatsNext($, focus).catch(() => undefined))
    return { text: "⏭️ Writing the briefing for what's next" }
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined && nudgeAt > 0) await checkFill($).catch(() => undefined)
    return done
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const percent = await read($, nudge)
    if (percent === null || e.props.hasSurvey) return next(e)
    const below = await next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {below}
        <Box flexDirection="row" columnGap={2}>
          <Text>Context is {percent}% full.</Text>
          <Button key="nudge-start" plain label="⏭️ Start fresh?" onPress={() => void whatsNext($).catch(() => undefined)} />
          <Button key="nudge-dismiss" plain dimColor label="Dismiss" onPress={() => void $.state.set(NUDGE, null)} />
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const below = await next(e)
    const isBusy = await read($, isDrafting)
    const { Box, Button } = $.ui.resolve(e)
    const mine = (
      <Button
        key="desk-3-whats-next"
        plain
        dimColor
        label={isBusy ? '⏭️ writing…' : LABEL}
        onPress={() => void whatsNext($).catch(() => undefined)}
      />
    )
    return joinDesk(below, mine, children => (
      <Box key={DESK} flexDirection="row" columnGap={2}>
        {children}
      </Box>
    ))
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const text = await read($, draft)
    const { Box, Text, Button } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" marginBottom={1}>
          <Text bold>{TITLE}</Text>
          <Text dimColor> · the briefing for a fresh session</Text>
        </Box>
        {text === null ? (
          <Text dimColor>No briefing yet. Run /whats-next.</Text>
        ) : (
          <Box flexDirection="column">
            <Box flexDirection="row" flexWrap="wrap" columnGap={2} marginBottom={1}>
              <Button key="act-start" hotkey="s" plain label="Start" autoFocus onPress={() => void start($).catch(failed($))} />
              <Button key="act-edit" hotkey="e" plain label="Edit" onPress={() => void edit($).catch(failed($))} />
              <Button key="act-copy" hotkey="c" plain label="Copy" onPress={press => void copy($, press.surface)} />
              <Button key="act-cancel" plain dimColor label="Cancel" onPress={() => void cancel($)} />
            </Box>
            <Text>{text}</Text>
            <Box marginTop={1}>
              <Text dimColor>Start and Edit clear this conversation first · esc closes</Text>
            </Box>
          </Box>
        )}
      </Box>
    )
  })
}
