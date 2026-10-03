import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement, RenderNode } from 'claude-code'

import type { Serve, ServeAsked, ServeOption } from '../types'

const SERVE = { plugin: 'your-serve', key: 'serve' } as const
const HISTORY = { plugin: 'your-serve', key: 'history' } as const
const serve = atom(SERVE, null)
const history = atom(HISTORY, [])

const PANE = 'your-serve'
const TITLE = '🎾 Your Serve'

const HOTKEYS = ['a', 'b', 'c'] as const
const TAIL = 400

// Cheap gate on the answer's ending: a question mark, an options list, or asking phrasing.
const ASKING = /\b(should i|shall i|would you like|do you want|want me to|which (one|option|approach|of these|would)|or should|let me know (if|whether|which))\b/i
const OPTIONS_LIST = /^\s*(?:[-*]\s*)?(?:\*\*)?(?:\(?[1-3a-c][.)]|option [1-3a-c]\b)/im

const EXTRACT_SYSTEM = [
  "You read the end of a coding assistant's reply and decide whether it is waiting on the user for",
  'an answer or a decision before it can go on. Reply with JSON only:',
  '{"needsInput": boolean, "question": string, "options": [{"label": string, "reply": string}]}.',
  '"question": the single thing the user must answer, at most 80 characters, ending in "?".',
  '"options": at most 3 distinct answers the reply offers; "label" at most 14 characters ("Keep"),',
  '"reply" how the user would say it, first person, one short sentence ("Keep the old cache.").',
  'Leave "options" empty when there are no clear choices. "needsInput" is false for statements,',
  'summaries, rhetorical questions and offers that need no answer to finish the work.',
].join(' ')

export function looksLikeAsk(answer: string): boolean {
  const tail = answer.slice(-TAIL)
  return tail.includes('?') || ASKING.test(tail) || OPTIONS_LIST.test(tail)
}

