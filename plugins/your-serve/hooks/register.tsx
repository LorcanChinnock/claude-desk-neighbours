import type { EngineInterface, Register, RenderElement, RenderNode } from 'claude-code'

const COMMAND = 'your-serve'
const LABEL = '🎾 your serve'

// Sent framed, so Claude reads it as the plugin's message rather than words the person typed. Claude has the whole
// conversation, so it decides what is still open and writes the options itself.
export const ASK = [
  'Look back over your last reply and this conversation. For each thing that still needs my answer or decision',
  'before you can go on, ask me with AskUserQuestion: one question per call, in the order they come up, with the',
  'options you would suggest and your recommendation first. Do not repeat the reply.',
  'If nothing is waiting on me, say so in one line.',
].join(' ')

async function serve($: EngineInterface): Promise<void> {
  await $.prompt.submit({ text: ASK })
}

// The hint line under the prompt can be shared with other mods. Your Serve adds its item to a row
// keyed `desk-hint` after the engine's own hint; items on it are kept in order by their keys, so
// the row reads the same in any load order.
const DESK = 'desk-hint'

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

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: COMMAND, description: '🎾 Have Claude ask you what it needs, one question at a time' })
    return next(e)
  })

  on('command.run', { command: COMMAND }, async $ => {
    // A prompt submitted from this hook would wait on the turn the command holds, so it goes once the command is done.
    $.clock.after(1, () => void serve($).catch(() => undefined))
    return { text: '🎾 Over to Claude for its questions' }
  })

  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const below = await next(e)
    const { Box, Button } = $.ui.resolve(e)
    const mine = <Button key="desk-2-your-serve" plain dimColor label={LABEL} onPress={() => void serve($)} />
    return joinDesk(below, mine, children => (
      <Box key={DESK} flexDirection="row" columnGap={2}>
        {children}
      </Box>
    ))
  })
}
