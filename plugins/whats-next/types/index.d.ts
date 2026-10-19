declare module 'claude-code' {
  interface PluginState {
    'whats-next': {
      /** The briefing waiting in the review pane, or null when there is none. */
      draft: string | null
      /** The context fill the band's nudge shows, or null when it is hidden. */
      nudge: number | null
      /** The session the nudge last showed in, so it shows once a session. */
      nudgedIn: string | null
      /** A briefing is being written. */
      isDrafting: boolean
      /** The briefing is written but its pane is not drawn, so the band offers to open it. */
      isWaiting: boolean
    }
  }
}
