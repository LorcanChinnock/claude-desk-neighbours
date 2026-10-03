import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement, RenderNode } from 'claude-code'

import type { Shot, ShotSource } from '../types'

const SHOTS = { plugin: 'show-and-tell', key: 'shots' } as const
const FRESH = { plugin: 'show-and-tell', key: 'fresh' } as const
const PICKED = { plugin: 'show-and-tell', key: 'picked' } as const
const FILTER = { plugin: 'show-and-tell', key: 'filter' } as const

const shots = atom(SHOTS, [])
const fresh = atom(FRESH, [])
const picked = atom(PICKED, null)
const filter = atom(FILTER, 'all')

const PANE = 'show-and-tell'
const TITLE = '📸 Show & Tell'

const POLL_MS = 250
const KEEP_DAYS = 7
const MAX_SHOTS = 200
const MAX_READ = 4 * 1024 * 1024
const THUMB_COLUMNS = 16
const PREVIEW_COLUMNS = 72
const SCAN_DIRS = 40

const PICTURE = /\.(png|jpe?g|gif|webp|bmp|tiff?|heic|svg|pdf)$/i
const VECTOR = /\.(svg|pdf)$/i
const IMAGE_TOKEN = /\[Image #(\d+)\]/g
const ICON: Record<ShotSource, string> = { you: '📎', 'claude-read': '👀', 'claude-made': '🎨' }

type Block = { type: string; [field: string]: unknown }
type Platform = 'mac' | 'linux' | 'windows'
type Look = { thumb: string | null; width: number | null; height: number | null }

/** The image numbers a draft holds, as Claude Code writes a paste into it: `[Image #2]`. */
export function imageNumbers(text: string): number[] {
  return [...text.matchAll(IMAGE_TOKEN)].map(match => Number(match[1]))
}

/** What kind of picture base64 bytes are, by their first bytes. */
export function kindOf(base64: string): 'png' | 'jpeg' | 'gif' | 'webp' | null {
  if (base64.startsWith('iVBORw0KGgo')) return 'png'
  if (base64.startsWith('/9j/')) return 'jpeg'
  if (base64.startsWith('R0lGOD')) return 'gif'
  if (base64.startsWith('UklGR')) return 'webp'
  return null
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** A PNG's width and height, read from its header. */
export function pngSize(base64: string): { width: number; height: number } | null {
  if (kindOf(base64) !== 'png' || base64.length < 32) return null
  const bytes: number[] = []
  for (let at = 0; at < 32; at += 4) {
    const n = [0, 1, 2, 3].reduce((acc, i) => (acc << 6) | BASE64.indexOf(base64[at + i] ?? 'A'), 0)
    bytes.push((n >> 16) & 255, (n >> 8) & 255, n & 255)
  }
  const word = (at: number) => (((bytes[at] ?? 0) << 24) | ((bytes[at + 1] ?? 0) << 16) | ((bytes[at + 2] ?? 0) << 8) | (bytes[at + 3] ?? 0)) >>> 0
  const width = word(16)
  const height = word(20)
  return width > 0 && height > 0 ? { width, height } : null
}

/** How many rows a picture `columns` wide needs; a terminal cell is about twice as tall as wide. */
export function rowsFor(width: number | null, height: number | null, columns: number, maxRows: number): number {
  const rows = width !== null && height !== null ? Math.round((columns * height) / width / 2) : Math.round(columns / 3)
  return Math.max(1, Math.min(maxRows, rows))
}

/** The base64 of every image block in a row's content, those inside a tool result included. */
export function imagesIn(content: readonly Block[]): string[] {
  const found: string[] = []
  for (const block of content) {
    if (block.type === 'image') {
      const source = block.source as { type?: unknown; data?: unknown } | undefined
      if (source?.type === 'base64' && typeof source.data === 'string') found.push(source.data)
    } else if (block.type === 'tool_result' && Array.isArray(block.content)) {
      found.push(...imagesIn(block.content as Block[]))
    }
  }
  return found
}

/** `mcp__claude-in-chrome__computer` reads as `claude-in-chrome computer`. */
export function toolLabel(tool: string): string {
  return tool.startsWith('mcp__') ? tool.slice(5).split('__').join(' ') : tool
}

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

function dirName(path: string): string {
  const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return at <= 0 ? path : path.slice(0, at)
}

/** "10:42" in local time. */
function clockTime(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

async function ran($: EngineInterface, argv: readonly string[], init?: { stdin?: string; env?: Record<string, string> }): Promise<boolean> {
  const done = await $.process.run(argv, init).catch(() => null)
  return done?.exitCode === 0
}

let platformOf: Promise<Platform> | null = null
let userOf: Promise<string | null> | null = null

function platform($: EngineInterface): Promise<Platform> {
  platformOf ??= (async (): Promise<Platform> => {
    if ((await $.env.get('WINDIR')) !== undefined) return 'windows'
    const uname = await $.process.run(['uname', '-s']).catch(() => null)
    return uname?.stdout.trim() === 'Darwin' ? 'mac' : 'linux'
  })()
  return platformOf
}

function userId($: EngineInterface): Promise<string | null> {
  userOf ??= $.process
    .run(['id', '-u'])
    .then(r => (r.exitCode === 0 ? r.stdout.trim() : null))
    .catch(() => null)
  return userOf
}

async function storeRoot($: EngineInterface): Promise<string | null> {
  const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE'))
  return home === undefined ? null : `${home}/.claude/show-and-tell`
}

async function sessionDir($: EngineInterface): Promise<string | null> {
  const root = await storeRoot($)
  if (root === null) return null
  const dir = `${root}/${await $.session.id()}`
  // `$.fs.write` makes the folders it needs; the shell copies below do not.
  if (!(await $.fs.exists(dir))) await $.fs.write(`${dir}/.keep`, '')
  return dir
}

let seq = 0

async function newId($: EngineInterface, prefix: string): Promise<{ id: string; at: number }> {
  const at = await $.clock.now()
  seq += 1
  return { id: `${prefix}-${at}-${seq}`, at }
}

async function writeBytes($: EngineInterface, path: string, base64: string): Promise<boolean> {
  if ((await platform($)) === 'windows') {
    const script = '[IO.File]::WriteAllBytes($env:SHOW_AND_TELL_OUT, [Convert]::FromBase64String([Console]::In.ReadToEnd()))'
    return ran($, ['powershell', '-NoProfile', '-Command', script], { stdin: base64, env: { SHOW_AND_TELL_OUT: path } })
  }
  return ran($, ['sh', '-c', 'base64 --decode > "$1"', 'sh', path], { stdin: base64 })
}

async function copyFile($: EngineInterface, from: string, to: string): Promise<boolean> {
  if ((await platform($)) === 'windows') {
    const script = 'Copy-Item -LiteralPath $env:SHOW_AND_TELL_FROM -Destination $env:SHOW_AND_TELL_OUT'
    return ran($, ['powershell', '-NoProfile', '-Command', script], { env: { SHOW_AND_TELL_FROM: from, SHOW_AND_TELL_OUT: to } })
  }
  return ran($, ['cp', from, to])
}

/** Writes the clipboard's picture to `path` as a PNG, with the tool each platform has. */
async function clipboardTo($: EngineInterface, path: string): Promise<boolean> {
  const os = await platform($)
  if (os === 'mac') {
    await ran($, [
      'osascript',
      '-e', 'on run argv',
      '-e', 'set f to open for access (POSIX file (item 1 of argv)) with write permission',
      '-e', 'set eof f to 0',
      '-e', 'write (the clipboard as «class PNGf») to f',
      '-e', 'close access f',
      '-e', 'end run',
      path,
    ])
  } else if (os === 'linux') {
    const read = 'wl-paste --no-newline --type image/png > "$1" 2>/dev/null || xclip -selection clipboard -t image/png -o > "$1"'
    await ran($, ['sh', '-c', read, 'sh', path])
  } else {
    const script =
      'Add-Type -AssemblyName System.Windows.Forms; $i = [System.Windows.Forms.Clipboard]::GetImage(); if ($i) { $i.Save($env:SHOW_AND_TELL_OUT) } else { exit 1 }'
    await ran($, ['powershell', '-NoProfile', '-STA', '-Command', script], { env: { SHOW_AND_TELL_OUT: path } })
  }
  const stat = await $.fs.stat(path).catch(() => null)
  return stat !== null && stat.size > 0
}

/** Where Claude Code keeps a pasted image the moment it lands in the draft. Not an API: when it
 * moves, the clipboard is read instead, and failing that the image is taken as the prompt is sent. */
async function pasteCache($: EngineInterface, n: number): Promise<string | null> {
  const uid = await userId($)
  if (uid === null) return null
  const base = (await $.env.get('CLAUDE_CODE_TMPDIR')) ?? '/tmp'
  const project = (await $.session.cwd()).replace(/[^A-Za-z0-9]/g, '-')
  const path = `${base}/claude-${uid}/${project}/${await $.session.id()}/images/${n}.png`
  return (await $.fs.exists(path)) ? path : null
}

async function sizeOf($: EngineInterface, png: string): Promise<{ width: number; height: number } | null> {
  const stat = await $.fs.stat(png).catch(() => null)
  if (stat === null || stat.size > MAX_READ) return null
  const { base64 } = await $.fs.read(png, { as: 'bytes' })
  return pngSize(base64)
}

/** A PNG of `file` the terminal can draw: the file itself when it is one, else one converted
 * into `dir`. Null where this machine has no converter for it. */
async function lookOf($: EngineInterface, file: string, dir: string, id: string): Promise<Look> {
  const size = await sizeOf($, file).catch(() => null)
  if (size !== null) return { thumb: file, ...size }
  const os = await platform($)
  let thumb: string | null = null
  if (os === 'mac' && VECTOR.test(file)) {
    const out = `${dir}/${id}`
    if ((await ran($, ['mkdir', '-p', out])) && (await ran($, ['qlmanage', '-t', '-s', '800', '-o', out, file]))) {
      thumb = `${out}/${baseName(file)}.png`
    }
  } else if (os === 'mac') {
    const out = `${dir}/${id}.thumb.png`
    if (await ran($, ['sips', '-s', 'format', 'png', file, '--out', out])) thumb = out
  } else {
    const out = `${dir}/${id}.thumb.png`
    const first = VECTOR.test(file) ? `${file}[0]` : file
    if ((await ran($, ['magick', first, out])) || (os === 'linux' && (await ran($, ['convert', first, out])))) thumb = out
  }
  if (thumb === null || !(await $.fs.exists(thumb))) return { thumb: null, width: null, height: null }
  const converted = await sizeOf($, thumb).catch(() => null)
  return { thumb, width: converted?.width ?? null, height: converted?.height ?? null }
}

let bandMs = 20_000

async function saveManifest($: EngineInterface): Promise<void> {
  const dir = await sessionDir($)
  if (dir !== null) await $.fs.write(`${dir}/manifest.json`, JSON.stringify(await read($, shots)))
}

async function loadManifest($: EngineInterface): Promise<void> {
  const root = await storeRoot($)
  const path = root === null ? null : `${root}/${await $.session.id()}/manifest.json`
  const saved = path !== null && (await $.fs.exists(path)) ? (JSON.parse(await $.fs.read(path)) as Shot[]) : []
  const kept: Shot[] = []
  for (const shot of saved) {
    if (!(await $.fs.exists(shot.path))) continue
    const hasThumb = shot.thumb !== null && (await $.fs.exists(shot.thumb))
    kept.push(hasThumb ? shot : { ...shot, thumb: null })
  }
  await $.state.set(SHOTS, kept)
}

async function addShot($: EngineInterface, shot: Shot, isFresh: boolean): Promise<void> {
  await update($, shots, list =>
    [shot, ...list.filter(s => s.id !== shot.id && (shot.source === 'you' || s.path !== shot.path))].slice(0, MAX_SHOTS),
  )
  await saveManifest($)
  if (!isFresh) return
  await update($, fresh, ids => [shot.id, ...ids.filter(id => id !== shot.id)].slice(0, 8))
  $.clock.after(bandMs, () => void update($, fresh, ids => ids.filter(id => id !== shot.id)).catch(() => undefined))
}

/** Takes a paste the moment its `[Image #N]` shows in the draft. */
async function capturePaste($: EngineInterface, n: number): Promise<void> {
  const known = (await read($, shots)).some(s => s.source === 'you' && s.imageNo === n && s.isSent !== true)
  if (known) return
  const dir = await sessionDir($)
  if (dir === null) return
  const { id, at } = await newId($, 'paste')
  const path = `${dir}/${id}.png`
  const cached = await pasteCache($, n).catch(() => null)
  const isTaken = cached !== null ? await copyFile($, cached, path) : await clipboardTo($, path)
  if (!isTaken) return
  const look = await lookOf($, path, dir, id)
  await addShot($, { id, source: 'you', label: `Pasted image #${n}`, path, ...look, at, imageNo: n }, true)
}

async function saveBytes($: EngineInterface, base64: string, source: ShotSource, label: string, isFresh: boolean, imageNo?: number): Promise<void> {
  const kind = kindOf(base64)
  if (kind === null) return
  const dir = await sessionDir($)
  if (dir === null) return
  const { id, at } = await newId($, source)
  const path = `${dir}/${id}.${kind === 'jpeg' ? 'jpg' : kind}`
  if (!(await writeBytes($, path, base64))) return
  const size = pngSize(base64)
  const look = size !== null ? { thumb: path, ...size } : await lookOf($, path, dir, id)
  await addShot($, { id, source, label, path, ...look, at, ...(imageNo !== undefined ? { imageNo, isSent: true } : {}) }, isFresh)
}

/** A prompt's images as it is stored: a paste already taken is marked sent, any other is kept now. */
async function takePrompt($: EngineInterface, images: readonly string[], numbers: readonly number[]): Promise<void> {
  for (const [index, base64] of images.entries()) {
    const n = numbers[index]
    const list = await read($, shots)
    const taken = list.find(s => s.source === 'you' && s.imageNo === n && s.isSent !== true)
    if (taken !== undefined) {
      await update($, shots, all => all.map(s => (s.id === taken.id ? { ...s, isSent: true } : s)))
      continue
    }
    await saveBytes($, base64, 'you', n === undefined ? 'Sent image' : `Image #${n}`, false, n)
  }
  await saveManifest($)
}

/** A file Claude read or made, shown where it lies; only a converted thumbnail is the plugin's. */
async function keepFile($: EngineInterface, file: string, source: ShotSource): Promise<void> {
  const dir = await sessionDir($)
  if (dir === null) return
  const { id, at } = await newId($, source)
  const look = await lookOf($, file, dir, id)
  await addShot($, { id, source, label: baseName(file), path: file, ...look, at }, true)
}

/** Pictures a shell command wrote: the working directory and the folders just inside it. */
async function scanMade($: EngineInterface, since: number): Promise<void> {
  const cwd = await $.session.cwd()
  const root = await storeRoot($)
  const top = await $.fs.list(cwd).catch(() => [])
  const dirs = [cwd, ...top.filter(e => e.kind === 'dir' && !e.name.startsWith('.') && e.name !== 'node_modules').map(e => `${cwd}/${e.name}`)]
  const made: string[] = []
  for (const dir of dirs.slice(0, SCAN_DIRS)) {
    const entries = dir === cwd ? top : await $.fs.list(dir).catch(() => [])
    for (const entry of entries) {
      const path = `${dir}/${entry.name}`
      if (entry.kind === 'file' && PICTURE.test(entry.name) && entry.mtimeMs >= since && (root === null || !path.startsWith(root))) made.push(path)
    }
  }
  for (const path of made.slice(0, 12)) await keepFile($, path, 'claude-made')
}

/** Removes kept images older than a week. `$.fs` cannot delete, so this asks `find`; where there is
 * no `find` (Windows) the call fails and the images stay. */
async function prune($: EngineInterface): Promise<void> {
  const root = await storeRoot($)
  if (root === null || !(await $.fs.exists(root))) return
  await $.process.run(['find', root, '-type', 'f', '-mtime', `+${KEEP_DAYS}`, '-delete'])
  await $.process.run(['find', root, '-mindepth', '1', '-type', 'd', '-empty', '-delete'])
}

let seen: number[] = []
let isPolling = false
// The image numbers of the prompt being sent, matched in order to the image blocks it is stored with.
let sending: number[] = []

async function poll($: EngineInterface): Promise<void> {
  if (isPolling) return
  isPolling = true
  try {
    const now = imageNumbers((await $.prompt.read()).text)
    const added = now.filter(n => !seen.includes(n))
    seen = now
    for (const n of added) await capturePaste($, n)
  } finally {
    isPolling = false
  }
}

async function openFile($: EngineInterface, path: string): Promise<void> {
  const os = await platform($)
  const argv = os === 'mac' ? ['open', path] : os === 'linux' ? ['xdg-open', path] : ['cmd', '/c', 'start', '', path]
  if (!(await ran($, argv))) $.ui.toast(`📸 Could not open ${path}`)
}

async function showInFolder($: EngineInterface, path: string): Promise<void> {
  const os = await platform($)
  const argv = os === 'mac' ? ['open', '-R', path] : os === 'linux' ? ['xdg-open', dirName(path)] : ['explorer', `/select,${path}`]
  // Explorer exits 1 even when it opens the folder.
  if (!(await ran($, argv)) && os !== 'windows') $.ui.toast(`📸 Could not open ${dirName(path)}`)
}

async function copyPath($: EngineInterface, path: string, surface: 'terminal' | 'desktop' | 'mobile' | 'vscode'): Promise<void> {
  const copied = await $.ui.copy({ text: path, surface })
  $.ui.toast(copied.isCopied ? '📸 Path copied' : `📸 ${path}`)
}

async function insertPath($: EngineInterface, path: string): Promise<void> {
  await $.ui.close({ id: PANE })
  await $.prompt.fill({ text: `@${path} `, mode: 'insert' })
}

async function dropPastes($: EngineInterface): Promise<void> {
  const list = await read($, shots)
  await update($, fresh, ids => ids.filter(id => list.find(s => s.id === id)?.source !== 'you'))
}

async function reset($: EngineInterface): Promise<void> {
  seen = []
  await $.state.set(SHOTS, [])
  await $.state.set(FRESH, [])
  await $.state.set(PICKED, null)
}

// The hint line under the prompt is shared. Each Desk Neighbours mod adds one clickable item to
// a row keyed `desk-hint` after the engine's own hint; items are kept in order by their keys
// (`desk-1-…` to `desk-6-…`), so the row reads the same alone or together, in any load order.
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

function sizeText(shot: Shot): string {
  return shot.width !== null && shot.height !== null ? ` · ${shot.width}×${shot.height}` : ''
}

const SOURCE_WORD: Record<ShotSource, string> = { you: 'you pasted', 'claude-read': 'Claude looked at', 'claude-made': 'Claude made' }

export const register: Register = (on, options) => {
  bandMs = Number(options.bandSeconds ?? 20) * 1000

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'gallery', description: '📸 Every image you and Claude passed around this session' })
    void loadManifest($).catch(() => undefined)
    void prune($).catch(() => undefined)
    if (e.isInteractive) $.clock.every(POLL_MS, () => void poll($).catch(() => undefined))
    return next(e)
  })

  on('command.run', { command: 'gallery' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE, focus: true, closeOnEscape: true })
    return { text: '📸 Gallery open. Esc closes.' }
  })

  on('prompt.submit', ($, e, next) => {
    sending = imageNumbers(e.text)
    void dropPastes($).catch(() => undefined)
    return next(e)
  })

  // The image bytes first reach a plugin here, as the prompt or a tool's result is stored. The row
  // passes on untouched; what it carries is copied out beside it.
  on('session.append', { door: 'prompt' }, ($, e, next) => {
    const images = imagesIn(e.message.content)
    if (images.length > 0) {
      const numbers = sending
      sending = []
      void takePrompt($, images, numbers).catch(() => undefined)
    }
    return next(e)
  })

  on('session.append', { door: 'tool-result' }, ($, e, next) => {
    // A Read keeps the file it read (below); every other tool's picture exists only here.
    const tool = e.origin.kind === 'tool' && 'tool' in e.origin ? e.origin.tool : null
    if (tool !== null && tool !== 'Read') {
      for (const base64 of imagesIn(e.message.content)) {
        void saveBytes($, base64, 'claude-read', toolLabel(tool), true).catch(() => undefined)
      }
    }
    return next(e)
  })

  on('tool.call', { tool: 'Read' }, async ($, e, next) => {
    const done = await next(e)
    if (done.deny === undefined && done.isError !== true && PICTURE.test(e.file_path)) {
      void keepFile($, e.file_path, 'claude-read').catch(() => undefined)
    }
    return done
  })

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const done = await next(e)
    if (done.deny === undefined && done.isError !== true && PICTURE.test(e.file_path)) {
      void keepFile($, e.file_path, 'claude-made').catch(() => undefined)
    }
    return done
  })

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const done = await next(e)
    if (done.deny === undefined && done.isError !== true && PICTURE.test(e.file_path)) {
      void keepFile($, e.file_path, 'claude-made').catch(() => undefined)
    }
    return done
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const since = await $.clock.now()
    const done = await next(e)
    if (done.deny === undefined) void scanMade($, since).catch(() => undefined)
    return done
  })

  // `/clear` and `/resume` go on under a new session with empty state and fire no `session.start`;
  // their classic SessionStart (source `clear` or `resume`) is the one place to load the gallery again.
  on('classic.SessionStart', ($, e, next) => {
    if (e.source === 'clear' || e.source === 'resume') void loadManifest($).catch(() => undefined)
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear' || e.reason === 'resume') await reset($).catch(() => undefined)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const ids = await read($, fresh)
    const list = await read($, shots)
    const showing = ids.map(id => list.find(s => s.id === id)).filter((s): s is Shot => s !== undefined)
    if (showing.length === 0) return next(e)
    const below = await next(e)
    const width = e.props.bodyColumns - MARKER
    const fits = Math.max(1, Math.floor((width - 22) / (THUMB_COLUMNS + 2)))
    const thumbRows = e.props.maxRows - 2
    if (e.surface === 'terminal' && thumbRows >= 3) {
      const { Box, Text, Button, Image } = $.ui.resolve(e)
      return (
        <Box flexDirection="column">
          {below}
          <Box flexDirection="row" columnGap={2} width={width}>
            {showing.slice(0, fits).map(shot => (
              <Box flexDirection="column" width={THUMB_COLUMNS} flexShrink={0}>
                {/* The label is under it, so where the terminal draws no pixels the alt says the size. */}
                {shot.thumb !== null && (
                  <Image
                    key={`band-${shot.id}`}
                    source={{ file: shot.thumb, format: 'png', generation: shot.at }}
                    columns={THUMB_COLUMNS}
                    rows={rowsFor(shot.width, shot.height, THUMB_COLUMNS, thumbRows)}
                    alt={shot.width !== null && shot.height !== null ? `${shot.width}×${shot.height}` : 'picture'}
                  />
                )}
                <Text dimColor wrap="truncate-end">
                  {ICON[shot.source]} {shot.label}
                </Text>
              </Box>
            ))}
            <Box flexDirection="column" flexShrink={0}>
              {showing.length > fits && <Text dimColor>+{showing.length - fits} more</Text>}
              <Button key="band-gallery" plain label="Gallery" onPress={() => void $.ui.open({ id: PANE, title: TITLE, focus: true, closeOnEscape: true })} />
              <Button key="band-dismiss" plain dimColor label="Dismiss" onPress={() => void $.state.set(FRESH, [])} />
            </Box>
          </Box>
        </Box>
      )
    }
    const { Box, Text, Button } = $.ui.resolve(e)
    const [first] = showing
    return (
      <Box flexDirection="column">
        {below}
        <Box flexDirection="row" flexWrap="wrap" columnGap={2} width={width}>
          <Box flexShrink={1}>
            <Text>
              📸 {first === undefined ? '' : `${ICON[first.source]} ${first.label}${sizeText(first)}`}
              {showing.length > 1 ? ` and ${showing.length - 1} more` : ''}
            </Text>
          </Box>
          <Box flexShrink={0}>
            <Button key="band-gallery" plain label="Gallery" onPress={() => void $.ui.open({ id: PANE, title: TITLE, focus: true, closeOnEscape: true })} />
          </Box>
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const n = (await read($, shots)).length
    const label = n === 0 ? '📸 gallery' : `📸 ${n}`
    const below = await next(e)
    const { Box, Button } = $.ui.resolve(e)
    const mine = <Button key="desk-6-show-and-tell" plain dimColor label={label} onPress={() => void togglePane($, PANE, TITLE)} />
    return joinDesk(below, mine, children => (
      <Box key={DESK} flexDirection="row" columnGap={2}>
        {children}
      </Box>
    ))
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const all = await read($, shots)
    const which = await read($, filter)
    const pickedId = await read($, picked)
    const list = all.filter(s => which === 'all' || (which === 'you' ? s.source === 'you' : s.source !== 'you'))
    const current = list.find(s => s.id === pickedId) ?? list[0]
    const columns = Math.min(e.props.bodyColumns - 2, PREVIEW_COLUMNS)
    const tabs = (['all', 'you', 'claude'] as const).map(f => ({ f, label: f === 'all' ? 'All' : f === 'you' ? 'You' : 'Claude', hotkey: f[0] }))
    const { Box, Text, Button } = $.ui.resolve(e)
    const preview =
      current?.thumb != null && e.surface === 'terminal'
        ? (() => {
            const { Image } = $.ui.resolve(e)
            return (
              <Image
                key="preview"
                source={{ file: current.thumb, format: 'png', generation: current.at }}
                columns={columns}
                rows={rowsFor(current.width, current.height, columns, 20)}
                alt="This terminal shows no pictures; o opens it"
              />
            )
          })()
        : null
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" marginBottom={1}>
          <Text bold>📸 Show & Tell</Text>
          <Text dimColor>
            {' '}
            · {all.length} image{all.length === 1 ? '' : 's'} this session
          </Text>
        </Box>
        <Box flexDirection="row" columnGap={2} marginBottom={1}>
          {tabs.map(t => (
            <Button key={`tab-${t.f}`} hotkey={t.hotkey} plain dimColor={t.f !== which} label={t.label} onPress={() => void $.state.set(FILTER, t.f)} />
          ))}
        </Box>
        {current === undefined && <Text dimColor>Nothing yet. Paste an image with ctrl+v, or let Claude read or make one.</Text>}
        {current !== undefined && (
          <Box flexDirection="column" marginBottom={1}>
            {preview}
            <Text bold wrap="truncate-end">
              {ICON[current.source]} {current.label}
              {sizeText(current)}
            </Text>
            <Text dimColor wrap="truncate-end">
              {SOURCE_WORD[current.source]} at {clockTime(current.at)} · {current.path}
            </Text>
            <Box flexDirection="row" columnGap={2}>
              <Button key="act-open" hotkey="o" plain label="Open" autoFocus onPress={() => void openFile($, current.path)} />
              <Button key="act-insert" hotkey="i" plain label="Insert @path" onPress={() => void insertPath($, current.path)} />
              <Button key="act-copy" hotkey="p" plain label="Copy path" onPress={press => void copyPath($, current.path, press.surface)} />
              <Button key="act-folder" hotkey="f" plain label="Show in folder" onPress={() => void showInFolder($, current.path)} />
            </Box>
          </Box>
        )}
        {list.slice(0, 30).map(shot => (
          <Button
            key={`pick-${shot.id}`}
            plain
            dimColor={shot.id !== current?.id}
            label={`${shot.id === current?.id ? '›' : ' '} ${clockTime(shot.at)}  ${ICON[shot.source]} ${shot.label}${sizeText(shot)}`}
            onPress={() => void $.state.set(PICKED, shot.id)}
          />
        ))}
        <Box marginTop={1}>
          <Text dimColor>Kept {KEEP_DAYS} days · tab walks the list · esc closes</Text>
        </Box>
      </Box>
    )
  })
}
