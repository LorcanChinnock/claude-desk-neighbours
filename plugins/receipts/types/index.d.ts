/** A leftover in a line Claude added: what it is and where. */
export type Crumb = { kind: string; file: string; line: number }

/** What the band offers after a turn that left something to audit. */
export type ReceiptsBand = {
  summary: string
  /** Set when the turn claimed success with nothing run since its last edit. */
  missingFile: string | null
  crumbs: Crumb[]
  /** The repo's learned verification command, when one is known. */
  command: string | null
  canMakeRule: boolean
}

/** The session's audit trail, kept in state so a reload keeps it. */
export type ReceiptsLedger = {
  /** Orders edits and commands across the session. */
  seq: number
  lastEditSeq: number
  lastEditFile: string | null
  lastVerifySeq: number
  turnEdited: boolean
  turnCrumbs: Crumb[]
  misses: number
  /** Files edited since the last verification ran, newest last. */
  uncheckedFiles: string[]
}

declare module 'claude-code' {
  interface PluginState {
    receipts: { band: ReceiptsBand | null; ledger: Shaped<ReceiptsLedger>; command: string | null }
  }
}
