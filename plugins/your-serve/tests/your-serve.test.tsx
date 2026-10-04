import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { looksLikeAsk, toServe } from '../hooks/register'

const USAGE = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const
const ASKED = 'I refactored the loader.\n\nShould I keep the old cache or drop it?'
const VERDICT = JSON.stringify({
  needsInput: true,
  questions: [
    {
      question: 'Keep the old cache or drop it?',
      options: [
        { label: 'Keep', reply: 'Keep the old cache.' },
        { label: 'Drop', reply: 'Drop the old cache.' },
      ],
    },
  ],
})

function beneath(on: On, verdict: string, box: { text: string }): { asked: number; toasts: string[] } {
  const seen = { asked: 0, toasts: [] as string[] }
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('model.complete', () => {
    seen.asked += 1
    return { value: { isAnswered: true as const, text: verdict, usage: USAGE } }
  })
  on('ui.toast', ($, e) => {
    seen.toasts.push(e.text)
    return { value: undefined }
  })
  on('prompt.read', () => ({ value: { text: box.text, cursor: box.text.length } }))
  on('prompt.fill', ($, e) => {
    box.text = e.mode === 'append' ? box.text + e.text : e.text
    return { isFilled: true }
  })
  return seen
}

const turn = (answer: string, durationMs = 5000) => ({ answer, durationMs, isAborted: false, turnId: 't1', reason: 'answer' as const })

test('only answers that end by asking are read', async () => {
  expect(looksLikeAsk(ASKED)).toBe(true)
  expect(looksLikeAsk('Done. The tests pass.')).toBe(false)
  expect(looksLikeAsk('Two ways:\n1. keep it\n2. drop it')).toBe(true)
})

test('the question and answer labels show whole, up to 200 and 40 characters', () => {
  const question = 'Which approach do you want: replace the cache with a Postgres check, delete it, or keep it as a fast path?'
  expect(toServe({ needsInput: true, questions: [{ question, options: [] }] })?.questions[0]?.question).toBe(question)
  const serve = toServe({
    needsInput: true,
    questions: [
      {
        question: 'Where should formatMinor live?',
        options: [
          { label: 'Keep it in src/money.js', reply: 'Keep it in src/money.js.' },
          { label: 'Move it to its own file under src/format', reply: 'Move it.' },
        ],
      },
    ],
  })
  expect(serve?.questions[0]?.options.map(o => o.label)).toEqual(['Keep it in src/money.js', 'Move it to its own file under src/format'])
  const long = toServe({ needsInput: true, questions: [{ question: 'Q?', options: [{ label: 'x'.repeat(60), reply: 'x' }] }] })
  expect(long?.questions[0]?.options[0]?.label).toHaveLength(40)
})

test('every question is kept in order, however many, and empty ones dropped', () => {
  const asked = ['A?', 'B?', 'C?', 'D?', 'E?', 'F?', 'G?', 'H?', 'I?', 'J?']
  const questions = ['', ...asked].map(question => ({ question, options: [] }))
  expect(toServe({ needsInput: true, questions })?.questions.map(q => q.question)).toEqual(asked)
  expect(toServe({ needsInput: true, questions: [] })).toBeNull()
  expect(toServe({ needsInput: false, questions })).toBeNull()
})

test('a question becomes the top band line, and an option fills the prompt', async ($, on) => {
  const clock = mock.clock(on)
  const box = { text: '' }
  const seen = beneath(on, VERDICT, box)

  await $.turn.complete(turn(ASKED))
  await clock.settle()

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'your-serve', surface, ...BAND })
    expect(await ui.find({ type: 'Text', text: /🎾 Your serve: Keep the old cache or drop it\?/ })).toBeDefined()
    expect(await ui.findAll({ type: 'Button' })).toHaveLength(2)
    await ui.unmount()
  }

  const ui = await $.ui.mount({ plugin: 'your-serve', surface: 'terminal', ...BAND })
  expect((await ui.findAll({ type: 'Button' })).map(b => b.props.hotkey)).toEqual(['1', '2'])
  await ui.press({ key: 'serve-2' })
  expect(box.text).toBe('Drop the old cache.')
  box.text = 'Also,'
  await ui.press({ key: 'serve-1' })
  expect(box.text).toBe('Also, Keep the old cache.')
  expect(seen.toasts).toEqual([])

  await $.prompt.submit({ text: 'Drop it', wait: false, origin: { kind: 'composer' } })
  await clock.settle()
  expect(await ui.find({ type: 'Text', text: /Your serve/ })).toBeUndefined()
})

