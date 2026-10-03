import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement, RenderNode } from 'claude-code'

import type { Crumb, ReceiptsBand, ReceiptsLedger } from '../types'

const BAND = { plugin: 'receipts', key: 'band' } as const
const LEDGER = { plugin: 'receipts', key: 'ledger' } as const

const FRESH: ReceiptsLedger = {
  seq: 0,
  lastEditSeq: 0,
  lastEditFile: null,
  lastVerifySeq: 0,
  turnEdited: false,
  turnCrumbs: [],
  misses: 0,
  uncheckedFiles: [],
}

const band = atom(BAND, null)
// `shape` declines a ledger an older build of this mod left in the session.
const ledger = atom(LEDGER, FRESH, { shape: 'v3' })
const COMMAND = { plugin: 'receipts', key: 'command' } as const
const command = atom(COMMAND, null)

const PANE = 'receipts'
const TITLE = '🧾 Receipts'

// Tests, typecheck, lint or build, in the common spellings.
const VERIFY = new RegExp(
  [
    String.raw`\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|tests|typecheck|type-check|tsc|lint|build|check|verify|ci)\b`,
    String.raw`\b(?:npx|pnpx|bunx|pnpm\s+exec|pnpm\s+dlx)\s+(?:vitest|jest|tsc|eslint|playwright|mocha|biome)\b`,
    String.raw`(?:^|[;&|(]\s*)(?:\S*/)?(?:vitest|jest|tsc|eslint|pytest|mypy|ruff|rspec|phpunit|mocha|tox|nox)\b`,
    String.raw`\bcargo\s+(?:test|check|clippy|build|nextest)\b`,
    String.raw`\bgo\s+(?:test|vet|build)\b`,
    String.raw`\bmake\s+(?:test|check|lint|build|ci)\b`,
    String.raw`\bpython3?\s+-m\s+(?:pytest|unittest|mypy)\b`,
    String.raw`\b(?:gradlew?|\./gradlew)\s+(?:test|check|build)\b`,
    String.raw`\bmvn\s+(?:test|verify)\b`,
    String.raw`\b(?:dotnet|mix|swift)\s+test\b`,
    String.raw`\bdeno\s+(?:test|check|lint)\b`,
    String.raw`\b(?:turbo|nx)\s+(?:run\s+)?(?:test|lint|build|typecheck)\b`,
  ].join('|'),
  'i',
)

const CLAIM = /\b(fixed|works now|now works|working now|tests? (?:now )?pass(?:es|ing)?|all (?:tests|checks) pass|passing now|done|implemented|resolved|should (?:now )?work|complete[d]?|ready)\b/i

const CLAIM_SYSTEM = 'Answer with one word: yes or no.'

const NOT_CODE = /\.(md|mdx|markdown|txt|rst|adoc)$/i
const TEST_FILE = /(^|\/)(tests?|__tests__|spec|specs)\/|[._-](test|spec)\.[a-z0-9]+$|_test\.(py|go|rb|exs?)$|(^|\/)test_[^/]+\.py$/i

