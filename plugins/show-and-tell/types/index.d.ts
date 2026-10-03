/** Who brought an image into the session: you pasted it, Claude looked at it, or Claude made it. */
export type ShotSource = 'you' | 'claude-read' | 'claude-made'

/** One image of the session, for the band and the gallery. */
export type Shot = {
  id: string
  source: ShotSource
  label: string
  /** The file Open, Copy path and Insert use: the plugin's own copy, or the file Claude read or made. */
  path: string
  /** A PNG the terminal can draw, or null where none could be made (the gallery lists it as text). */
  thumb: string | null
  width: number | null
  height: number | null
  at: number
  /** The `[Image #N]` a paste came in as. */
  imageNo?: number
  /** A paste that has gone out with a prompt. */
  isSent?: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'show-and-tell': {
      /** Newest first. */
      shots: Shot[]
      /** Ids the band above the prompt shows. */
      fresh: string[]
      /** The gallery's selected shot. */
      picked: string | null
      filter: 'all' | 'you' | 'claude'
    }
  }
}
