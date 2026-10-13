import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { cleanTitle, labelOf } from '../hooks/register'

const USAGE = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const turn = { answer: 'Done.', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' as const }
const prompt = (session_title?: string) => ({ prompt: 'next', source: 'user' as const, session_title })
const settle = () => new Promise(resolve => setTimeout(resolve, 0))

/** The world beneath the plugin: a session with `turns` prompts sent, and a model that names it. */
function world(on: On, turns: number, reply = '"Retry the webhook handler."\nbecause'): { asked: number; turns: number } {
  const seen = { asked: 0, turns }
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('session.turns', () => ({ value: seen.turns }))
  on('session.messages', () => ({
    value: [
      { role: 'user' as const, text: 'webhooks are retrying forever', toolUses: [] },
      { role: 'assistant' as const, text: 'Looking.', toolUses: [] },
    ],
  }))
  on('model.complete', () => {
    seen.asked += 1
    return { value: { isAnswered: true as const, text: reply, usage: USAGE } }
  })
  return seen
}

test('a model reply is cut down to one clean title', () => {
  expect(cleanTitle('"Retry the webhook handler."\nbecause')).toBe('Retry the webhook handler')
  expect(cleanTitle('  \n')).toBe(null)
  expect(cleanTitle('x'.repeat(100))).toHaveLength(60)
})

test('the item reads as progress, then naming, then named, and is absent otherwise', () => {
  expect(labelOf({ stage: 'counting', turns: 1, goal: 3 })).toBe('🏷️ 1/3')
  expect(labelOf({ stage: 'naming', turns: 3, goal: 3 })).toBe('🏷️ naming…')
  expect(labelOf({ stage: 'named', turns: 0, goal: 3 })).toBe('🏷️ named')
  expect(labelOf({ stage: 'hidden', turns: 0, goal: 3 })).toBe(null)
})

test('nothing is named before the configured number of prompts', { options: { afterPrompts: 3 } }, async ($, on) => {
  const seen = world(on, 2)
  on('classic.UserPromptSubmit', () => ({}))
  await $.turn.complete(turn)
  expect(seen.asked).toBe(0)
})

test('the title is set on the prompt after the one that made it, once', { options: { afterPrompts: 3 } }, async ($, on) => {
  const seen = world(on, 3)
  on('classic.UserPromptSubmit', () => ({}))
  await $.turn.complete(turn)
  await settle()
  expect(seen.asked).toBe(1)

  const first = await $.classic.UserPromptSubmit(prompt())
  expect(first.sessionTitle).toBe('Retry the webhook handler')
  const second = await $.classic.UserPromptSubmit(prompt())
  expect(second.sessionTitle).toBeUndefined()
  await $.turn.complete(turn)
  expect(seen.asked).toBe(1)
})

test('a title the person set is left alone', { options: { afterPrompts: 3 } }, async ($, on) => {
  const seen = world(on, 3)
  on('classic.UserPromptSubmit', () => ({}))
  await $.classic.UserPromptSubmit(prompt('my own name'))
  await $.turn.complete(turn)
  expect(seen.asked).toBe(0)
})

test('its hint item follows the session, joins the shared row in key order, last', { options: { afterPrompts: 3 } }, async ($, on) => {
  const seen = world(on, 1)
  on('classic.UserPromptSubmit', () => ({}))
  on('ui.render', { component: 'PromptHint' }, ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    return (
      <Box key="desk-hint" flexDirection="row" columnGap={2}>
        <Text>? for shortcuts</Text>
        <Button key="desk-9-other" plain label="📎 other" onPress={() => undefined} />
        <Button key="desk-1-first" plain label="🥇 first" onPress={() => undefined} />
      </Box>
    )
  })
  const item = async (surface: 'terminal' | 'desktop') => {
    const hint = await $.ui.mount({
      plugin: 'name-tag',
      surface,
      component: 'PromptHint',
      props: { isDraft: false, isWorking: false, hint: '? for shortcuts' },
    })
    const found = await hint.find({ key: 'desk-8-name-tag' })
    const order = (await hint.findAll({})).map(n => n.key).filter(k => k?.startsWith('desk-') && k !== 'desk-hint')
    await hint.unmount()
    return { text: found?.text, type: found?.type, order }
  }

  for (const surface of ['terminal', 'desktop'] as const) expect((await item(surface)).text).toBeUndefined()

  await $.turn.complete(turn)
  for (const surface of ['terminal', 'desktop'] as const) {
    const shown = await item(surface)
    expect(shown.text).toBe('🏷️ 1/3')
    expect(shown.type).toBe('Box')
    expect(shown.order).toEqual(['desk-1-first', 'desk-8-name-tag', 'desk-9-other'])
  }

  seen.turns = 3
  await $.turn.complete(turn)
  expect((await item('terminal')).text).toBe('🏷️ naming…')
  await settle()
  expect((await item('terminal')).text).toBe('🏷️ naming…')

  await $.classic.UserPromptSubmit(prompt())
  expect((await item('terminal')).text).toBe('🏷️ named')
  await $.classic.UserPromptSubmit(prompt())
  expect((await item('terminal')).text).toBeUndefined()
})

test('a session the person already named never shows the item', { options: { afterPrompts: 3 } }, async ($, on) => {
  world(on, 1)
  on('classic.UserPromptSubmit', () => ({}))
  on('ui.render', { component: 'PromptHint' }, ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box key="desk-hint" flexDirection="row" columnGap={2}>
        <Text>? for shortcuts</Text>
      </Box>
    )
  })
  await $.classic.UserPromptSubmit(prompt('my own name'))
  await $.turn.complete(turn)
  const hint = await $.ui.mount({
    plugin: 'name-tag',
    surface: 'terminal',
    component: 'PromptHint',
    props: { isDraft: false, isWorking: false, hint: '? for shortcuts' },
  })
  expect(await hint.find({ key: 'desk-8-name-tag' })).toBeUndefined()
  await hint.unmount()
})
