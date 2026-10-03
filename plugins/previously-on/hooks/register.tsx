import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement, RenderNode } from 'claude-code'

import type { Activity, DayEntry } from '../types'

const RECAP = { plugin: 'previously-on', key: 'recap' } as const
const DIGEST = { plugin: 'previously-on', key: 'digest' } as const
const ACTIVITY = { plugin: 'previously-on', key: 'activity' } as const

const FRESH: Activity = { lastActiveAt: 0, finishedTurns: 0, cacheTurns: -1, cacheLines: [] }

const recap = atom(RECAP, null)
const digest = atom(DIGEST, null)
const activity = atom(ACTIVITY, FRESH)
const JOURNAL = { plugin: 'previously-on', key: 'journal' } as const
const journal = atom(JOURNAL, { repo: '', days: [] })

const PANE = 'previously-on'
const TITLE = '📺 Previously On'

const KEEP_DAYS = 14
const DAY_MS = 86_400_000
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const LABELS = ['Waiting on you', 'Done', 'Pending'] as const

const RECAP_PROMPT = [
  'The user is coming back to this session after a break. Write a recap of the session so far in at',
  'most three lines, each under 70 characters, exactly in this form and order:',
  'Waiting on you: <the question your last message asked the user, only if it asked one>',
  'Done: <what has been completed>',
  'Pending: <what remains to do>',
  'Leave out a line that would be empty. No other text.',
].join('\n')

const TOPIC_SYSTEM = 'Reply with a topic of 2 to 5 lowercase words and nothing else.'

export function localDay(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function dayName(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  const date = new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1)
  return `${WEEKDAYS[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()]}`
}

function basename(path: string): string {
  return path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? path
}

/** The recap's lines in the fixed order, "Waiting on you" first; empty when the reply has none. */
export function recapLines(reply: string): string[] {
  const lines = reply.split('\n').map(line => line.replace(/^[\s*-]+/, '').trim())
  const found: string[] = []
  for (const label of LABELS) {
    const line = lines.find(l => l.toLowerCase().startsWith(`${label.toLowerCase()}:`))
    const body = line?.slice(label.length + 1).trim() ?? ''
    if (body !== '' && !/^(none|n\/a|nothing)\.?$/i.test(body)) found.push(`${label}: ${body}`)
  }
  return found
}

/** `text` cut to at most `max` characters at a word break, never mid-word. */
export function wholeWords(text: string, max: number): string {
  if (text.length <= max) return text
  const at = text.slice(0, max + 1).lastIndexOf(' ')
  return at > 0 ? text.slice(0, at) : text.slice(0, max)
}

function isEntry(value: unknown): value is DayEntry {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return typeof v.day === 'string' && typeof v.sessionId === 'string' && typeof v.repo === 'string' && typeof v.topic === 'string'
}

/** Entries of the latest day before `today`, and which day that was. */
export function lastDayBefore(entries: readonly DayEntry[], today: string): { day: string; entries: DayEntry[] } | null {
  const days = [...new Set(entries.map(e => e.day).filter(d => d < today))].sort()
  const day = days.at(-1)
  return day === undefined ? null : { day, entries: entries.filter(e => e.day === day) }
}

function dayLabel(day: string, today: string): string {
  const [y, m, d] = today.split('-').map(Number)
  const yesterday = localDay(new Date(y ?? 1970, (m ?? 1) - 1, (d ?? 1) - 1).getTime())
  return day === yesterday ? 'Yesterday' : `Last time (${dayName(day)})`
}

function bySession(entries: readonly DayEntry[]): string[] {
  return entries.filter(e => e.topic !== '').map(e => `${e.repo} (${e.topic})`)
}

// Mirrors of the activity value, so a keystroke reads no state; filled once per load.
let lastActiveAt = 0
let finishedTurns = 0
let isLoaded = false
let isRecapping = false

async function repoName($: EngineInterface): Promise<string> {
  return basename((await $.session.repo())?.root ?? (await $.session.root()))
}

async function loadDays($: EngineInterface): Promise<DayEntry[]> {
  const stored = await $.store.get('days')
  return Array.isArray(stored) ? stored.filter(isEntry) : []
}

async function markActive($: EngineInterface, isTurnDone: boolean): Promise<void> {
  lastActiveAt = await $.clock.now()
  if (isTurnDone) finishedTurns += 1
  isLoaded = true
  const at = lastActiveAt
  const turns = finishedTurns
  await update($, activity, a => ({ ...a, lastActiveAt: at, finishedTurns: turns }))
}

async function hideAll($: EngineInterface): Promise<void> {
  if ((await read($, recap)) !== null) await $.state.set(RECAP, null)
  if ((await read($, digest)) !== null) await $.state.set(DIGEST, null)
}

