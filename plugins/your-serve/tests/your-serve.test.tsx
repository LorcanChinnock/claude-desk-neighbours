import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { ASK } from '../hooks/register'

function sent(on: On): string[] {
  const texts: string[] = []
  on('prompt.submit', ($, e) => {
    if (e.origin.kind === 'plugin') {
      // Framed as the plugin's message, not passed off as the person's words.
      expect(e.origin.asUser).toBeUndefined()
      texts.push(e.text)
    }
    return { text: e.text }
  })
  return texts
}

test('the status row button sits in key order and asks Claude for its questions', async ($, on) => {
  const texts = sent(on)
  on('ui.render', ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    return (
      <Box key="desk-hint" flexDirection="row" columnGap={2}>
        <Text>? for shortcuts</Text>
        <Button key="desk-9-other" plain label="📎 other" onPress={() => undefined} />
        <Button key="desk-0-first" plain label="🥇 first" onPress={() => undefined} />
      </Box>
    )
  })
  for (const surface of ['terminal', 'desktop'] as const) {
    for (const isWorking of [false, true]) {
      const hint = await $.ui.mount({
        plugin: 'your-serve',
        surface,
        component: 'PromptHint',
        props: { isDraft: false, isWorking, hint: '? for shortcuts' },
      })
      expect((await hint.findAll({ type: 'Button' })).map(b => b.text)).toEqual(['🥇 first', '🎾 your serve', '📎 other'])
      await hint.press({ key: 'desk-2-your-serve' })
      await hint.unmount()
    }
  }
  expect(texts).toEqual([ASK, ASK, ASK, ASK])
})

test('the button joins a plain hint line when no other neighbour has drawn the row', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>? for shortcuts</Text>
  })
  const hint = await $.ui.mount({
    plugin: 'your-serve',
    surface: 'terminal',
    component: 'PromptHint',
    props: { isDraft: false, isWorking: false, hint: '? for shortcuts' },
  })
  expect(await hint.find({ type: 'Text', text: '? for shortcuts' })).toBeDefined()
  expect((await hint.findAll({ type: 'Button' })).map(b => b.text)).toEqual(['🎾 your serve'])
})

test('/your-serve sends the same ask once the command is done', async ($, on) => {
  const clock = mock.clock(on)
  const texts = sent(on)
  const { text } = await $.command.run({
    command: 'your-serve',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 100 },
  })
  expect(text).toBe('🎾 Over to Claude for its questions')
  expect(texts).toEqual([])
  await clock.advance(1)
  await clock.settle()
  expect(texts).toEqual([ASK])
})

test('the ask names AskUserQuestion and one question per call', () => {
  expect(ASK).toContain('AskUserQuestion')
  expect(ASK).toContain('one question per call')
})
