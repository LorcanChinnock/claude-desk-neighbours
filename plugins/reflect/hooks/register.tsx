import type { EngineInterface, Register, RenderElement, RenderNode } from 'claude-code'

const COMMAND = 'reflect'
const LABEL = '🪞 reflect'

// Sent framed, so Claude reads it as the plugin's message rather than words the person typed. Claude has the whole
// conversation, so it finds the findings itself and writes them where they belong.
export const ASK = [
  'Reflect on this session so future sessions go better. Look back over the whole conversation for what is worth keeping:',
  "- my corrections, and the preferences or rules they show;",
  '- your own mistakes, and the check that would have caught each one early;',
  '- things you only found out by digging, such as how a system, repo or tool really behaves, that took more than one try;',
  '- approaches that worked and that I confirmed;',
  '- docs, comments or instructions that were missing, stale or wrong.',
  'For each finding pick the one place it belongs, and update it:',
  '- your memory, for facts about me, feedback on how to work, project context and pointers that the code does not show. Follow the memory instructions you already have, and update an existing memory rather than adding a duplicate;',
  "- this project's CLAUDE.md, for a rule every session here needs;",
  "- this project's docs, README or code comments, for knowledge about the code that people need as well as you;",
  '- a skill, when a repeatable workflow went wrong or was missing.',
  'Skip anything the repo, its history or an existing instruction already records, and anything that only mattered to this conversation.',
  'Keep instruction files short: add a line only if it applies every time, written as a general rule rather than this one case.',
  'Follow the repo\'s own rules for changing files. Do not edit my user-level CLAUDE.md or settings without asking: propose the change and why, and wait for my answer.',
  'Finish with a short list: each finding, what you changed and the path, and anything you left for me to decide.',
  'If nothing is worth keeping, say so in one line and change nothing.',
].join('\n')

async function reflect($: EngineInterface): Promise<void> {
  await $.prompt.submit({ text: ASK })
}

// The hint line under the prompt can be shared with other mods. Reflect adds its item to a row keyed `desk-hint`
// after the engine's own hint; items on it are kept in order by their keys, so the row reads the same in any load
// order.
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
    await $.command.register({ name: COMMAND, description: '🪞 Have Claude reflect on this session and update its memory and docs' })
    return next(e)
  })

  on('command.run', { command: COMMAND }, async $ => {
    // A prompt submitted from this hook would wait on the turn the command holds, so it goes once the command is done.
    $.clock.after(1, () => void reflect($).catch(() => undefined))
    return { text: '🪞 Over to Claude to reflect' }
  })

  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const below = await next(e)
    const { Box, Button } = $.ui.resolve(e)
    const mine = <Button key="desk-6-reflect" plain dimColor label={LABEL} onPress={() => void reflect($)} />
    return joinDesk(below, mine, children => (
      <Box key={DESK} flexDirection="row" columnGap={2}>
        {children}
      </Box>
    ))
  })
}
