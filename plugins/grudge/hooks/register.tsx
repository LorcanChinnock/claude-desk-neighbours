import { atom, memberOf, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement, RenderNode } from 'claude-code'

import type { Grudge, GrudgeList, GrudgeOffer, GrudgeScope, GrudgeSwap } from '../types'

const OFFER = { plugin: 'grudge', key: 'offer' } as const
const LIST = { plugin: 'grudge', key: 'list' } as const
const NOTES = { plugin: 'grudge', key: 'notes' } as const

const offer = atom(OFFER, null)
const list = atom(LIST, { repoName: '', repo: [], global: [] })
const notes = atom(NOTES, '')

const PANE = 'grudges'
const MAX_PROMPT = 400

// Cheap gate: only short prompts that read like a standing correction reach the model.
const CORRECTION =
  /^\s*(no|nope|nah|don'?t|do not|never|always|stop|please (don'?t|do not|always|never|stop)|from now on|we (use|don'?t)|i (prefer|want you to always|said))\b|\b(from now on|going forward|in future|instead of|rather than|always use|never use|stop using|use \S+,? not)\b/i

// The only swaps held to be exact: same arguments, same meaning, after these subcommands.
const SWAPS: readonly { from: string; to: string; sub: readonly string[] | null }[] = [
  { from: 'npm', to: 'pnpm', sub: ['install', 'i', 'run', 'test', 'start'] },
  { from: 'npm', to: 'yarn', sub: ['run', 'test', 'start'] },
  { from: 'npm', to: 'bun', sub: ['install', 'i', 'run'] },
  { from: 'pnpm', to: 'npm', sub: ['install', 'i', 'run', 'test', 'start'] },
  { from: 'yarn', to: 'npm', sub: ['run', 'test', 'start'] },
  { from: 'yarn', to: 'pnpm', sub: ['install', 'run', 'test', 'start'] },
  { from: 'pip', to: 'pip3', sub: null },
  { from: 'python', to: 'python3', sub: null },
]

const TOOLS = [...new Set(SWAPS.flatMap(s => [s.from, s.to]))].join('|')
const PREFER_FIRST = new RegExp(
  String.raw`\b(?:use|prefer|always use|stick to|with)\s+(${TOOLS})\b[^.!?]*?\b(?:not|instead of|rather than|over)\s+(${TOOLS})\b`,
  'i',
)
const REJECT_FIRST = new RegExp(
  String.raw`\b(?:no|not|never|never use|don'?t use|do not use|stop using|avoid|instead of)\s+(${TOOLS})\b[^.!?]*?\b(?:use|prefer|stick to)\s+(${TOOLS})\b`,
  'i',
)
const ARROW = new RegExp(String.raw`\b(${TOOLS})\s*(?:->|→|=>)\s*(${TOOLS})\b`, 'i')

const JUDGE_SYSTEM = [
  'You read one message a developer sent to their coding assistant and decide whether it states a',
  'LASTING preference about how the assistant should work from now on (tools, conventions, style),',
  'as opposed to a one-off correction about the current task ("that\'s the wrong file").',
  'Reply with JSON only: {"lasting": boolean, "rule": string, "scope": "repo" | "global"}.',
  '"rule" is the preference as a terse imperative of at most 60 characters, e.g. "use pnpm, not npm".',
  '"scope" is "global" only when it is clearly personal style that would hold in any project',
  '(spelling, tone, comment style); otherwise "repo".',
].join(' ')

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function extractSwap(text: string): GrudgeSwap | null {
  const prefer = PREFER_FIRST.exec(text)
  const reject = REJECT_FIRST.exec(text)
  const arrow = ARROW.exec(text)
  const pair = prefer
    ? { to: prefer[1], from: prefer[2] }
    : reject
      ? { from: reject[1], to: reject[2] }
      : arrow
        ? { from: arrow[1], to: arrow[2] }
        : null
  if (pair === null || pair.from === undefined || pair.to === undefined) return null
  const from = pair.from.toLowerCase()
  const to = pair.to.toLowerCase()

  return SWAPS.some(s => s.from === from && s.to === to) ? { from, to } : null
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Swaps `from` for `to` where it stands as a command, never inside a word (`npmrc`). */
export function applySwap(command: string, swap: GrudgeSwap): string {
  const rule = SWAPS.find(s => s.from === swap.from && s.to === swap.to)
  if (rule === undefined) return command
  const after = rule.sub ? String.raw`(?=\s+(?:${rule.sub.join('|')})(?:\s|$))` : String.raw`(?=\s|$)`
  const pattern = new RegExp(String.raw`(^|&&|\|\||[;|\n(]|\$\()(\s*)${escape(rule.from)}${after}`, 'g')

  return command.replace(pattern, `$1$2${rule.to}`)
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

function isGrudge(value: unknown): value is Grudge {
  if (typeof value !== 'object' || value === null) return false
  const g = value as Record<string, unknown>
  return typeof g.id === 'number' && typeof g.rule === 'string' && (g.scope === 'repo' || g.scope === 'global')
}

function day(ms: number): string {
  const d = new Date(ms)
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`
}

function basename(path: string): string {
  return path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? path
}

function sameRule(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  return norm(a) === norm(b)
}

let repoRoot: string | null = null
// Bumped on every prompt, so a verdict that lands after the next one is dropped.
let generation = 0

async function repoHere($: EngineInterface): Promise<string> {
  if (repoRoot === null) {
    repoRoot = (await $.session.repo())?.root ?? (await $.session.root())
  }
  return repoRoot
}

async function loadAll($: EngineInterface): Promise<Grudge[]> {
  const stored = await $.store.get('grudges')
  return Array.isArray(stored) ? stored.filter(isGrudge) : []
}

async function rulesHere($: EngineInterface): Promise<Grudge[]> {
  const root = await repoHere($)
  return (await loadAll($)).filter(g => g.scope === 'global' || g.repo === root)
}

async function refreshList($: EngineInterface): Promise<void> {
  const root = await repoHere($)
  const all = await loadAll($)
  const next: GrudgeList = {
    repoName: basename(root),
    repo: all.filter(g => g.scope === 'repo' && g.repo === root),
    global: all.filter(g => g.scope === 'global'),
  }
  await $.state.set(LIST, next)
}

async function hold($: EngineInterface): Promise<void> {
  const held = await read($, offer)
  if (held === null) return
  const root = await repoHere($)
  const all = await loadAll($)
  const id = Math.max(0, ...all.map(g => g.id)) + 1
  const grudge: Grudge = {
    id,
    rule: held.rule,
    scope: held.scope,
    repo: held.scope === 'repo' ? root : null,
    heldAt: await $.clock.now(),
    hits: 0,
    swap: held.swap,
  }
  await $.store.set('grudges', [...all, grudge])
  await $.state.set(OFFER, null)
  await refreshList($)
}

async function forgive($: EngineInterface, id: number): Promise<void> {
  await $.store.set('grudges', (await loadAll($)).filter(g => g.id !== id))
  await refreshList($)
}

async function countHits($: EngineInterface, ids: readonly number[]): Promise<void> {
  const all = await loadAll($)
  await $.store.set('grudges', all.map(g => (ids.includes(g.id) ? { ...g, hits: g.hits + 1 } : g)))
}

async function openGrudges($: EngineInterface): Promise<void> {
  await refreshList($)
  await togglePane($, PANE, '😤 Grudges')
}

async function judge($: EngineInterface, text: string, asked: number): Promise<void> {
  const reply = await $.model.complete({
    model: 'haiku',
    effort: 'low',
    maxTokens: 200,
    timeoutMs: 15000,
    system: JUDGE_SYSTEM,
    prompt: `Message:\n"""\n${text}\n"""`,
  })
  if (!reply.isAnswered || asked !== generation) return
  const verdict = parseJson(reply.text)
  if (verdict === null || verdict.lasting !== true || typeof verdict.rule !== 'string') return
  const rule = verdict.rule.replace(/\s+/g, ' ').trim().replace(/[.]$/, '').slice(0, 70)
  if (rule === '') return
  if ((await rulesHere($)).some(g => sameRule(g.rule, rule))) return
  const scope: GrudgeScope = verdict.scope === 'global' ? 'global' : 'repo'
  const next: GrudgeOffer = { rule, scope, swap: extractSwap(`${rule}. ${text}`) }
  if (asked === generation) await $.state.set(OFFER, next)
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

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'grudges', description: '😤 List the rules Grudge holds, and forgive some' })
    void refreshList($).catch(() => undefined)
    return next(e)
  })

  // `/clear` starts a new session with empty state and fires no `session.start`; its classic
  // SessionStart (source `clear`) is the one place to load the rules list again.
  on('classic.SessionStart', ($, e, next) => {
    if (e.source === 'clear') void refreshList($).catch(() => undefined)
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear' || e.reason === 'resume') {
      generation += 1
      await $.state.set(OFFER, null).catch(() => undefined)
    }
    return next(e)
  })

  on('prompt.submit', ($, e, next) => {
    generation += 1
    const asked = generation
    void read($, offer)
      .then(shown => (shown === null ? undefined : $.state.set(OFFER, null)))
      .catch(() => undefined)
    const isCandidate = e.origin.kind === 'composer' && e.text.length < MAX_PROMPT && CORRECTION.test(e.text)
    if (isCandidate) void judge($, e.text, asked).catch(() => undefined)
    return next(e)
  })

  // Held rules ride every request as a standing preference.
  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    const rules = await rulesHere($)
    if (rules.length === 0) return composed
    const text = [
      'Standing preferences the user has stated (follow them unless told otherwise in this conversation):',
      ...rules.map(g => `- ${g.rule}`),
    ].join('\n')
    return { sections: [...composed.sections, { id: 'grudge:rules', text, scope: 'session' as const }] }
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const held = (await rulesHere($)).filter(g => g.swap !== null)
    if (held.length === 0) return next(e)
    let command = e.command
    const fired: Grudge[] = []
    for (const grudge of held) {
      if (grudge.swap === null) continue
      const swapped = applySwap(command, grudge.swap)
      if (swapped !== command) {
        command = swapped
        fired.push(grudge)
      }
    }
    if (fired.length === 0) return next(e)
    const note = fired.map(g => `😤 grudge #${g.id}: ${g.swap?.from} → ${g.swap?.to}`).join(' · ')
    void $.state.set({ ...NOTES, id: e.tool_use_id }, note).catch(() => undefined)
    void countHits(
      $,
      fired.map(g => g.id),
    ).catch(() => undefined)
    return next({ ...e, command })
  })

  on('ui.render', { component: 'ToolUse', props: { tool: 'Bash' } }, async ($, e, next) => {
    const note = await read($, memberOf(notes, e))
    if (note === '') return next(e)
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {await next(e)}
        <Text dimColor>
          {'  '}
          {note}
        </Text>
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const shown = await read($, offer)
    if (shown === null) return next(e)
    const below = await next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const where = shown.scope === 'global' ? ' (everywhere)' : ''
    return (
      <Box flexDirection="column">
        {below}
        {/* Wraps rather than truncates, so the rule and its buttons always show whole. */}
        <Box flexDirection="row" flexWrap="wrap" columnGap={2} width={e.props.bodyColumns - MARKER}>
          <Box flexShrink={1}>
            <Text>
              😤 Hold a grudge? "{shown.rule}"{where}
            </Text>
          </Box>
          {/* Digits press from an empty prompt; the Desk Neighbours split them so none clash (Grudge 4–5). */}
          <Box flexShrink={0} gap={1}>
            <Button key="grudge-hold" hotkey="4" plain label="Hold" onPress={() => void hold($)} />
            <Button key="grudge-nah" hotkey="5" plain label="Nah" onPress={() => void update($, offer, () => null)} />
          </Box>
        </Box>
      </Box>
    )
  })

  on('command.run', { command: 'grudges' }, async $ => {
    await refreshList($)
    await $.ui.open({ id: PANE, title: '😤 Grudges', focus: true, closeOnEscape: true })
    return { text: '😤 Grudges open. Esc closes.' }
  })

  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const held = await read($, list)
    const n = held.repo.length + held.global.length
    const label = n === 0 ? '😤 no grudges' : `😤 ${n} grudge${n === 1 ? '' : 's'}`
    const below = await next(e)
    const { Box, Button } = $.ui.resolve(e)
    const mine = <Button key="desk-1-grudge" plain dimColor label={label} onPress={() => void openGrudges($)} />
    return joinDesk(below, mine, children => (
      <Box key={DESK} flexDirection="row" columnGap={2}>
        {children}
      </Box>
    ))
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const held = await read($, list)
    const columns = e.props.bodyColumns

    const row = (g: Grudge) => {
      const tally = g.swap === null ? 'reminded' : `enforced ${g.hits}×`
      return (
        <Box key={`row-${g.id}`} flexDirection="row" width={columns}>
          <Box width={5} flexShrink={0}>
            <Text dimColor>#{String(g.id)}</Text>
          </Box>
          <Box flexGrow={1} flexShrink={1}>
            <Text>{g.rule}</Text>
          </Box>
          <Box flexShrink={0} marginLeft={2}>
            <Text dimColor>
              held {day(g.heldAt)} · {tally}
            </Text>
          </Box>
          <Box flexShrink={0} marginLeft={2}>
            <Button key={`forgive-${g.id}`} label="Forgive" dimColor onPress={() => void forgive($, g.id)} />
          </Box>
        </Box>
      )
    }

    const isEmpty = held.repo.length === 0 && held.global.length === 0
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" marginBottom={1}>
          <Text bold>😤 Grudges</Text>
          <Text dimColor> · {held.repoName}</Text>
        </Box>
        {isEmpty && <Text dimColor>None held. Yet.</Text>}
        {held.repo.map(row)}
        {held.global.length > 0 && (
          <Box marginTop={held.repo.length > 0 ? 1 : 0}>
            <Text dimColor>everywhere</Text>
          </Box>
        )}
        {held.global.map(row)}
        <Box marginTop={1}>
          <Text dimColor>Correct Claude in a prompt to start one · esc closes</Text>
        </Box>
      </Box>
    )
  })
}
