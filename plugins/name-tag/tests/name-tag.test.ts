import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { cleanTitle } from '../hooks/register'

const USAGE = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const turn = { answer: 'Done.', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' as const }
const prompt = (session_title?: string) => ({ prompt: 'next', source: 'user' as const, session_title })

/** The world beneath the plugin: a session with `turns` prompts sent, and a model that names it. */
function world(on: On, turns: number, reply = '"Retry the webhook handler."\nbecause'): { asked: number } {
  const seen = { asked: 0 }
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('session.turns', () => ({ value: turns }))
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
  await new Promise(resolve => setTimeout(resolve, 0))
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