async function maybeRecap($: EngineInterface, idleMs: number): Promise<void> {
  if (!isLoaded) {
    const held = await read($, activity)
    lastActiveAt = held.lastActiveAt
    finishedTurns = held.finishedTurns
    isLoaded = true
  }
  const now = await $.clock.now()
  const isReturn = finishedTurns > 0 && lastActiveAt > 0 && now - lastActiveAt >= idleMs
  if (!isReturn) return
  lastActiveAt = now
  await update($, activity, a => ({ ...a, lastActiveAt: now }))
  await makeRecap($)
}

/** Shows the recap: the one made for the session as it stands, or a new one. */
async function makeRecap($: EngineInterface): Promise<void> {
  if (isRecapping) return
  isRecapping = true
  try {
    const held = await read($, activity)
    let lines = held.cacheTurns === held.finishedTurns ? held.cacheLines : []
    if (lines.length === 0) {
      const reply = await $.model.fork({ prompt: RECAP_PROMPT })
      if (!reply.isAnswered) {
        if (reply.reason === 'nothing-to-fork') $.ui.toast('📺 Nothing to recap yet')
        return
      }
      lines = recapLines(reply.text)
      const turns = held.finishedTurns
      await update($, activity, a => ({ ...a, cacheTurns: turns, cacheLines: lines }))
    }
    if (lines.length > 0) await $.state.set(RECAP, { repo: await repoName($), lines })
  } finally {
    isRecapping = false
  }
}

async function refreshJournal($: EngineInterface): Promise<void> {
  await $.state.set(JOURNAL, { repo: await repoName($), days: await loadDays($) })
}

async function recapFromPane($: EngineInterface): Promise<void> {
  await $.ui.close({ id: PANE })
  await makeRecap($)
}

async function copyStandup($: EngineInterface, surface: 'terminal' | 'desktop' | 'mobile' | 'vscode'): Promise<void> {
  const copied = await $.ui.copy({ text: await standup($), surface })
  $.ui.toast(copied.isCopied ? '📺 Standup copied' : '📺 Could not copy: /standup prints it')
}

async function openJournal($: EngineInterface): Promise<void> {
  await refreshJournal($)
  await togglePane($, PANE, TITLE)
}

