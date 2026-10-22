export type CheckState = 'pass' | 'pending' | 'fail'

/** One CI check on the PR's head commit. */
export type Check = { name: string; state: CheckState; url: string | null }

export type ItemKind = 'thread' | 'comment' | 'review' | 'check' | 'conflict'

/** Something on the PR that needs an answer: a review thread, a comment, a review, a failing check or a conflict. */
export type Item = {
  /** Changes when there is something new to answer: a thread's id carries its latest comment's. */
  id: string
  kind: ItemKind
  author: string
  isBot: boolean
  /** The text to answer, cut short. */
  body: string
  url: string | null
  /** The review thread's node id, for replying and resolving. */
  threadId?: string
  path?: string
  line?: number | null
}

export type Did = 'fixed' | 'pushed-back' | 'rerun' | 'reported' | 'skipped'

/** What Claude did about one item, as it reported it. */
export type Outcome = { id: string; did: Did; note: string }

/**
 * `raising`: Claude is opening the PR. `watching`: polling and answering. `paused`: polling, answering nothing.
 * `handed-back`: out of automatic rounds. `ready`: mergeable. `closed`: merged or closed, nothing more to do.
 */
export type Phase = 'raising' | 'watching' | 'paused' | 'handed-back' | 'ready' | 'closed'

/** The PR Ship It is seeing through, kept per session. */
export type Ship = {
  phase: Phase
  number: number | null
  url: string | null
  /** `owner/name`. */
  repo: string | null
  checks: Check[]
  /** What is open on the PR now, answered or not. */
  open: Item[]
  /** Item ids already handed to Claude. */
  handled: string[]
  outcomes: Outcome[]
  rounds: number
  botRounds: number
  /** A turn Ship It asked for: queued until it starts, running until it ends. */
  turn: 'queued' | 'running' | null
  /** Turns that ended while raising without a PR to show for it. */
  raiseTurns: number
  hasReplied: boolean
  isMergeAsked: boolean
  /** The band line, until dismissed or the next prompt. */
  banner: string | null
  at: number
}

/** How a tracked PR came to be linked to the session. */
export type TrackSource = 'session' | 'pasted' | 'branch' | 'manual'

/** A tracked PR's most urgent state, the one its glyph shows. */
export type PrKind = 'merged' | 'closed' | 'conflict' | 'fail' | 'changes' | 'threads' | 'pending' | 'review' | 'ready' | 'open'

/** A PR the session linked, tracked without acting on it. */
export type Tracked = {
  /** `owner/name`. */
  repo: string
  number: number
  url: string
  title: string | null
  source: TrackSource
  /** Null until the first look. */
  kind: PrKind | null
  isDraft: boolean
  checks: Check[]
  reviewDecision: string | null
  /** Unresolved review threads, by who spoke last. */
  threads: { human: number; bot: number }
  addedAt: number
  /** When `kind` or the thread count last changed. */
  changedAt: number
}

/** Every PR the session tracks besides the one Ship It drives, kept per session. */
export type Board = {
  rows: Tracked[]
  /** The band line, until dismissed or the next prompt. */
  banner: string | null
  /** The PR the band line is about, `owner/name#n`. */
  bannerPr: string | null
  /** The pane's chosen row, `owner/name#n`. */
  selected: string | null
  /** When the pane was last opened: rows changed since show a dot. */
  seenAt: number
}

declare module 'claude-code' {
  interface PluginState {
    'ship-it': {
      ship: Ship | null
      board: Board
    }
  }
}
