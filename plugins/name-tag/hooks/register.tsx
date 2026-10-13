import { atom, read } from 'claude-code'
import type { EngineInterface, Register, RenderElement, RenderNode } from 'claude-code'

import type { NameTagStage, NameTagStatus } from '../types'

const STATUS = { plugin: 'name-tag', key: 'status' } as const
const status = atom(STATUS, { stage: 'hidden', turns: 0, goal: 3 })

const SYSTEM =
  'You name coding sessions. Reply with one title of 3 to 6 words that says what the work is. No quotes, no trailing punctuation.'
const EXCERPTS = 3
const EXCERPT_LENGTH = 300
const TITLE_LENGTH = 60

// A reload or /clear starts these over; `session_title` on the next prompt keeps a named session named.
let isNamed = false
let isNaming = false
let isAnnounced = false
let pending: string | null = null
let generation = 0

export function cleanTitle(reply: string): string | null {
  const title = (reply.split('\n')[0] ?? '').replace(/^["'`\s]+|["'`\s.]+$/g, '').replace(/\s+/g, ' ')
  return title === '' ? null : title.slice(0, TITLE_LENGTH)
}

export function labelOf({ stage, turns, goal }: NameTagStatus): string | null {
  if (stage === 'counting') return `🏷️ ${turns}/${goal}`
  if (stage === 'naming') return '🏷️ naming…'
  if (stage === 'named') return '🏷️ named'
  return null
}

// The hint line under the prompt is shared. Each Desk Neighbours mod adds one item to a row keyed
// `desk-hint` after the engine's own hint; items are kept in order by their keys, so the row reads
// the same alone or together, in any load order.
const DESK = 'desk-hint'

function keyOf(node: RenderNode | undefined): string {
  if (typeof node !== 'object' || node === null || !('props' in node)) return ''
  const key = (node.props as Record<string, unknown> | undefined)?.key
  return typeof key === 'string' ? key : ''
}

function joinDesk(below: RenderElement, mine: RenderElement, wrap: (children: RenderNode[]) => RenderElement): RenderElement {
  if (below.type !== 'Box' || keyOf(below) !== DESK) return wrap([below, mine])
  const [line, ...items] = below.children ?? []
  const sorted = [...items.filter(n => keyOf(n) !== keyOf(mine)), mine].sort((a, b) => keyOf(a).localeCompare(keyOf(b)))
  return { ...below, children: line === undefined ? sorted : [line, ...sorted] }
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

async function show($: EngineInterface, stage: NameTagStage, turns: number, goal: number): Promise<void> {
  await $.state.set(STATUS, { stage, turns, goal }).catch(() => undefined)
}

export const register: Register = (on, options) => {
  const goal = Math.max(1, Number(options.afterPrompts ?? 3))
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (isNamed || isNaming || pending !== null || e.agentId !== undefined) return result
    const turns = await $.session.turns()
    if (turns < goal) {
      await show($, 'counting', turns, goal)
      return result
    }
    isNaming = true
    await show($, 'naming', turns, goal)
    void nameSession($, generation)
      .catch(() => undefined)
      .finally(() => {
        isNaming = false
        if (pending === null && !isNamed) void show($, 'counting', turns, goal)
      })
    return result
  })

  // A title can only be set in a prompt's (or a session start's) result, so it lands on the prompt after the one that made it.
  on('classic.UserPromptSubmit', async ($, e, next) => {
    const result = await next(e)
    if (e.session_title !== undefined) {
      isNamed = true
      isAnnounced = false
      pending = null
      await show($, 'hidden', 0, goal)
      return result
    }
    if (isAnnounced) {
      isAnnounced = false
      await show($, 'hidden', 0, goal)
    }
    if (pending === null || (e.source !== undefined && e.source !== 'user')) return result
    const sessionTitle = pending
    pending = null
    isNamed = true
    isAnnounced = true
    await show($, 'named', 0, goal)
    return { ...result, sessionTitle }
  })

  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const label = labelOf(await read($, status))
    const below = await next(e)
    if (label === null) return below
    const { Box, Text } = $.ui.resolve(e)
    // A Text drops its key, and the row is ordered by key, so the Text rides in a keyed Box.
    const mine = (
      <Box key="desk-8-name-tag">
        <Text dimColor>{label}</Text>
      </Box>
    )
    return joinDesk(below, mine, children => (
      <Box key={DESK} flexDirection="row" columnGap={2}>
        {children}
      </Box>
    ))
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear' || e.reason === 'resume') {
      generation += 1
      isNamed = false
      isAnnounced = false
      pending = null
      await show($, 'hidden', 0, goal)
    }
    return next(e)
  })
}