async function logTopic($: EngineInterface): Promise<void> {
  const messages = await $.session.messages()
  if ('deny' in messages) return
  const asked = messages
    .filter(m => m.role === 'user' && m.text.trim() !== '')
    .slice(-10)
    .map(m => `- ${m.text.replace(/\s+/g, ' ').slice(0, 200)}`)
  if (asked.length === 0) return
  const reply = await $.model.complete({
    model: 'haiku',
    effort: 'low',
    maxTokens: 30,
    timeoutMs: 15000,
    system: TOPIC_SYSTEM,
    prompt: `What is this coding session about? The user asked:\n${asked.join('\n')}`,
  })
  if (!reply.isAnswered) return
  const topic = wholeWords(reply.text.replace(/[\s."']+$/g, '').replace(/\s+/g, ' ').trim().toLowerCase(), 40)
  if (topic === '') return
  const now = await $.clock.now()
  const entry: DayEntry = { day: localDay(now), sessionId: await $.session.id(), repo: await repoName($), topic }
  const oldest = localDay(now - KEEP_DAYS * DAY_MS)
  const kept = (await loadDays($)).filter(e => e.day >= oldest && !(e.sessionId === entry.sessionId && e.day === entry.day))
  await $.store.set('days', [...kept, entry])
  await refreshJournal($)
}

async function morningDigest($: EngineInterface): Promise<void> {
  const today = localDay(await $.clock.now())
  if ((await $.store.get('lastDigestDay')) === today) return
  await $.store.set('lastDigestDay', today)
  const last = lastDayBefore(await loadDays($), today)
  if (last === null) return
  const sessions = bySession(last.entries)
  if (sessions.length === 0) return
  await $.state.set(DIGEST, `📺 ${dayLabel(last.day, today)}: ${sessions.join(' · ')}`)
}

async function standup($: EngineInterface): Promise<string> {
  const today = localDay(await $.clock.now())
  const entries = await loadDays($)
  const last = lastDayBefore(entries, today)
  const list = (rows: readonly DayEntry[]) =>
    rows.filter(e => e.topic !== '').map(e => `- ${e.repo}: ${e.topic}`).join('\n') || '- nothing logged'
  const before = last === null ? '**Yesterday**\n- nothing logged' : `**${dayLabel(last.day, today).replace(/^Last time \((.*)\)$/, '$1')}**\n${list(last.entries)}`
  return `${before}\n\n**Today**\n${list(entries.filter(e => e.day === today))}`
}

async function reset($: EngineInterface): Promise<void> {
  lastActiveAt = 0
  finishedTurns = 0
  await $.state.set(ACTIVITY, FRESH)
  await $.state.set(RECAP, null)
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
  const idleMs = Number(options.idleMinutes ?? 20) * 60_000

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'standup', description: "📺 Yesterday's and today's sessions, ready to paste" })
    await $.command.register({ name: 'previously-on', description: '📺 The day log, a recap on demand, and the standup to copy' })
    if (e.isInteractive) void morningDigest($).catch(() => undefined)
    void refreshJournal($).catch(() => undefined)
    return next(e)
  })

  // `/clear` starts a new session with empty state and fires no `session.start`; its classic
  // SessionStart (source `clear`) is the one place to load the day log again.
  on('classic.SessionStart', ($, e, next) => {
    if (e.source === 'clear') void refreshJournal($).catch(() => undefined)
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear' || e.reason === 'resume') await reset($).catch(() => undefined)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined && e.reason !== 'aborted') {
      void markActive($, true)
        .then(() => (finishedTurns === 1 || finishedTurns % 5 === 0 ? logTopic($) : undefined))
        .catch(() => undefined)
    }
    return done
  })

  on('prompt.submit', ($, e, next) => {
    void markActive($, false).catch(() => undefined)
    void hideAll($).catch(() => undefined)
    return next(e)
  })

  // The keystroke goes through untouched and at once; the return check runs beside it.
  on('prompt.edit', ($, e, next) => {
    void maybeRecap($, idleMs).catch(() => undefined)
    return next(e)
  })

  on('command.run', { command: 'standup' }, async $ => ({ text: await standup($) }))

  on('command.run', { command: 'previously-on' }, async $ => {
    await refreshJournal($)
    await $.ui.open({ id: PANE, title: TITLE, focus: true, closeOnEscape: true })
    return { text: '📺 Previously On open. Esc closes.' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const shown = await read($, recap)
    const morning = await read($, digest)
    if (shown === null && morning === null) return next(e)
    const below = await next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    // Digits press from an empty prompt; the Desk Neighbours split them so none clash (Previously On 0).
    const dismiss = <Button key="previously-dismiss" hotkey="0" plain label="Dismiss" onPress={() => void hideAll($)} />
    // Lines wrap rather than truncate, so the recap and Dismiss always show whole.
    const line = (text: string, withDismiss: boolean) => (
      <Box flexDirection="row" flexWrap="wrap" columnGap={2} width={e.props.bodyColumns - MARKER}>
        <Box flexShrink={1}>
          <Text>{text}</Text>
        </Box>
        {withDismiss && <Box flexShrink={0}>{dismiss}</Box>}
      </Box>
    )
    return (
      <Box flexDirection="column">
        {below}
        {morning !== null && line(morning, shown === null)}
        {shown !== null && line(`📺 Previously on ${shown.repo}…`, true)}
        {shown !== null &&
          shown.lines.map(text => (
            <Box paddingLeft={3} width={e.props.bodyColumns - MARKER}>
              <Text>{text}</Text>
            </Box>
          ))}
      </Box>
    )
  })

  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const below = await next(e)
    const { Box, Button } = $.ui.resolve(e)
    const mine = <Button key="desk-5-previously-on" plain dimColor label="📺 on air" onPress={() => void openJournal($)} />
    return joinDesk(below, mine, children => (
      <Box key={DESK} flexDirection="row" columnGap={2}>
        {children}
      </Box>
    ))
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const { repo, days } = await read($, journal)
    const today = localDay(await $.clock.now())
    const last = lastDayBefore(days, today)
    const row = (label: string, entries: readonly DayEntry[]) => (
      <Box flexDirection="row" width={e.props.bodyColumns}>
        <Box width={12} flexShrink={0}>
          <Text dimColor>{label}</Text>
        </Box>
        <Box flexShrink={1}>
          <Text dimColor={entries.length === 0}>
            {entries.length === 0 ? 'nothing logged yet' : bySession(entries).join(' · ')}
          </Text>
        </Box>
      </Box>
    )
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" marginBottom={1}>
          <Text bold>📺 Previously On</Text>
          <Text dimColor> · {repo}</Text>
        </Box>
        {row('Today', days.filter(d => d.day === today))}
        {last !== null && row(dayLabel(last.day, today).replace(/^Last time \((.*)\)$/, '$1'), last.entries)}
        <Box flexDirection="row" gap={2} marginTop={1}>
          <Button key="pane-recap" hotkey="r" plain label="Recap now" autoFocus onPress={() => void recapFromPane($)} />
          <Button key="pane-standup" hotkey="c" plain label="Copy standup" onPress={press => void copyStandup($, press.surface)} />
        </Box>
        <Box marginTop={1}>
          <Text dimColor>A line per session, kept two weeks · esc closes</Text>
        </Box>
      </Box>
    )
  })
}
