export type GrudgeScope = 'repo' | 'global'

/** A whole-word command swap a rule enforces: `npm install` → `pnpm install`. */
export type GrudgeSwap = { from: string; to: string }

/** One held rule, as kept in the store. */
export type Grudge = {
  id: number
  rule: string
  scope: GrudgeScope
  /** The repo root a `repo` rule belongs to; null for a global one. */
  repo: string | null
  heldAt: number
  /** Commands it fixed. */
  hits: number
  swap: GrudgeSwap | null
}

/** A rule offered in the band, not yet held. */
export type GrudgeOffer = { rule: string; scope: GrudgeScope; swap: GrudgeSwap | null }

/** What the /grudges pane draws. */
export type GrudgeList = { repoName: string; repo: Grudge[]; global: Grudge[] }

declare module 'claude-code' {
  interface PluginState {
    grudge: {
      offer: GrudgeOffer | null
      list: GrudgeList
      /** The note under a Bash row a rule rewrote, by tool_use_id. */
      notes: StateFamily<string>
    }
  }
}
