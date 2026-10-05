/** One check on the head commit, as the poll last saw it. */
export type CheckRow = {
  name: string
  state: 'pending' | 'passed' | 'failed' | 'skipped'
  isRequired: boolean
  /** The Actions run behind it, for its log and a rerun; null for a status from elsewhere. */
  runId: number | null
}

/** What the triage agent decided about one review thread. */
export type Verdict = {
  kind: 'accept' | 'accept-modified' | 'decline' | 'already-handled' | 'needs-human'
  reason: string
  /** `path:line` or a command, whatever backs the reason. */
  evidence: string
  /** For accept-modified: what to change instead of what was suggested. */
  change: string
  /** Set when the person flipped it in the pane. */
  isOverridden: boolean
}

/** A reply to a thread, drafted here and posted only when the person says so (or `postReplies` is auto). */
export type Reply = { text: string; status: 'draft' | 'posted' | 'discarded' }

/** One review thread on the PR. */
export type ThreadRow = {
  /** The GraphQL node id, which resolving takes. */
  id: string
  /** The first comment's REST id, which replying takes. */
  commentId: number
  author: string
  path: string
  line: number | null
  body: string
  url: string
  isResolved: boolean
  verdict: Verdict | null
  /** The round whose briefing asked Claude to fix it. */
  briefedRound: number | null
  /** The commit pushed after that briefing. */
  fixedInSha: string | null
  reply: Reply | null
}

/** A bot that reviews this PR, and whether it has reviewed the head commit. */
export type ReviewerRow = { login: string; state: 'reviewed' | 'waiting' | 'stale' }

export type Phase =
  | 'waiting'
  | 'triaging'
  | 'fixing'
  | 'needs-you'
  | 'green'
  | 'stopped'

/** The PR being watched, kept in state so a reload keeps watching it. */
export type ClosingWatch = {
  owner: string
  repo: string
  number: number
  url: string
  title: string
  branch: string
  headSha: string
  /** When the poll first saw this head commit. */
  headSeenAt: number
  phase: Phase
  /** Why the phase is what it is, in a line. */
  note: string
  checks: CheckRow[]
  reviewers: ReviewerRow[]
  threads: ThreadRow[]
  /** Briefings sent per check name, across commits. */
  ciAttempts: Record<string, number>
  /** Check names already rerun once as a likely flake. */
  rerun: string[]
  /** Review briefings sent. */
  rounds: number
  /** What was last briefed (`<sha>:<kind>`), so one state is briefed once. */
  briefed: string[]
  /** Triage agents running: agent id → thread id. */
  triaging: Record<string, string>
  startedAt: number
  lastProgressAt: number
  nextPollAt: number
  /** Whether the band above the prompt shows; a prompt sent hides it until there is news. */
  isBandShown: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'closing-time': { watch: ClosingWatch | null }
  }
}
