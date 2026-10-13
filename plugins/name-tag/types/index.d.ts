/** Where a session is on its way to a title: nothing to show, counting prompts, waiting on the model, or just named. */
export type NameTagStage = 'hidden' | 'counting' | 'naming' | 'named'

/** What the hint item draws: `turns` of `goal` prompts sent while counting. */
export type NameTagStatus = { stage: NameTagStage; turns: number; goal: number }

declare module 'claude-code' {
  interface PluginState {
    'name-tag': { status: NameTagStatus }
  }
}
