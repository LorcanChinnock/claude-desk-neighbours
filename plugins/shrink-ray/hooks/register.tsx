import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement, RenderNode } from 'claude-code'

import type { PasteUndo, ShrinkShot } from '../types'

const UNDO = { plugin: 'shrink-ray', key: 'undo' } as const
const DEFLECTED = { plugin: 'shrink-ray', key: 'deflected' } as const

const undo = atom(UNDO, null)
const deflected = atom(DEFLECTED, 0)
const LIFETIME = { plugin: 'shrink-ray', key: 'lifetime' } as const
const lifetime = atom(LIFETIME, 0)
const SHOTS = { plugin: 'shrink-ray', key: 'shots' } as const
const shots = atom(SHOTS, [])

const PANE = 'shrink-ray'
const TITLE = '🔫 Shrink Ray'

const PASTE_LINES = 80
const OUTPUT_LINES = 150
const UNDO_MS = 10_000
const KEEP_DAYS = 7

type Budget = { head: number; tail: number; errors: number }
const PASTE: Budget = { head: 12, tail: 12, errors: 15 }
const OUTPUT: Budget = { head: 20, tail: 20, errors: 30 }

const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][A-Z0-9]/g
const PROGRESS = /^\s*(?:[\[(|]?[=#>\-.█▓▒░■□━─\s]{8,}[\])|]?\s*)?\d{1,3}(?:\.\d+)?\s?%|^\s*[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏|/\\-]\s*$/
const TIMESTAMP =
  /^\s*\[?(?:\d{4}-\d{2}-\d{2}[T ])?\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?\]?\s*(?:-\s+)?/
const FRAME = /^\s+at\s+\S|^\s*File "[^"]+", line \d+|^\s+from\s+\S+:\d+:in\b/
const DEPENDENCY =
  /node_modules|site-packages|dist-packages|\/gems\/|node:internal|\(internal\/|<frozen |\/usr\/lib\/|java\.base\/|jdk\.internal|sun\.reflect|org\.springframework|org\.junit|kotlinx\.coroutines|react-dom|webpack/
const ERRORISH =
  /\b(?:error|err!|errors|failed|failure|failing|fail|exception|panic|panicked|fatal|traceback|assert(?:ion)?|cannot|unable to|denied|segmentation fault|undefined reference)\b|✗|✕|✖|⨯|^Exit code \d+/i
const PASSING = /^\s*(?:✓|✔|√|PASS\s|ok\s+\S|--- PASS|test \S.* \.\.\. ok$|\S+::\S+ PASSED\b|.*\bPASSED\s*\[)/
const TEST_RUNNER = /\b(?:jest|vitest|pytest|mocha|cargo test|go test|rspec)\b|\b\d+ (?:passed|failed|passing|failing)\b|test result:|^\s*(?:PASS|FAIL)\s/im

function lineCount(text: string): number {
  return text === '' ? 0 : text.split('\n').length
}

export function grouped(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

export function tokens(n: number): string {
  return n < 1000 ? String(Math.round(n)) : `${(n / 1000).toFixed(1)}k`
}

function clean(lines: readonly string[]): string[] {
  const out: string[] = []
  for (const raw of lines) {
    const line = (raw.split('\r').pop() ?? '').replace(ANSI, '').replace(TIMESTAMP, '')
    if (PROGRESS.test(line)) continue
    out.push(line.trimEnd())
  }
  return out
}

/** Keeps each trace's first and last frame and its own code's frames; folds the rest. */
function foldFrames(lines: readonly string[]): string[] {
  const out: string[] = []
  let index = 0
  while (index < lines.length) {
    if (!FRAME.test(lines[index] ?? '')) {
      out.push(lines[index] ?? '')
      index += 1
      continue
    }
    const frames: string[][] = []
    while (index < lines.length && FRAME.test(lines[index] ?? '')) {
      const frame = [lines[index] ?? '']
      index += 1
      // A Python frame carries its source line, indented beneath it.
      const isPython = /^\s*File "/.test(frame[0] ?? '')
      if (isPython && index < lines.length && /^\s{4,}\S/.test(lines[index] ?? '') && !FRAME.test(lines[index] ?? '')) {
        frame.push(lines[index] ?? '')
        index += 1
      }
      frames.push(frame)
    }
    let folded = 0
    frames.forEach((frame, at) => {
      const isEdge = at === 0 || at === frames.length - 1
      if (isEdge || !DEPENDENCY.test(frame[0] ?? '')) {
        if (folded > 0) out.push(`    … ${folded} framework frame${folded === 1 ? '' : 's'}`)
        folded = 0
        out.push(...frame)
      } else {
        folded += 1
      }
    })
  }
  return out
}

function collapseRepeats(lines: readonly string[]): string[] {
  const out: string[] = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index] ?? ''
    let run = 1
    while (index + run < lines.length && lines[index + run] === line) run += 1
    out.push(run > 1 ? `${line} ×${run}` : line)
    index += run
  }
  return out
}

function keepEnds(lines: readonly string[], budget: Budget): string[] {
  if (lines.length <= budget.head + budget.tail + budget.errors) return [...lines]
  const head = lines.slice(0, budget.head)
  const tail = lines.slice(-budget.tail)
  const middle = lines.slice(budget.head, -budget.tail)
  const out = [...head]
  let skipped = 0
  let kept = 0
  for (const line of middle) {
    if (kept < budget.errors && ERRORISH.test(line)) {
      if (skipped > 0) out.push(`… ${grouped(skipped)} lines …`)
      skipped = 0
      kept += 1
      out.push(line)
    } else {
      skipped += 1
    }
  }
  if (skipped > 0) out.push(`… ${grouped(skipped)} lines …`)
  return [...out, ...tail]
}

function shapeOf(value: unknown, depth: number): string {
  if (Array.isArray(value)) return value.length === 0 ? '[]' : `[${value.length} × ${shapeOf(value[0], depth + 1)}]`
  if (value === null) return 'null'
  if (typeof value !== 'object') return typeof value
  const keys = Object.keys(value)
  if (depth >= 3) return `{${keys.length} keys}`
  const shown = keys.slice(0, 8).map(k => `${k}: ${shapeOf((value as Record<string, unknown>)[k], depth + 1)}`)
  return `{ ${shown.join(', ')}${keys.length > 8 ? ', …' : ''} }`
}

function sampleOf(value: unknown, depth: number): unknown {
  if (Array.isArray(value)) {
    const items = value.slice(0, 3).map(item => sampleOf(item, depth + 1))
    return value.length > 3 ? [...items, `… ${value.length - 3} more`] : items
  }
  if (typeof value === 'string') return value.length > 80 ? `${value.slice(0, 79)}…` : value
  if (value === null || typeof value !== 'object') return value
  if (depth >= 3) return '{…}'
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, sampleOf(v, depth + 1)]))
}

function summariseJson(text: string): string[] | null {
  const trimmed = text.trim()
  if (!/^[[{]/.test(trimmed)) return null
  try {
    const value: unknown = JSON.parse(trimmed)
    const sample = JSON.stringify(sampleOf(value, 0), null, 2).split('\n').slice(0, 40)
    return [`JSON shape: ${shapeOf(value, 0)}`, 'Sample:', ...sample]
  } catch {
    return null
  }
}

/** The shrunk text, or null when shrinking would not save much. */
export function shrink(text: string, budget: Budget, isOutput: boolean): string | null {
  const json = summariseJson(text)
  let lines = json ?? clean(text.split('\n'))
  if (json === null) {
    if (isOutput && TEST_RUNNER.test(text)) lines = lines.filter(line => !PASSING.test(line))
    lines = keepEnds(collapseRepeats(foldFrames(lines)), budget)
  }
  const shrunk = lines.join('\n')
  return shrunk.length < text.length * 0.8 ? shrunk : null
}

/** Removes originals older than a week. `$.fs` cannot delete, so this asks `find`; where there is
 * no `find` (Windows) the call fails and the originals stay. */
async function prune($: EngineInterface): Promise<void> {
  const home = await $.env.get('HOME')
  if (home === undefined) return
  const dir = `${home}/.claude/shrink-ray`
  if (!(await $.fs.exists(dir))) return
  await $.process.run(['find', dir, '-type', 'f', '-name', '*.txt', '-mtime', `+${KEEP_DAYS}`, '-delete'])
  await $.process.run(['find', dir, '-mindepth', '1', '-type', 'd', '-empty', '-delete'])
}

async function keepOriginal($: EngineInterface, kind: string, text: string): Promise<string> {
  const home = await $.env.get('HOME')
  const stamp = await $.clock.now()
  const path = `${home ?? '/tmp'}/.claude/shrink-ray/${await $.session.id()}/${kind}-${stamp}.txt`
  await $.fs.write(path, text)
  return path
}

async function count($: EngineInterface, saved: number): Promise<void> {
  const estimate = Math.max(0, saved) / 4
  await update($, deflected, n => n + estimate)
  const total = Number((await $.store.get('lifetime')) ?? 0) + estimate
  await $.store.set('lifetime', total)
  await $.state.set(LIFETIME, total)
}

async function loadLifetime($: EngineInterface): Promise<void> {
  await $.state.set(LIFETIME, Number((await $.store.get('lifetime')) ?? 0))
}

async function remember($: EngineInterface, shot: Omit<ShrinkShot, 'at'>): Promise<void> {
  const at = await $.clock.now()
  await update($, shots, list => [{ ...shot, at }, ...list].slice(0, 8))
}

async function copyPath($: EngineInterface, path: string, surface: 'terminal' | 'desktop' | 'mobile' | 'vscode'): Promise<void> {
  const copied = await $.ui.copy({ text: path, surface })
  $.ui.toast(copied.isCopied ? '🔫 Path copied' : `🔫 ${path}`)
}

async function undoPaste($: EngineInterface): Promise<void> {
  const held = await read($, undo)
  if (held === null) return
  await $.state.set(UNDO, null)
  const box = await $.prompt.read()
  const at = box.text.indexOf(held.shrunk)
  if (at < 0) {
    $.ui.toast('🔫 The paste was edited; nothing to undo')
    return
  }
  const text = box.text.slice(0, at) + held.original + box.text.slice(at + held.shrunk.length)
  await $.prompt.fill({ text, mode: 'replace' })
  await count($, -(held.original.length - held.shrunk.length))
}

async function expire($: EngineInterface, shrunk: string): Promise<void> {
  const held = await read($, undo)
  if (held !== null && held.shrunk === shrunk) await $.state.set(UNDO, null)
}

async function shrinkPaste($: EngineInterface, pasted: string): Promise<string | null> {
  const shrunk = shrink(pasted, PASTE, false)
  if (shrunk === null) return null
  const path = await keepOriginal($, 'paste', pasted)
  const before = lineCount(pasted)
  const after = lineCount(shrunk) + 1
  const landed = `${shrunk}\n[shrink-ray: ${grouped(before)} → ${grouped(after)} lines; full paste: ${path}]`
  const held: PasteUndo = { original: pasted, shrunk: landed, before, after }
  await $.state.set(UNDO, held)
  $.clock.after(UNDO_MS, () => void expire($, landed).catch(() => undefined))
  void count($, pasted.length - landed.length).catch(() => undefined)
  void remember($, { kind: 'paste', before, after, path }).catch(() => undefined)
  return landed
}

type Block = { type: string; [field: string]: unknown }

function resultText(block: Block): string | null {
  if (typeof block.content === 'string') return block.content
  if (!Array.isArray(block.content)) return null
  const parts = block.content as Block[]
  if (!parts.every(part => part.type === 'text' && typeof part.text === 'string')) return null
  return parts.map(part => String(part.text)).join('\n')
}

async function shrinkOutput($: EngineInterface, block: Block): Promise<Block> {
  if (block.type !== 'tool_result') return block
  const text = resultText(block)
  if (text === null || lineCount(text) <= OUTPUT_LINES) return block
  const shrunk = shrink(text, OUTPUT, true)
  if (shrunk === null) return block
  const path = await keepOriginal($, 'output', text)
  const note = `[shrink-ray: ${grouped(lineCount(text))} → ${grouped(lineCount(shrunk))} lines, full output: ${path}]`
  void count($, text.length - shrunk.length - note.length).catch(() => undefined)
  void remember($, { kind: 'output', before: lineCount(text), after: lineCount(shrunk), path }).catch(() => undefined)
  return { ...block, content: `${note}\n${shrunk}` }
}

async function reset($: EngineInterface): Promise<void> {
  await $.state.set(UNDO, null)
  await $.state.set(DEFLECTED, 0)
  await $.state.set(SHOTS, [])
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
    await $.command.register({ name: 'shrink-ray', description: '🔫 What got shrunk, how much, and where the originals are' })
    void loadLifetime($).catch(() => undefined)
    void prune($).catch(() => undefined)
    return next(e)
  })

  on('command.run', { command: 'shrink-ray' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE, focus: true, closeOnEscape: true })
    return { text: '🔫 Shrink Ray open. Esc closes.' }
  })

  on('prompt.edit', async ($, e, next) => {
    const isPaste = e.key === undefined && lineCount(e.inputText) > PASTE_LINES
    if (!isPaste) return next(e)
    const landed = await shrinkPaste($, e.inputText).catch(() => null)
    if (landed === null) return next(e)
    return next({ ...e, inputText: landed })
  })

  // What the model reads of a long Bash result. The tool's own record, and its
  // exit status, stay as they were for every tool.call hook.
  on('session.append', { door: 'tool-result' }, async ($, e, next) => {
    const isBash = e.origin.kind === 'tool' && 'tool' in e.origin && e.origin.tool === 'Bash'
    if (!isBash) return next(e)
    const content = await Promise.all(e.message.content.map(block => shrinkOutput($, block).catch(() => block)))
    if (content.every((block, at) => block === e.message.content[at])) return next(e)
    return next({ ...e, message: { ...e.message, content } })
  })

  on('prompt.submit', ($, e, next) => {
    void read($, undo)
      .then(held => (held === null ? undefined : $.state.set(UNDO, null)))
      .catch(() => undefined)
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear' || e.reason === 'resume') await reset($).catch(() => undefined)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const held = await read($, undo)
    if (held === null) return next(e)
    const below = await next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {below}
        {/* Wraps rather than truncates, so the line and its button always show whole. */}
        <Box flexDirection="row" flexWrap="wrap" columnGap={2} width={e.props.bodyColumns - MARKER}>
          <Box flexShrink={1}>
            <Text>
              🔫 Shrunk {grouped(held.before)} → {grouped(held.after)} lines
            </Text>
          </Box>
          {/* Digits press from an empty prompt; the Desk Neighbours split them so none clash (Shrink Ray 9). */}
          <Box flexShrink={0}>
            <Button key="shrink-undo" hotkey="9" plain label="Undo" onPress={() => void undoPaste($)} />
          </Box>
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const n = await read($, deflected)
    const label = n < 1 ? '🔫 armed' : `🔫 ${tokens(n)} deflected`
    const below = await next(e)
    const { Box, Button } = $.ui.resolve(e)
    const mine = <Button key="desk-4-shrink-ray" plain dimColor label={label} onPress={() => void togglePane($, PANE, TITLE)} />
    return joinDesk(below, mine, children => (
      <Box key={DESK} flexDirection="row" columnGap={2}>
        {children}
      </Box>
    ))
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const session = await read($, deflected)
    const total = await read($, lifetime)
    const list = await read($, shots)
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" marginBottom={1}>
          <Text bold>🔫 Shrink Ray</Text>
          <Text dimColor>
            {' '}
            · {tokens(session)} tokens deflected this session · {tokens(total)} all time
          </Text>
        </Box>
        {list.length === 0 && <Text dimColor>Nothing shrunk yet. Pastes over 80 lines and output over 150 get the ray.</Text>}
        {list.map((shot, index) => (
          <Box flexDirection="row" width={e.props.bodyColumns}>
            <Box width={7} flexShrink={0}>
              <Text dimColor>{clockTime(shot.at)}</Text>
            </Box>
            <Box width={8} flexShrink={0}>
              <Text>{shot.kind}</Text>
            </Box>
            <Box flexGrow={1} flexShrink={1}>
              <Text>
                {grouped(shot.before)} → {grouped(shot.after)} lines
              </Text>
            </Box>
            <Box flexShrink={0} marginLeft={2}>
              <Button
                key={`copy-${index}`}
                plain
                dimColor
                label="Copy original's path"
                onPress={press => void copyPath($, shot.path, press.surface)}
              />
            </Box>
          </Box>
        ))}
        <Box marginTop={1}>
          <Text dimColor>Claude can read any original by its path · esc closes</Text>
        </Box>
      </Box>
    )
  })
}