const CRUMBS: readonly { kind: string; pattern: RegExp; isFreshOnly?: true; isOutsideTestsOnly?: true }[] = [
  { kind: 'console.log', pattern: /\bconsole\.log\s*\(/ },
  { kind: 'debugger', pattern: /^\s*debugger\s*;?\s*$/ },
  { kind: 'print(', pattern: /(^|[^\w.])print\s*\(/, isOutsideTestsOnly: true },
  { kind: '.only', pattern: /\.only\s*\(/ },
  { kind: 'fit(', pattern: /(^|[^\w.])fit\s*\(/ },
  { kind: 'fdescribe(', pattern: /(^|[^\w.])fdescribe\s*\(/ },
  { kind: 'binding.pry', pattern: /\bbinding\.pry\b/ },
  { kind: 'dbg!', pattern: /\bdbg!\s*\(/ },
  { kind: 'TODO', pattern: /\bTODO\b/, isFreshOnly: true },
  { kind: 'FIXME', pattern: /\bFIXME\b/, isFreshOnly: true },
]

type Hunk = { newStart: number; lines: string[] }

/** The crumbs among the lines a patch adds; a TODO the patch also removed is not new. */
export function crumbsIn(file: string, hunks: readonly Hunk[]): Crumb[] {
  if (NOT_CODE.test(file)) return []
  const isTest = TEST_FILE.test(file)
  const found: Crumb[] = []
  for (const hunk of hunks) {
    const removed = new Set(hunk.lines.filter(l => l.startsWith('-')).map(l => l.slice(1).trim()))
    let line = hunk.newStart
    for (const raw of hunk.lines) {
      if (raw.startsWith('-')) continue
      if (raw.startsWith('+')) {
        const text = raw.slice(1)
        for (const crumb of CRUMBS) {
          if (crumb.isOutsideTestsOnly && isTest) continue
          if (crumb.isFreshOnly && removed.has(text.trim())) continue
          if (crumb.pattern.test(text)) found.push({ kind: crumb.kind, file, line })
        }
      }
      line += 1
    }
  }
  return found
}

function wholeFile(content: string): Hunk[] {
  return [{ newStart: 1, lines: content.split('\n').map(l => `+${l}`) }]
}

function basename(path: string): string {
  return path.split('/').pop() ?? path
}

function crumbList(crumbs: readonly Crumb[], max: number): string {
  const shown = crumbs.slice(0, max).map(c => `${c.kind} ${basename(c.file)}:${c.line}`)
  return crumbs.length > max ? `${shown.join(', ')}, …` : shown.join(', ')
}

export function footerFor(missingFile: string | null, crumbs: readonly Crumb[]): string {
  const parts: string[] = []
  if (missingFile !== null) parts.push(`No receipt: nothing ran since edit to ${missingFile}`)
  if (crumbs.length > 0) {
    parts.push(`${crumbs.length} crumb${crumbs.length === 1 ? '' : 's'} (${crumbList(crumbs, 3)})`)
  }
  return `🧾 ${parts.join(' · ')}`
}

let repoRoot: string | null = null

async function repoHere($: EngineInterface): Promise<string> {
  if (repoRoot === null) repoRoot = (await $.session.repo())?.root ?? (await $.session.root())
  return repoRoot
}

async function relative($: EngineInterface, file: string): Promise<string> {
  const root = await repoHere($)
  return file.startsWith(`${root}/`) ? file.slice(root.length + 1) : file
}

async function learnedCommand($: EngineInterface): Promise<string | null> {
  const stored = await $.store.get(`verify:${await repoHere($)}`)
  return typeof stored === 'string' ? stored : null
}

async function recordEdit($: EngineInterface, file: string, hunks: readonly Hunk[]): Promise<void> {
  const shown = await relative($, file)
  const crumbs = crumbsIn(shown, hunks)
  await update($, ledger, l => ({
    ...l,
    seq: l.seq + 1,
    lastEditSeq: l.seq + 1,
    lastEditFile: shown,
    turnEdited: true,
    uncheckedFiles: [...l.uncheckedFiles.filter(f => f !== shown), shown],
    turnCrumbs: [...l.turnCrumbs.filter(c => c.file !== shown || !crumbs.some(n => n.line === c.line)), ...crumbs].slice(-50),
  }))
}

async function recordCommand($: EngineInterface, command: string, exitCode: number): Promise<void> {
  if (!VERIFY.test(command)) return
  await update($, ledger, l => ({ ...l, seq: l.seq + 1, lastVerifySeq: l.seq + 1, uncheckedFiles: [] }))
  if (exitCode === 0) void learn($, command).catch(() => undefined)
}

async function learn($: EngineInterface, ran: string): Promise<void> {
  const learned = ran.trim().slice(0, 200)
  await $.store.set(`verify:${await repoHere($)}`, learned)
  await $.state.set(COMMAND, learned)
}

async function loadCommand($: EngineInterface): Promise<void> {
  await $.state.set(COMMAND, await learnedCommand($))
}

/** A pane button: the pane gets out of the way, then the prompt takes the text. */
async function proposeFromPane($: EngineInterface, text: string): Promise<void> {
  await $.ui.close({ id: PANE })
  await propose($, text)
}

function runText(learned: string | null): string {
  return learned === null ? 'Run the tests and show me the result.' : `Run \`${learned}\` and show me the result.`
}

function sweepText(crumbs: readonly Crumb[]): string {
  return `Remove these leftovers: ${crumbs.map(c => `${c.kind} in ${c.file}:${c.line}`).join(', ')}.`
}

async function confirmsClaim($: EngineInterface, answer: string, signal: AbortSignal): Promise<boolean> {
  const reply = await $.model.complete(
    {
      model: 'haiku',
      effort: 'low',
      maxTokens: 5,
      timeoutMs: 2500,
      system: CLAIM_SYSTEM,
      prompt: `Does this message from a coding assistant claim its change is finished, fixed or verified working?\n"""\n${answer.slice(-2000)}\n"""`,
    },
    { signal },
  )
  return reply.isAnswered && /^\s*yes\b/i.test(reply.text)
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

async function clearBand($: EngineInterface): Promise<void> {
  if ((await read($, band)) !== null) await $.state.set(BAND, null)
}

async function startTurn($: EngineInterface): Promise<void> {
  await update($, ledger, l => ({ ...l, turnEdited: false, turnCrumbs: [] }))
}

async function resetSession($: EngineInterface): Promise<void> {
  await update($, ledger, () => FRESH)
  await $.state.set(BAND, null)
}

/** The footer for a finished turn, or null when it has nothing to say. */
async function audit($: EngineInterface, answer: string, signal: AbortSignal): Promise<string | null> {
  const l = await read($, ledger)
  if (!l.turnEdited) return null
  const isUnverified = l.lastVerifySeq < l.lastEditSeq && CLAIM.test(answer)
  const isMissing = isUnverified && (await confirmsClaim($, answer, signal).catch(() => false))
  const crumbs = l.turnCrumbs
  if (!isMissing && crumbs.length === 0) return null

  const missingFile = isMissing ? l.lastEditFile : null
  const misses = isMissing ? l.misses + 1 : l.misses
  if (isMissing) await update($, ledger, now => ({ ...now, misses: now.misses + 1 }))
  const summary = footerFor(missingFile, crumbs)
  const next: ReceiptsBand = {
    summary,
    missingFile,
    crumbs,
    command: await learnedCommand($),
    canMakeRule: isMissing && misses >= 2,
  }
  await $.state.set(BAND, next)
  return summary
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
    await $.command.register({ name: 'receipts', description: '🧾 What is unchecked, what ran, and leftovers in the last turn' })
    void loadCommand($).catch(() => undefined)
    return next(e)
  })

  on('command.run', { command: 'receipts' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE, focus: true, closeOnEscape: true })
    return { text: '🧾 Receipts open. Esc closes.' }
  })

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError !== true && ran.result.staged !== true) {
      await recordEdit($, ran.result.filePath, ran.result.structuredPatch).catch(() => undefined)
    }
    return ran
  })

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError !== true && ran.result.staged !== true) {
      const { filePath, structuredPatch, content, type } = ran.result
      const hunks = type === 'create' || structuredPatch.length === 0 ? wholeFile(content) : structuredPatch
      await recordEdit($, filePath, hunks).catch(() => undefined)
    }
    return ran
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined) return ran
    // Bash's record has no exit code: an error result's text opens with it.
    const exitCode = ran.isError === true ? Number(/Exit code (\d+)/.exec(ran.text ?? '')?.[1] ?? 1) : 0
    await recordCommand($, e.command, exitCode).catch(() => undefined)
    return ran
  })

  on('turn.start', async ($, e, next) => {
    await startTurn($).catch(() => undefined)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId !== undefined || e.reason !== 'answer') return done
    const footer = await audit($, e.answer, next.signal).catch(() => null)
    if (footer === null) return done
    const prior = done.text === e.answer ? '' : done.text
    return { ...done, text: prior === '' ? footer : `${prior}\n${footer}` }
  })

  on('prompt.submit', ($, e, next) => {
    void clearBand($).catch(() => undefined)
    return next(e)
  })

  // `/clear` and `/resume` go on under a new session with empty state and fire no `session.start`;
  // their classic SessionStart (source `clear` or `resume`) is the one place to load the learned check command again.
  on('classic.SessionStart', ($, e, next) => {
    if (e.source === 'clear' || e.source === 'resume') void loadCommand($).catch(() => undefined)
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear' || e.reason === 'resume') await resetSession($).catch(() => undefined)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const shown = await read($, band)
    if (shown === null) return next(e)
    const below = await next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const learned = shown.command
    const run = runText(learned)
    const sweep = sweepText(shown.crumbs)
    const rule = `From now on, always run ${learned === null ? 'the tests' : `\`${learned}\``} before saying something is done.`
    return (
      <Box flexDirection="column">
        {below}
        {/* Wraps rather than truncates, so the summary and its buttons always show whole. */}
        <Box flexDirection="row" flexWrap="wrap" columnGap={2} width={e.props.bodyColumns - MARKER}>
          <Box flexShrink={1}>
            <Text>{shown.summary}</Text>
          </Box>
          {/* Digits press from an empty prompt; the Desk Neighbours split them so none clash (Receipts 6–8). */}
          <Box flexShrink={0} flexWrap="wrap" gap={1}>
            {shown.missingFile !== null && (
              <Button key="receipts-run" hotkey="6" plain label="Run them" onPress={() => void propose($, run)} />
            )}
            {shown.crumbs.length > 0 && (
              <Button key="receipts-sweep" hotkey="7" plain label="Sweep" onPress={() => void propose($, sweep)} />
            )}
            {shown.canMakeRule && (
              <Button key="receipts-rule" hotkey="8" plain label="Make it a rule" onPress={() => void propose($, rule)} />
            )}
          </Box>
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const l = await read($, ledger)
    const n = l.uncheckedFiles.length
    const label = n > 0 ? `🧾 ${n} unchecked` : l.lastEditSeq > 0 && l.lastVerifySeq > l.lastEditSeq ? '🧾 ✓ checked' : '🧾 watching'
    const below = await next(e)
    const { Box, Button } = $.ui.resolve(e)
    const mine = <Button key="desk-3-receipts" plain dimColor label={label} onPress={() => void togglePane($, PANE, TITLE)} />
    return joinDesk(below, mine, children => (
      <Box key={DESK} flexDirection="row" columnGap={2}>
        {children}
      </Box>
    ))
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const l = await read($, ledger)
    const learned = await read($, command)
    const files = l.uncheckedFiles
    const status = files.length > 0 ? `${files.length} unchecked` : l.lastVerifySeq > l.lastEditSeq && l.lastEditSeq > 0 ? 'all checked' : 'nothing edited yet'
    const row = (label: string, value: string, isDim: boolean, action?: RenderElement) => (
      <Box flexDirection="row" width={e.props.bodyColumns}>
        <Box width={12} flexShrink={0}>
          <Text dimColor>{label}</Text>
        </Box>
        <Box flexShrink={1} flexGrow={1}>
          <Text dimColor={isDim}>
            {value}
          </Text>
        </Box>
        {action !== undefined && (
          <Box flexShrink={0} marginLeft={2}>
            {action}
          </Box>
        )}
      </Box>
    )
    const runButton = <Button key="pane-run" hotkey="r" plain label="Run it" autoFocus onPress={() => void proposeFromPane($, runText(learned))} />
    const sweepButton = <Button key="pane-sweep" hotkey="s" plain label="Sweep" onPress={() => void proposeFromPane($, sweepText(l.turnCrumbs))} />
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" marginBottom={1}>
          <Text bold>🧾 Receipts</Text>
          <Text dimColor> · {status}</Text>
        </Box>
        {row('Checks with', learned ?? 'not learned yet: run tests, typecheck, lint or build once', learned === null, runButton)}
        {row('Unchecked', files.length === 0 ? 'none' : files.slice(-4).reverse().join(' · ') + (files.length > 4 ? ' · …' : ''), files.length === 0)}
        {row(
          'Crumbs',
          l.turnCrumbs.length === 0 ? 'none in the last turn' : l.turnCrumbs.map(c => `${c.kind} ${c.file}:${c.line}`).join(', '),
          l.turnCrumbs.length === 0,
          l.turnCrumbs.length > 0 ? sweepButton : undefined,
        )}
        {row('Missed', l.misses === 0 ? 'no missing receipts this session' : `${l.misses} missing receipt${l.misses === 1 ? '' : 's'} this session`, l.misses === 0)}
        <Box marginTop={1}>
          <Text dimColor>esc closes</Text>
        </Box>
      </Box>
    )
  })
}