function parseJson(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const value: unknown = JSON.parse(text.slice(start, end + 1))
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`
}

export function toServe(verdict: Record<string, unknown> | null): Serve | null {
  if (verdict === null || verdict.needsInput !== true || typeof verdict.question !== 'string') return null
  const question = clip(verdict.question, 80)
  if (question === '') return null
  const raw = Array.isArray(verdict.options) ? verdict.options : []
  const options: ServeOption[] = []
  for (const one of raw) {
    if (typeof one !== 'object' || one === null) continue
    const { label, reply } = one as Record<string, unknown>
    if (typeof label !== 'string' || typeof reply !== 'string' || label.trim() === '' || reply.trim() === '') continue
    options.push({ label: clip(label, 14), reply: reply.replace(/\s+/g, ' ').trim() })
    if (options.length === HOTKEYS.length) break
  }
  return { question, options }
}

// Bumped on every prompt, so an answer read after the person already replied is dropped.
let generation = 0

async function readServe($: EngineInterface, answer: string, durationMs: number, asked: number, toastAfterMs: number, shouldSpeak: boolean): Promise<void> {
  const reply = await $.model.complete({
    model: 'haiku',
    effort: 'low',
    maxTokens: 300,
    timeoutMs: 15000,
    system: EXTRACT_SYSTEM,
    prompt: `End of the reply:\n"""\n${answer.slice(-1500)}\n"""`,
  })
  if (!reply.isAnswered || asked !== generation) return
  const next = toServe(parseJson(reply.text))
  if (next === null) return
  await $.state.set(SERVE, next)
  const entry: ServeAsked = { question: next.question, at: await $.clock.now() }
  await update($, history, list => [entry, ...list].slice(0, 6))
  if (durationMs > toastAfterMs) {
    $.ui.toast('🎾 Claude needs a decision')
    if (shouldSpeak) await $.audio.speak('Claude needs a decision').catch(() => undefined)
  }
}

/** Puts `text` in the prompt box: fills an empty one, appends to a draft. */
async function propose($: EngineInterface, text: string): Promise<void> {
  const box = await $.prompt.read()
  if (box.text.trim() === '') {
    await $.prompt.fill({ text, mode: 'replace' })
    return
  }
  const gap = /\s$/.test(box.text) ? '' : ' '
  await $.prompt.fill({ text: `${gap}${text}`, mode: 'append' })
}

/** An option pressed in the pane: the pane gets out of the way, then the prompt takes the reply. */
async function answerFromPane($: EngineInterface, reply: string): Promise<void> {
  await $.ui.close({ id: PANE })
  await propose($, reply)
}

async function clear($: EngineInterface): Promise<void> {
  if ((await read($, serve)) !== null) await $.state.set(SERVE, null)
}

async function reset($: EngineInterface): Promise<void> {
  await clear($)
  await $.state.set(HISTORY, [])
}

// The hint line under the prompt is shared. Each Desk Neighbours mod adds one clickable item to
// a row keyed `desk-hint` after the engine's own hint; items are kept in order by their keys
// (`desk-1-…` to `desk-5-…`), so the row reads the same alone or together, in any load order.
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

/** Opens this mod's pane, or closes it when it is the one showing. */
async function togglePane($: EngineInterface, id: string, title: string): Promise<void> {
  const pane = (await $.ui.panes()).find(p => p.id === id)
  if (pane?.isShown === true) {
    await $.ui.close({ id })
    return
  }
  await $.ui.open({ id, title, focus: true, closeOnEscape: true })
}

/** "10:42" in local time. */
function clockTime(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export const register: Register = (on, options) => {
  const toastAfterMs = Number(options.toastAfterSeconds ?? 60) * 1000
  const shouldSpeak = options.speak === true

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'your-serve', description: '🎾 What Claude is waiting on you for, and what it asked earlier' })
    return next(e)
  })

  on('command.run', { command: 'your-serve' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE, focus: true, closeOnEscape: true })
    return { text: '🎾 Your Serve open. Esc closes.' }
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    const isMainAnswer = e.agentId === undefined && e.reason === 'answer'
    if (isMainAnswer && looksLikeAsk(e.answer)) {
      void readServe($, e.answer, e.durationMs, generation, toastAfterMs, shouldSpeak).catch(() => undefined)
    }
    return done
  })

  on('prompt.submit', ($, e, next) => {
    generation += 1
    void clear($).catch(() => undefined)
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear' || e.reason === 'resume') {
      generation += 1
      await reset($).catch(() => undefined)
    }
    return next(e)
  })

  // Always the top line of the band: drawn above whatever the plugins beneath drew.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const shown = await read($, serve)
    if (shown === null) return next(e)
    const below = await next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" width={e.props.bodyColumns}>
          <Box flexShrink={1}>
            <Text wrap="truncate-end">🎾 Your serve: {shown.question}</Text>
          </Box>
          {shown.options.length > 0 && (
            <Box flexShrink={0} marginLeft={2} gap={1}>
              {shown.options.map((option, index) => (
                <Button
                  key={`serve-${index + 1}`}
                  hotkey={HOTKEYS[index]}
                  plain
                  label={option.label}
                  onPress={() => void propose($, option.reply)}
                />
              ))}
            </Box>
          )}
        </Box>
        {below}
      </Box>
    )
  })

  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const isWaiting = (await read($, serve)) !== null
    const label = isWaiting ? '🎾 your serve' : e.props.isWorking ? '🎾 in play' : '🎾 ready'
    const below = await next(e)
    const { Box, Button } = $.ui.resolve(e)
    const mine = <Button key="desk-2-your-serve" plain dimColor label={label} onPress={() => void togglePane($, PANE, TITLE)} />
    return joinDesk(below, mine, children => (
      <Box key={DESK} flexDirection="row" columnGap={2}>
        {children}
      </Box>
    ))
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const shown = await read($, serve)
    const earlier = (await read($, history)).filter(asked => asked.question !== shown?.question)
    const toast = `toast after ${Math.round(toastAfterMs / 1000)}s · voice ${shouldSpeak ? 'on' : 'off'}`
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" marginBottom={1}>
          <Text bold>🎾 Your Serve</Text>
          <Text dimColor> · {shown === null ? 'nothing waiting on you' : 'waiting on you'}</Text>
        </Box>
        {shown !== null && <Text wrap="truncate-end">{shown.question}</Text>}
        {shown !== null && shown.options.length > 0 && (
          <Box flexDirection="row" gap={1} marginTop={1}>
            {shown.options.map((option, index) => (
              <Button
                key={`pane-serve-${index + 1}`}
                hotkey={HOTKEYS[index]}
                plain
                label={option.label}
                autoFocus={index === 0 ? true : undefined}
                onPress={() => void answerFromPane($, option.reply)}
              />
            ))}
          </Box>
        )}
        {earlier.length > 0 && (
          <Box flexDirection="column" marginTop={shown === null ? 0 : 1}>
            <Text dimColor>Earlier this session</Text>
            {earlier.map(asked => (
              <Box flexDirection="row" width={e.props.bodyColumns}>
                <Box width={7} flexShrink={0}>
                  <Text dimColor>{clockTime(asked.at)}</Text>
                </Box>
                <Box flexShrink={1}>
                  <Text wrap="truncate-end">{asked.question}</Text>
                </Box>
              </Box>
            ))}
          </Box>
        )}
        {shown === null && earlier.length === 0 && <Text dimColor>No questions yet. The ball's with Claude.</Text>}
        <Box marginTop={1}>
          <Text dimColor>{toast} · /config to change · esc closes</Text>
        </Box>
      </Box>
    )
  })
}
