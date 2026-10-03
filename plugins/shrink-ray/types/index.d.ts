/** The last shrunk paste, while it can still be undone. */
export type PasteUndo = { original: string; shrunk: string; before: number; after: number }

/** One shrink this session, for the pane. */
export type ShrinkShot = { kind: 'paste' | 'output'; before: number; after: number; path: string; at: number }

declare module 'claude-code' {
  interface PluginState {
    'shrink-ray': {
      undo: PasteUndo | null
      /** Estimated tokens kept from the model this session. */
      deflected: number
      /** Estimated tokens kept from the model across every session. */
      lifetime: number
      shots: ShrinkShot[]
    }
  }
}
