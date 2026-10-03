import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { imageNumbers, imagesIn, kindOf, pngSize, rowsFor, toolLabel } from '../hooks/register'

// The first bytes of a real 200×120 PNG, padded out; only the header is read.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAMgAAAB4CAYAAAC3kr3rAAB/8ElEQVR4nBTT+U8I'
const JPEG = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8U'

// Not /home: macOS mounts that over the network, and the terminal is never handed such a path.
const HOME = '/Users/me'
const CWD = '/work/app'
const STORE = `${HOME}/.claude/show-and-tell/sess-1`
const CACHE = '/tmp/claude-501/-work-app/sess-1/images'

const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const
const PANE_PROPS = { title: 'x', isFocused: true, bodyColumns: 90, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } as const

type World = {
  clock: ReturnType<typeof mock.clock>
  files: Map<string, { base64: string; mtimeMs: number }>
  texts: Map<string, string>
  ran: string[][]
  box: { text: string }
  clipboard: string | null
}

function world(on: On): World {
  const w: World = { clock: mock.clock(on, { now: 1_000 }), files: new Map(), texts: new Map(), ran: [], box: { text: '' }, clipboard: null }
  mock.store(on)
  mock.env(on, { HOME })
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.cwd', () => ({ value: CWD }))
  on('fs.write', ($, e) => {
    w.texts.set(e.path, e.text)
    return { value: undefined }
  })
  on('fs.exists', ($, e) => ({
    value: w.files.has(e.path) || w.texts.has(e.path) || [...w.files.keys(), ...w.texts.keys()].some(p => p.startsWith(`${e.path}/`)),
  }))
  on('fs.stat', ($, e) => {
    const file = w.files.get(e.path)
    if (file === undefined) throw new Error(`ENOENT ${e.path}`)
    return { value: { kind: 'file' as const, size: file.base64.length, mtimeMs: file.mtimeMs, isLink: false } }
  })
  on('fs.read', ($, e) => {
    if (e.as === 'bytes') {
      const file = w.files.get(e.path)
      if (file === undefined) throw new Error(`ENOENT ${e.path}`)
      return { value: { base64: file.base64 } }
    }
    const text = w.texts.get(e.path)
    if (text === undefined) throw new Error(`ENOENT ${e.path}`)
    return { value: text }
  })
  on('fs.list', ($, e) => ({
    value: [...w.files.entries()]
      .filter(([p]) => p.startsWith(`${e.path}/`) && !p.slice(e.path.length + 1).includes('/'))
      .map(([p, f]) => ({ name: p.slice(e.path.length + 1), kind: 'file' as const, size: f.base64.length, mtimeMs: f.mtimeMs, isLink: false })),
  }))
  on('process.run', ($, e) => {
    const argv = [...e.argv]
    w.ran.push(argv)
    const ok = (stdout = '') => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    const fail = { value: { exitCode: 1, stdout: '', stderr: 'no', isStdoutTruncated: false, isStderrTruncated: false } }
    if (argv[0] === 'uname') return ok('Darwin\n')
    if (argv[0] === 'id') return ok('501\n')
    if (argv[0] === 'cp') {
      const from = w.files.get(argv[1] ?? '')
      if (from === undefined) return fail
      w.files.set(argv[2] ?? '', { ...from })
      return ok()
    }
    if (argv[0] === 'osascript') {
      if (w.clipboard === null) return fail
      w.files.set(argv.at(-1) ?? '', { base64: w.clipboard, mtimeMs: w.clock.now() })
      return ok()
    }
    if (argv[0] === 'sh' && argv[2]?.startsWith('base64')) {
      w.files.set(argv[4] ?? '', { base64: e.init?.stdin ?? '', mtimeMs: w.clock.now() })
      return ok()
    }
    if (argv[0] === 'sips') {
      w.files.set(argv.at(-1) ?? '', { base64: PNG, mtimeMs: w.clock.now() })
      return ok()
    }
    return ok()
  })
  on('prompt.read', () => ({ value: { text: w.box.text, cursor: w.box.text.length } }))
  on('prompt.fill', ($, e) => {
    w.box.text = e.mode === 'replace' ? e.text : w.box.text + e.text
    return { isFilled: true }
  })
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  return w
}

const start = ($: Engine) => $.session.start({ cwd: CWD, surface: 'terminal', isInteractive: true })

