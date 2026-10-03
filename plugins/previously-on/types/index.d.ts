/** The recap the band shows on return. */
export type Recap = { repo: string; lines: string[] }

/** One line of the day log: a session, its repo and what it was about. */
export type DayEntry = { day: string; sessionId: string; repo: string; topic: string }

/** When the person was last active, and the recap made for the session as it stood. */
export type Activity = { lastActiveAt: number; finishedTurns: number; cacheTurns: number; cacheLines: string[] }

/** The day log as the pane draws it, and the repo it is drawn for. */
export type Journal = { repo: string; days: DayEntry[] }

declare module 'claude-code' {
  interface PluginState {
    'previously-on': { recap: Recap | null; digest: string | null; activity: Activity; journal: Journal }
  }
}
