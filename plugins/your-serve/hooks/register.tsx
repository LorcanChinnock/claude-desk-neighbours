import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement, RenderNode } from 'claude-code'

import type { Serve, ServeAsked, ServeOption, ServeQuestion } from '../types'

const SERVE = { plugin: 'your-serve', key: 'serve' } as const
const HISTORY = { plugin: 'your-serve', key: 'history' } as const
const serve = atom(SERVE, null)
const history = atom(HISTORY, [])

const PANE = 'your-serve'
const TITLE = '🎾 Your Serve'

// Band hotkeys are digits, which press from an empty prompt with no ctrl+x tab first. The five
// Desk Neighbours split them so none clash: Your Serve 1–3, Grudge 4–5, Receipts 6–8, Shrink Ray 9,
// Previously On 0. The pane uses the same digits, so an answer has one key everywhere.
const HOTKEYS = ['1', '2', '3'] as const
const TAIL = 400
// How much of the reply's end Haiku reads: room for a long list of questions with their context.
const READ = 4000

// Cheap gate on the answer's ending: a question mark, an options list, or asking phrasing.
const ASKING = /\b(should i|shall i|would you like|do you want|want me to|which (one|option|approach|of these|would)|or should|let me know (if|whether|which))\b/i
const OPTIONS_LIST = /^\s*(?:[-*]\s*)?(?:\*\*)?(?:\(?[1-3a-c][.)]|option [1-3a-c]\b)/im

const EXTRACT_SYSTEM = [
  "You read the end of a coding assistant's reply and decide whether it is waiting on the user for",
  'an answer or a decision before it can go on. Reply with JSON only:',
  '{"needsInput": boolean, "questions": [{"question": string, "options": [{"label": string, "reply": string}]}]}.',
  `"questions": each separate thing the user must answer, in the order the reply asks them;`,
  'alternatives for the same decision are one question with options, never separate questions.',
  '"question": one thing the user must answer, at most 80 characters, ending in "?", naming what',
  'is being decided ("Keep the old cache or drop it?"), never only option numbers ("1, 2 or 3?").',
  '"options": at most 3 distinct answers the reply offers; "label" at most 14 characters naming the',
  'choice itself ("Keep", "Cap at 30s"), never only its number ("Option 1");',
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
  if (verdict === null || verdict.needsInput !== true || !Array.isArray(verdict.questions)) return null
  const questions: ServeQuestion[] = []
  for (const one of verdict.questions) {
    const asked = toQuestion(one)
    if (asked !== null) questions.push(asked)
  }
  return questions.length === 0 ? null : { questions, answers: [] }
}

function toQuestion(item: unknown): ServeQuestion | null {
  if (typeof item !== 'object' || item === null) return null
  const verdict = item as Record<string, unknown>
  if (typeof verdict.question !== 'string') return null
  const question = clip(verdict.question, 200)
  if (question === '') return null
  const raw = Array.isArray(verdict.options) ? verdict.options : []
  const options: ServeOption[] = []
  for (const one of raw) {
    if (typeof one !== 'object' || one === null) continue
    const { label, reply } = one as Record<string, unknown>
    if (typeof label !== 'string' || typeof reply !== 'string' || label.trim() === '' || reply.trim() === '') continue
    options.push({ label: clip(label, 40), reply: reply.replace(/\s+/g, ' ').trim() })
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
    maxTokens: 2000,
    timeoutMs: 15000,
    system: EXTRACT_SYSTEM,
    prompt: `End of the reply:\n"""\n${answer.slice(-READ)}\n"""`,
  })
  if (!reply.isAnswered || asked !== generation) return
  const next = toServe(parseJson(reply.text))
  if (next === null) return
  await $.state.set(SERVE, next)
  const at = await $.clock.now()
  const entries: ServeAsked[] = next.questions.map(({ question }) => ({ question, at }))
  // However many this turn asked, the pane still lists the six asked before them.
  await update($, history, list => [...entries, ...list].slice(0, entries.length + 6))
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
  const gap = text.includes('\n') ? '\n\n' : /\s$/.test(box.text) ? '' : ' '
  await $.prompt.fill({ text: `${gap}${text}`, mode: 'append' })
}

/** The question waiting on an answer, or null once every question has one. */
export function currentStep(shown: Serve): { step: number; asked: ServeQuestion } | null {
  const step = shown.answers.length
  const asked = shown.questions[step]
  return asked === undefined ? null : { step, asked }
}