test('reads what a draft, a stored row and a picture header say', () => {
  expect(imageNumbers('[Image #1] look at [Image #12]')).toEqual([1, 12])
  expect(kindOf(PNG)).toBe('png')
  expect(kindOf(JPEG)).toBe('jpeg')
  expect(pngSize(PNG)).toEqual({ width: 200, height: 120 })
  expect(pngSize(JPEG)).toBe(null)
  // 200×120 at 16 columns: 16 × 120 / 200 / 2 ≈ 5 rows, capped by the room there is.
  expect(rowsFor(200, 120, 16, 8)).toBe(5)
  expect(rowsFor(100, 1000, 16, 8)).toBe(8)
  expect(toolLabel('mcp__claude-in-chrome__computer')).toBe('claude-in-chrome computer')
  const row = [
    { type: 'text', text: 'hi' },
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG } },
    { type: 'tool_result', tool_use_id: 't', content: [{ type: 'image', source: { type: 'base64', data: JPEG } }] },
  ]
  expect(imagesIn(row)).toEqual([PNG, JPEG])
})

test('a paste shows as a thumbnail the moment it lands, taken from Claude Code\'s own copy', async ($, on) => {
  const w = world(on)
  w.files.set(`${CACHE}/1.png`, { base64: PNG, mtimeMs: 1_000 })
  await start($)
  w.box.text = '[Image #1] '
  await w.clock.advance(250)

  const copy = w.ran.find(argv => argv[0] === 'cp')
  expect(copy?.[1]).toBe(`${CACHE}/1.png`)
  expect(copy?.[2]).toMatch(new RegExp(`^${STORE}/paste-.*\\.png$`))

  const band = await $.ui.mount({ plugin: 'show-and-tell', surface: 'terminal', ...BAND })
  const image = await band.find({ type: 'Image' })
  expect(image?.props.source).toEqual({ file: copy?.[2], format: 'png', generation: 1_250 })
  expect(image?.props.rows).toBe(5)
  expect(await band.find({ type: 'Text', text: /📎 Pasted image #1/ })).toBeDefined()

  // Still in the draft on the next look: taken once.
  await w.clock.advance(250)
  expect(w.ran.filter(argv => argv[0] === 'cp')).toHaveLength(1)

  // Sending it takes the paste's thumbnail down.
  await $.prompt.submit({ text: '[Image #1] what is this?', wait: false, origin: { kind: 'composer' } })
  expect(await band.find({ type: 'Image' })).toBeUndefined()
})

test('where Claude Code keeps no copy, the paste is read off the clipboard', async ($, on) => {
  const w = world(on)
  w.clipboard = PNG
  await start($)
  w.box.text = 'see [Image #3]'
  await w.clock.advance(250)
  const read = w.ran.find(argv => argv[0] === 'osascript')
  expect(read?.at(-1)).toMatch(new RegExp(`^${STORE}/paste-.*\\.png$`))
  const band = await $.ui.mount({ plugin: 'show-and-tell', surface: 'terminal', ...BAND })
  expect(await band.find({ type: 'Text', text: /Pasted image #3/ })).toBeDefined()
})

test('the band says it in words on a surface with no pictures, and goes after its time', async ($, on) => {
  const w = world(on)
  w.files.set(`${CACHE}/1.png`, { base64: PNG, mtimeMs: 1_000 })
  await start($)
  w.box.text = '[Image #1]'
  await w.clock.advance(250)
  const band = await $.ui.mount({ plugin: 'show-and-tell', surface: 'desktop', ...BAND })
  expect(await band.find({ type: 'Text', text: '📸 📎 Pasted image #1 · 200×120' })).toBeDefined()
  expect(await band.find({ key: 'band-gallery' })).toBeDefined()
  await w.clock.advance(20_000)
  expect(await band.find({ key: 'band-gallery' })).toBeUndefined()
})

test('a picture Claude writes joins the gallery, converted so the terminal can draw it', async ($, on) => {
  const w = world(on)
  on('tool.call', { tool: 'Write' }, ($, e) => {
    w.files.set(e.file_path, { base64: JPEG, mtimeMs: w.clock.now() })
    return { result: { type: 'create' as const, filePath: e.file_path, content: e.content, structuredPatch: [], originalFile: null } }
  })
  await start($)
  await $.tool.call({ tool: 'Write', file_path: `${CWD}/out/chart.jpg`, content: 'x' })
  await w.clock.settle()

  const sips = w.ran.find(argv => argv[0] === 'sips')
  expect(sips?.slice(0, 5)).toEqual(['sips', '-s', 'format', 'png', `${CWD}/out/chart.jpg`])

  const pane = await $.ui.mount({ plugin: 'show-and-tell', surface: 'terminal', component: 'Pane', requestId: 'show-and-tell', props: PANE_PROPS })
  expect(await pane.find({ type: 'Text', text: /🎨 chart\.jpg · 200×120/ })).toBeDefined()
  expect((await pane.find({ key: 'preview' }))?.props.source).toEqual({ file: sips?.at(-1), format: 'png', generation: 1_000 })

  await pane.press({ key: 'act-open' })
  expect(w.ran).toContainEqual(['open', `${CWD}/out/chart.jpg`])
  await pane.press({ key: 'act-insert' })
  expect(w.box.text).toBe(`@${CWD}/out/chart.jpg `)

  // The manifest keeps it for a resumed session.
  expect(JSON.parse(w.texts.get(`${STORE}/manifest.json`) ?? '[]')[0].path).toBe(`${CWD}/out/chart.jpg`)
})

test('a picture a shell command makes is found after it runs; older files are not', async ($, on) => {
  const w = world(on)
  w.files.set(`${CWD}/old.png`, { base64: PNG, mtimeMs: 500 })
  on('tool.call', { tool: 'Bash' }, () => {
    w.files.set(`${CWD}/shot.png`, { base64: PNG, mtimeMs: w.clock.now() })
    return { result: { stdout: '', stderr: '', interrupted: false }, text: '' }
  })
  await start($)
  await $.tool.call({ tool: 'Bash', command: 'playwright screenshot http://localhost:3000 shot.png' })
  await w.clock.settle()
  const pane = await $.ui.mount({ plugin: 'show-and-tell', surface: 'desktop', component: 'Pane', requestId: 'show-and-tell', props: PANE_PROPS })
  expect(await pane.find({ type: 'Text', text: /shot\.png/ })).toBeDefined()
  expect(await pane.find({ type: 'Button', text: /old\.png/ })).toBeUndefined()
  // No pictures on desktop: the preview is left out, the actions stay.
  expect(await pane.find({ key: 'preview' })).toBeUndefined()
  expect(await pane.find({ key: 'act-open' })).toBeDefined()
})

test('its hint item joins the shared row in key order, and a click opens the gallery', async ($, on) => {
  const opened: string[] = []
  on('ui.render', { component: 'PromptHint' }, ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    return (
      <Box key="desk-hint" flexDirection="row" columnGap={2}>
        <Text>? for shortcuts</Text>
        <Button key="desk-9-other" plain label="📎 other" onPress={() => undefined} />
        <Button key="desk-4-shrink-ray" plain label="🔫 armed" onPress={() => undefined} />
      </Box>
    )
  })
  on('ui.open', ($, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true as const } }
  })
  world(on)
  for (const surface of ['terminal', 'desktop'] as const) {
    const hint = await $.ui.mount({ plugin: 'show-and-tell', surface, component: 'PromptHint', props: { isDraft: false, isWorking: false, hint: '? for shortcuts' } })
    expect((await hint.findAll({ type: 'Button' })).map(b => b.text)).toEqual(['🔫 armed', '📸 gallery', '📎 other'])
    await hint.press({ key: 'desk-6-show-and-tell' })
    await hint.unmount()
  }
  expect(opened).toEqual(['show-and-tell', 'show-and-tell'])
})

test('kept images older than a week are pruned when a session starts', async ($, on) => {
  const w = world(on)
  w.texts.set(`${STORE}/manifest.json`, '[]')
  await start($)
  await w.clock.settle()
  expect(w.ran).toContainEqual(['find', `${HOME}/.claude/show-and-tell`, '-type', 'f', '-mtime', '+7', '-delete'])
})

for (const source of ['clear', 'resume'] as const) {
  test(`after /${source} the gallery loads again, minus files since removed`, async ($, on) => {
    const w = world(on)
    on('classic.SessionStart', () => ({}))
    const shot = (id: string, path: string) => ({ id, source: 'you', label: id, path, thumb: path, width: 200, height: 120, at: 1 })
    w.files.set(`${STORE}/a.png`, { base64: PNG, mtimeMs: 1 })
    w.texts.set(`${STORE}/manifest.json`, JSON.stringify([shot('kept', `${STORE}/a.png`), shot('gone', `${STORE}/b.png`)]))
    const labels = async () => {
      const pane = await $.ui.mount({ plugin: 'show-and-tell', surface: 'terminal', component: 'Pane', requestId: 'show-and-tell', props: PANE_PROPS })
      const found = (await pane.findAll({ type: 'Button' })).map(b => b.text).filter(t => /kept|gone/.test(t))
      await pane.unmount()
      return found
    }

    // A cleared or resumed session's state starts empty, and no session.start fires to fill it.
    expect(await labels()).toEqual([])
    await $.classic.SessionStart({ source })
    await w.clock.settle()
    expect(await labels()).toEqual([expect.stringMatching(/📎 kept · 200×120$/)])
  })
}