test('several questions are asked one at a time, then all answers fill the prompt as one reply', async ($, on) => {
  const clock = mock.clock(on)
  const box = { text: '' }
  const verdict = JSON.stringify({
    needsInput: true,
    questions: [
      { question: 'Keep the old cache or drop it?', options: [{ label: 'Keep', reply: 'Keep the old cache.' }, { label: 'Drop', reply: 'Drop the old cache.' }] },
      { question: 'What should the new timeout be?', options: [] },
      { question: 'Add a retry?', options: [{ label: 'Yes', reply: 'Yes, add a retry.' }, { label: 'No', reply: 'No retry.' }] },
    ],
  })
  const closed: string[] = []
  on('ui.close', ($, e) => {
    closed.push(e.id)
    return { value: undefined }
  })
  beneath(on, verdict, box)
  await $.turn.complete(turn('1. Should I keep the old cache?\n2. What timeout?\n3. Add a retry?'))
  await clock.settle()

  const ui = await $.ui.mount({ plugin: 'your-serve', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Text', text: '🎾 Your serve (1/3): Keep the old cache or drop it?' })).toBeDefined()
  expect((await ui.findAll({ type: 'Button' })).map(b => b.text)).toEqual(['Keep', 'Drop', 'other', 'skip'])
  await ui.press({ key: 'serve-2' })
  expect(box.text).toBe('')

  expect(await ui.find({ type: 'Text', text: '🎾 Your serve (2/3): What should the new timeout be?' })).toBeDefined()
  expect((await ui.findAll({ type: 'Button' })).map(b => b.text)).toEqual(['other', 'skip'])
  await ui.press({ key: 'serve-skip' })
  expect(box.text).toBe('')

  expect(await ui.find({ type: 'Text', text: '🎾 Your serve (3/3): Add a retry?' })).toBeDefined()
  const pane = await $.ui.mount({
    plugin: 'your-serve',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'your-serve',
    props: { title: 'x', isFocused: true, bodyColumns: 90, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
  })
  expect(await pane.find({ type: 'Text', text: '1. Keep the old cache or drop it? Drop the old cache.' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: '2. What should the new timeout be? (skipped, type it in the prompt)' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: '3. Add a retry?' })).toBeDefined()
  await pane.unmount()
  expect(closed).toEqual([])

  await ui.press({ key: 'serve-1' })
  expect(box.text).toBe('1. Keep the old cache or drop it? Drop the old cache.\n2. What should the new timeout be?\n3. Add a retry? Yes, add a retry.')
  expect(await ui.find({ type: 'Text', text: '🎾 Your serve: all 3 answers are in your prompt' })).toBeDefined()
  expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)

  await $.prompt.submit({ text: box.text, wait: false, origin: { kind: 'composer' } })
  await clock.settle()
  expect(await ui.find({ type: 'Text', text: /Your serve/ })).toBeUndefined()
})

test('other swaps the answers for a field, and what is typed answers that question', async ($, on) => {
  const clock = mock.clock(on)
  const box = { text: '' }
  const verdict = JSON.stringify({
    needsInput: true,
    questions: [
      { question: 'Keep the old cache or drop it?', options: [{ label: 'Keep', reply: 'Keep the old cache.' }, { label: 'Drop', reply: 'Drop the old cache.' }] },
      { question: 'What should the new timeout be?', options: [{ label: '30s', reply: 'Make it 30 seconds.' }] },
      { question: 'Add a retry?', options: [{ label: 'Yes', reply: 'Yes, add a retry.' }] },
    ],
  })
  on('ui.close', () => ({ value: undefined }))
  beneath(on, verdict, box)
  await $.turn.complete(turn('1. Should I keep the old cache?\n2. What timeout?\n3. Add a retry?'))
  await clock.settle()

  const ui = await $.ui.mount({ plugin: 'your-serve', surface: 'terminal', ...BAND })
  expect(await ui.find({ type: 'Input' })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 'serve-other' })).toBeDefined()
  await ui.press({ key: 'serve-other' })
  // The field takes the button's key, so the focus ring on the button lands on it.
  expect(await ui.find({ type: 'Input', key: 'serve-other' })).toBeDefined()
  expect((await ui.findAll({ type: 'Button' })).map(b => b.text)).toEqual(['skip'])
  await ui.input({ key: 'serve-other', text: '  Keep it,\n but cap it at 1GB.  ' })
  expect(box.text).toBe('')

  // The next question starts on its own answers again.
  expect(await ui.find({ type: 'Text', text: '🎾 Your serve (2/3): What should the new timeout be?' })).toBeDefined()
  expect(await ui.find({ type: 'Input' })).toBeUndefined()
  expect((await ui.findAll({ type: 'Button' })).map(b => b.text)).toEqual(['30s', 'other', 'skip'])
  await ui.press({ key: 'serve-other' })
  await ui.input({ key: 'serve-other', text: '   ' })

  const pane = await $.ui.mount({
    plugin: 'your-serve',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'your-serve',
    props: { title: 'x', isFocused: true, bodyColumns: 90, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
  })
  expect(await pane.find({ type: 'Text', text: '1. Keep the old cache or drop it? Keep it, but cap it at 1GB.' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: '2. What should the new timeout be? (skipped, type it in the prompt)' })).toBeDefined()
  await pane.press({ key: 'pane-serve-other' })
  expect(await pane.find({ type: 'Input', key: 'pane-serve-other' })).toBeDefined()
  expect(await ui.find({ type: 'Input', key: 'serve-other' })).toBeDefined()
  await pane.input({ key: 'pane-serve-other', text: 'Only on timeouts.' })
  await pane.unmount()

  expect(box.text).toBe('1. Keep the old cache or drop it? Keep it, but cap it at 1GB.\n2. What should the new timeout be?\n3. Add a retry? Only on timeouts.')
})

test('a long turn also toasts; statements and subagents stay silent', async ($, on) => {
  const clock = mock.clock(on)
  const seen = beneath(on, VERDICT, { text: '' })

  await $.turn.complete(turn('All done. Tests pass.'))
  await $.turn.complete({ ...turn(ASKED), agentId: 'sub-1' })
  await clock.settle()
  expect(seen.asked).toBe(0)

  await $.turn.complete(turn(ASKED, 90_000))
  await clock.settle()
  expect(seen.toasts).toEqual(['🎾 Claude needs a decision'])
})

test('the serve line sits above whatever the band already holds', async ($, on) => {
  const clock = mock.clock(on)
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>🧾 a line from a mod beneath</Text>
  })
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('model.complete', () => ({ value: { isAnswered: true as const, text: VERDICT, usage: USAGE } }))
  await $.turn.complete(turn(ASKED))
  await clock.settle()
  const ui = await $.ui.mount({ plugin: 'your-serve', surface: 'terminal', ...BAND })
  const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
  expect(texts).toEqual(['🎾 Your serve: Keep the old cache or drop it?', '🧾 a line from a mod beneath'])
})

