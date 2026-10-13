import type { EngineInterface, Register } from 'claude-code'

const SYSTEM =
  'You name coding sessions. Reply with one title of 3 to 6 words that says what the work is. No quotes, no trailing punctuation.'
const EXCERPTS = 3
const EXCERPT_LENGTH = 300
const TITLE_LENGTH = 60

// A reload or /clear starts these over; `session_title` on the next prompt keeps a named session named.
let isNamed = false
let isNaming = false
let pending: string | null = null
let generation = 0

export function cleanTitle(reply: string): string | null {
  const title = (reply.split('\n')[0] ?? '').replace(/^["'`\s]+|["'`\s.]+$/g, '').replace(/\s+/g, ' ')
  return title === '' ? null : title.slice(0, TITLE_LENGTH)
}

async function nameSession($: EngineInterface, asked: number): Promise<void> {
  const messages = await $.session.messages()
  const prompts = messages
    .filter(m => m.role === 'user' && m.text.trim() !== '')
    .slice(0, EXCERPTS)
    .map(m => `"""\n${m.text.trim().slice(0, EXCERPT_LENGTH)}\n"""`)
  if (prompts.length === 0) return
  const reply = await $.model.complete({
    model: 'haiku',
    effort: 'low',
    maxTokens: 40,
    timeoutMs: 15000,
    system: SYSTEM,
    prompt: `The session's first messages:\n${prompts.join('\n')}`,
  })
  if (!reply.isAnswered || asked !== generation) return
  pending = cleanTitle(reply.text)
}

export const register: Register = (on, options) => {
  const afterPrompts = Math.max(1, Number(options.afterPrompts ?? 3))

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (isNamed || isNaming || pending !== null || e.agentId !== undefined) return result
    if ((await $.session.turns()) < afterPrompts) return result
    isNaming = true
    void nameSession($, generation)
      .catch(() => undefined)
      .finally(() => {
        isNaming = false
      })
    return result
  })

  // A title can only be set in a prompt's (or a session start's) result, so it lands on the prompt after the one that made it.
  on('classic.UserPromptSubmit', async ($, e, next) => {
    const result = await next(e)
    if (e.session_title !== undefined) {
      isNamed = true
      pending = null
      return result
    }
    if (pending === null || (e.source !== undefined && e.source !== 'user')) return result
    const sessionTitle = pending
    pending = null
    isNamed = true
    return { ...result, sessionTitle }
  })

  on('session.end', ($, e, next) => {
    if (e.reason === 'clear' || e.reason === 'resume') {
      generation += 1
      isNamed = false
      pending = null
    }
    return next(e)
  })
}