/** Every question with its answer, one per line; a skipped one is left for the person to type after. */
export function formatAnswers(shown: Serve): string {
  return shown.questions.map((asked, index) => `${index + 1}. ${asked.question} ${shown.answers[index] ?? ''}`.trimEnd()).join('\n')
}

/**
 * An answer pressed in the band or the pane. One question puts its reply straight in the prompt, as it always
 * has. Several are asked one at a time, and the last answer puts them all in the prompt as one reply.
 * `reply` is null for a skipped question. From the pane, the pane gets out of the way before the prompt fills.
 */
async function choose($: EngineInterface, reply: string | null, isFromPane: boolean): Promise<void> {
  const shown = await read($, serve)
  if (shown === null || currentStep(shown) === null) return
  if (shown.questions.length === 1) {
    if (isFromPane) await $.ui.close({ id: PANE })
    await propose($, reply ?? '')
    return
  }
  const next: Serve = { ...shown, answers: [...shown.answers, reply] }
  await $.state.set(SERVE, next)
  if (currentStep(next) !== null) return
  if (isFromPane) await $.ui.close({ id: PANE })
  await propose($, formatAnswers(next))
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

// The engine draws the band's collapse mark `[-]` over the right end of its first row without
// narrowing `bodyColumns`, so band rows stop this many cells short of the edge.
const MARKER = 4

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
    const current = currentStep(shown)
    const count = shown.questions.length
    const isMany = count > 1
    const line =
      current === null
        ? `🎾 Your serve: all ${count} answers are in your prompt`
        : `🎾 Your serve${isMany ? ` (${current.step + 1}/${count})` : ''}: ${current.asked.question}`
    return (
      <Box flexDirection="column">
        {/* Wraps rather than truncates: answers you can't read are no use. */}
        <Box flexDirection="row" flexWrap="wrap" columnGap={2} width={e.props.bodyColumns - MARKER}>
          <Box flexShrink={1}>
            <Text>{line}</Text>
          </Box>
          {current !== null && (current.asked.options.length > 0 || isMany) && (
            <Box flexShrink={0} flexWrap="wrap" gap={1}>
              {current.asked.options.map((option, index) => (
                <Button
                  key={`serve-${index + 1}`}
                  hotkey={HOTKEYS[index]}
                  plain
                  label={option.label}
                  onPress={() => void choose($, option.reply, false)}
                />
              ))}
              {/* No digit left to spare: a skipped question is answered by typing in the prompt at the end. */}
              {isMany && <Button key="serve-skip" plain dimColor label="skip" onPress={() => void choose($, null, false)} />}
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
    const waiting = new Set(shown?.questions.map(asked => asked.question))
    const earlier = (await read($, history)).filter(asked => !waiting.has(asked.question))
    const current = shown === null ? null : currentStep(shown)
    const isMany = shown !== null && shown.questions.length > 1
    const toast = `toast after ${Math.round(toastAfterMs / 1000)}s · voice ${shouldSpeak ? 'on' : 'off'}`
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" marginBottom={1}>
          <Text bold>🎾 Your Serve</Text>
          <Text dimColor> · {shown === null ? 'nothing waiting on you' : current === null ? 'answers in your prompt' : 'waiting on you'}</Text>
        </Box>
        {shown !== null &&
          isMany &&
          shown.answers.map((reply, index) => (
            <Text dimColor>
              {index + 1}. {shown.questions[index]?.question} {reply ?? '(skipped, type it in the prompt)'}
            </Text>
          ))}
        {current !== null && (
          <Text>
            {isMany ? `${current.step + 1}. ` : ''}
            {current.asked.question}
          </Text>
        )}
        {current !== null && (current.asked.options.length > 0 || isMany) && (
          <Box flexDirection="row" gap={1} marginTop={1}>
            {current.asked.options.map((option, index) => (
              <Button
                key={`pane-serve-${index + 1}`}
                hotkey={HOTKEYS[index]}
                plain
                label={option.label}
                autoFocus={index === 0 ? true : undefined}
                onPress={() => void choose($, option.reply, true)}
              />
            ))}
            {isMany && (
              <Button
                key="pane-serve-skip"
                plain
                dimColor
                label="skip"
                autoFocus={current.asked.options.length === 0 ? true : undefined}
                onPress={() => void choose($, null, true)}
              />
            )}
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
                  <Text>{asked.question}</Text>
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