test('its hint item joins the shared row in key order, and a click opens its pane', async ($, on) => {
  const opened: string[] = []
  on('ui.render', { component: 'PromptHint' }, ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    return (
      <Box key="desk-hint" flexDirection="row" columnGap={2}>
        <Text>? for shortcuts</Text>
        <Button key="desk-9-other" plain label="📎 other" onPress={() => undefined} />
        <Button key="desk-0-first" plain label="🥇 first" onPress={() => undefined} />
      </Box>
    )
  })
  on('ui.panes', () => ({ value: [] }))
  on('ui.open', ($, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true as const } }
  })
  for (const surface of ['terminal', 'desktop'] as const) {
    const hint = await $.ui.mount({
      plugin: 'your-serve',
      surface,
      component: 'PromptHint',
      props: { isDraft: false, isWorking: false, hint: '? for shortcuts' },
    })
    expect((await hint.findAll({ type: 'Button' })).map(b => b.text)).toEqual(['🥇 first', '🎾 ready', '📎 other'])
    await hint.press({ key: 'desk-2-your-serve' })
    await hint.unmount()
  }
  expect(opened).toEqual(['your-serve', 'your-serve'])

  for (const surface of ['terminal', 'desktop'] as const) {
    const pane = await $.ui.mount({
      plugin: 'your-serve',
      surface,
      component: 'Pane',
      requestId: 'your-serve',
      props: { title: 'x', isFocused: true, bodyColumns: 90, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
    })
    expect(await pane.find({ type: 'Text', text: '🎾 Your Serve' })).toBeDefined()
    await pane.unmount()
  }
})
