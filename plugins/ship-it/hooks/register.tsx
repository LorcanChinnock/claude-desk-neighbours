import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement, RenderNode } from 'claude-code'

import type { Board, Check, Did, Item, Outcome, PrKind, Ship, TrackSource, Tracked } from '../types'

const SHIP = { plugin: 'ship-it', key: 'ship' } as const
const ship = atom(SHIP, null)
const BOARD = { plugin: 'ship-it', key: 'board' } as const
const EMPTY: Board = { rows: [], banner: null, bannerPr: null, selected: null, seenAt: 0 }
const board = atom(BOARD, EMPTY)

const COMMAND = 'ship-it'
const PANE = 'ship-it'
const TITLE = '🚢 Ship It'
const PRS_COMMAND = 'prs'
const PRS_PANE = 'ship-it-prs'
const PRS_TITLE = '🚢 Linked PRs'
const REPORT = 'mcp__ship-it__report'

/** Ends every reply Claude posts, so the next poll knows the reply is its own. */
export const MARKER = '🤖 via Ship It'

// Bots that re-review on every push would keep a round going forever, so their items get fewer rounds.
const BOT_ROUNDS = 2
// Turns that may end while raising before Ship It gives up on finding a PR.
const RAISE_TURNS = 3
const MAX_BACKOFF = 3
const AFTER_TURN_MS = 10_000
const BODY_CHARS = 1_200
const KEEP_DAYS = 14
// Tracked PRs: the most kept, the most shown in the status row, and how soon to look after a push.
const MAX_TRACKED = 8
const MAX_CHIPS = 3
const AFTER_PUSH_MS = 15_000

const FAILED = ['FAILURE', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'ERROR']
const PENDING = ['PENDING', 'EXPECTED', 'QUEUED', 'IN_PROGRESS', 'WAITING', 'REQUESTED']

type Settings = { isConfirming: boolean; pollMs: number; maxRounds: number; canMerge: boolean }

let settings: Settings = { isConfirming: true, pollMs: 60_000, maxRounds: 5, canMerge: false }

/** One entry of `gh pr view --json statusCheckRollup`: a check run or a commit status. */
export type Rollup = {
  __typename?: string
  name?: string
  context?: string
  status?: string
  conclusion?: string
  state?: string
  detailsUrl?: string
  targetUrl?: string
}

export type PrView = {
  number: number
  url: string
  state: 'OPEN' | 'MERGED' | 'CLOSED'
  isDraft: boolean
  mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN'
  reviewDecision: string | null
  headRefOid: string
  statusCheckRollup: Rollup[] | null
}

type Author = { login: string; __typename: string } | null
type Comment = { id: string; author: Author; body: string; url: string }

export type Talk = {
  threads: { id: string; isResolved: boolean; path: string; line: number | null; comments: { nodes: Comment[] } }[]
  comments: Comment[]
  reviews: (Comment & { state: string })[]
}

export function checksOf(rollup: readonly Rollup[]): Check[] {
  return rollup.map(r => {
    const word = r.__typename === 'StatusContext' ? r.state : r.status === 'COMPLETED' ? r.conclusion : (r.status ?? 'PENDING')
    const state = FAILED.includes(word ?? '') ? 'fail' : word === undefined || PENDING.includes(word) ? 'pending' : 'pass'
    return { name: r.name ?? r.context ?? 'check', state, url: r.detailsUrl ?? r.targetUrl ?? null }
  })
}

const isMine = (body: string) => body.includes(MARKER)
const cut = (body: string) => (body.length > BODY_CHARS ? `${body.slice(0, BODY_CHARS)}…` : body)
const who = (author: Author) => ({ author: author?.login ?? 'ghost', isBot: author?.__typename === 'Bot' })

/** Everything open on the PR. A thread's id carries its latest comment that isn't Claude's own reply, so a
 * thread Claude answered comes back only when someone answers it. */
export function itemsOf(view: PrView, talk: Talk, checks: readonly Check[]): Item[] {
  const items: Item[] = []
  for (const thread of talk.threads) {
    const last = thread.comments.nodes.filter(c => !isMine(c.body)).at(-1)
    if (thread.isResolved || last === undefined) continue
    items.push({ id: `thread:${thread.id}:${last.id}`, kind: 'thread', ...who(last.author), body: cut(last.body), url: last.url, threadId: thread.id, path: thread.path, line: thread.line })
  }
  for (const review of talk.reviews) {
    if (isMine(review.body) || review.body.trim() === '' || !['CHANGES_REQUESTED', 'COMMENTED'].includes(review.state)) continue
    items.push({ id: `review:${review.id}`, kind: 'review', ...who(review.author), body: cut(review.body), url: review.url })
  }
  for (const comment of talk.comments) {
    if (isMine(comment.body)) continue
    items.push({ id: `comment:${comment.id}`, kind: 'comment', ...who(comment.author), body: cut(comment.body), url: comment.url })
  }
  for (const check of checks.filter(c => c.state === 'fail')) {
    items.push({ id: `check:${check.name}:${view.headRefOid}`, kind: 'check', author: 'CI', isBot: false, body: `${check.name} failed`, url: check.url })
  }
  if (view.mergeable === 'CONFLICTING') {
    items.push({ id: `conflict:${view.headRefOid}`, kind: 'conflict', author: 'git', isBot: false, body: 'The branch conflicts with its base.', url: view.url })
  }
  return items
}

export function isReady(view: PrView, talk: Talk, checks: readonly Check[]): boolean {
  return (
    view.state === 'OPEN' &&
    !view.isDraft &&
    view.mergeable === 'MERGEABLE' &&
    checks.every(c => c.state === 'pass') &&
    view.reviewDecision !== 'CHANGES_REQUESTED' &&
    view.reviewDecision !== 'REVIEW_REQUIRED' &&
    talk.threads.every(t => t.isResolved)
  )
}

/** A git command that rewrites history or force-pushes. */
export function isRewrite(command: string): boolean {
  return (
    /\bgit\b[^\n;&|]*\bpush\b[^\n;&|]*(\s--force(-with-lease|-if-includes)?\b|\s-[a-zA-Z]*f[a-zA-Z]*\b|\s\+\S)/.test(command) ||
    /\bgit\b[^\n;&|]*\b(rebase|filter-branch|filter-repo)\b/.test(command) ||
    /\bgit\b[^\n;&|]*\bcommit\b[^\n;&|]*--amend\b/.test(command) ||
    /\bgit\b[^\n;&|]*\breset\b[^\n;&|]*--hard\b/.test(command)
  )
}

/** The review threads a command resolves. */
export function resolvedIn(command: string): string[] {
  return command.includes('resolveReviewThread') ? [...command.matchAll(/PRRT_[A-Za-z0-9_-]+/g)].map(m => m[0]) : []
}

const handedThreads = (s: Ship) => s.handled.filter(id => id.startsWith('thread:')).map(id => id.split(':')[1])

export function ciWord(checks: readonly Check[]): string {
  if (checks.some(c => c.state === 'fail')) return 'CI failing'
  if (checks.some(c => c.state === 'pending')) return 'CI running'
  return checks.length === 0 ? 'no CI' : 'CI green'
}

/** The status row's label. */
export function labelOf(s: Ship | null): string {
  if (s === null || s.phase === 'closed') return '🚢 ship it'
  if (s.phase === 'raising') return '🚢 raising PR…'
  const pr = `🚢 #${s.number}`
  if (s.phase === 'paused') return `${pr} · ⏸ paused`
  if (s.phase === 'ready') return `${pr} · ✅ ready`
  const talking = s.open.filter(i => i.kind !== 'check' && i.kind !== 'conflict').length
  if (talking > 0) return `${pr} · ${talking} comment${talking === 1 ? '' : 's'}`
  if (s.checks.some(c => c.state === 'fail')) return `${pr} · CI ❌`
  if (s.checks.some(c => c.state === 'pending')) return `${pr} · CI ⏳`
  return s.phase === 'handed-back' ? `${pr} · over to you` : `${pr} · watching`
}

/** "fixed 2, pushed back on 1". */
export function tally(outcomes: readonly Outcome[]): string {
  const words: Record<Did, string> = { fixed: 'fixed', 'pushed-back': 'pushed back on', rerun: 'reran', reported: 'reported', skipped: 'skipped' }
  const parts = (Object.keys(words) as Did[]).flatMap(did => {
    const n = outcomes.filter(o => o.did === did).length
    return n === 0 ? [] : [`${words[did]} ${n}`]
  })
  return parts.length === 0 ? 'nothing to change' : parts.join(', ')
}

function confirmLine(what: string): string {
  return settings.isConfirming ? `Before ${what}, ask me with AskUserQuestion and wait for my answer.` : ''
}

export function raisePrompt(): string {
  return [
    'Raise a pull request for the work in this session. Ship It will watch it afterwards, so do only these steps:',
    '1. Check `git status`, the current branch and the default branch (`gh repo view --json defaultBranchRef`).',
    'If I am on the default branch, do not commit there: ask me with AskUserQuestion whether to create a branch, suggesting a name.',
    '2. Stage only the files you changed for this work, each by explicit path. Never `git add -A` or `git add .`.',
    'Commit with a message that follows the repository\'s conventions.',
    '3. Push with `git push -u origin <branch>`. Never force-push.',
    '4. If the branch already has an open PR, stop there. Otherwise open one with `gh pr create`, following the',
    'repository\'s pull request template and title conventions if it has them.',
    confirmLine('committing and pushing, and again before opening the PR,'),
  ]
    .filter(line => line !== '')
    .join(' ')
}

function describe(item: Item): string {
  const where = item.path !== undefined ? ` on ${item.path}${item.line != null ? `:${item.line}` : ''}` : ''
  const thread = item.threadId !== undefined ? ` (thread ${item.threadId})` : ''
  return [`### ${item.id}`, `${item.kind} from ${item.author}${item.isBot ? ' (bot)' : ''}${where}${thread}${item.url !== null ? ` ${item.url}` : ''}`, item.body].join('\n')
}

export function addressPrompt(s: Ship, items: readonly Item[]): string {
  const rules = [
    `New activity on PR #${s.number} (${s.url}). Work through each item below.`,
    'For each one, decide critically whether it is right. Do not just comply: where it is wrong, out of scope, or',
    'conflicts with this repository\'s standards, push back with your reasons instead of changing the code.',
    'Fix what is valid, run the checks scoped to what you changed, commit the files by explicit path and push.',
    'Never force-push, amend, rebase or reset: Ship It refuses those.',
    `Reply on every comment and thread: what changed (with the commit) or why not. End each reply with "\\n\\n<sub>${MARKER}</sub>".`,
    'Reply to a review thread with the `addPullRequestReviewThreadReply` GraphQL mutation via `gh api graphql`,',
    `and to a comment or review with \`gh pr comment ${s.number}\`.`,
    'Resolve a thread with `resolveReviewThread` only when you fixed it; leave threads you pushed back on open for the reviewer.',
    'For a failing check, read its logs (`gh run view <run> --log-failed`). Fix real failures. If it is clearly flaky,',
    'rerun it once (`gh run rerun <run> --failed`). Report failures unrelated to this PR without touching them.',
    'For a conflict with the base branch, merge the base into this branch (never rebase), resolve it and push.',
    s.hasReplied ? confirmLine('pushing') : confirmLine('pushing, and before posting the first replies on this PR,'),
    `When done, call the \`${REPORT}\` tool (load it with ToolSearch if needed) with one outcome per item id.`,
  ].filter(line => line !== '')
  return [rules.join(' '), '', ...items.map(describe)].join('\n\n')
}

const QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: 100) { nodes { id isResolved path line comments(last: 20) { nodes { id body url author { login __typename } } } } }
      comments(last: 50) { nodes { id body url author { login __typename } } }
      reviews(last: 50) { nodes { id state body url author { login __typename } } }
    }
  }
}`

/** With `isPartial`, a failed call's output is still read: `gh api graphql` exits 1 when any part of a query
 * fails, but prints the `data` it did resolve. */
async function gh($: EngineInterface, args: readonly string[], isPartial = false): Promise<unknown> {
  const done = await $.process.run(['gh', ...args], { timeoutMs: 60_000 }).catch(() => null)
  if (done === null || (done.exitCode !== 0 && !isPartial)) return null
  try {
    return JSON.parse(done.stdout) as unknown
  } catch {
    return null
  }
}

const VIEW_FIELDS = 'number,url,state,isDraft,mergeable,reviewDecision,headRefOid,statusCheckRollup'

async function look($: EngineInterface, repo: string, n: number): Promise<{ view: PrView; talk: Talk } | null> {
  const view = (await gh($, ['pr', 'view', String(n), '-R', repo, '--json', VIEW_FIELDS])) as PrView | null
  const [owner = '', name = ''] = repo.split('/')
  const found = (await gh($, ['api', 'graphql', '-f', `query=${QUERY}`, '-f', `owner=${owner}`, '-f', `name=${name}`, '-F', `number=${n}`])) as {
    data?: { repository?: { pullRequest?: { reviewThreads: { nodes: Talk['threads'] }; comments: { nodes: Comment[] }; reviews: { nodes: Talk['reviews'] } } } }
  } | null
  const pr = found?.data?.repository?.pullRequest
  if (view === null || pr === undefined) return null
  return { view, talk: { threads: pr.reviewThreads.nodes, comments: pr.comments.nodes, reviews: pr.reviews.nodes } }
}

/** `https://github.com/owner/name/pull/46` → `owner/name`. */
export function repoOf(url: string): string | null {
  const match = /github\.com\/([^/]+\/[^/]+)\/pull\/\d+/.exec(url)
  return match?.[1] ?? null
}

async function storeKey($: EngineInterface): Promise<string> {
  return `ship:${await $.session.id()}`
}

async function change($: EngineInterface, fn: (s: Ship) => Ship | null): Promise<Ship | null> {
  await update($, ship, s => (s === null ? null : fn(s)))
  const now = await read($, ship)
  const key = await storeKey($)
  await (now === null ? $.store.delete(key) : $.store.set(key, now))
  return now
}

async function begin($: EngineInterface, s: Ship | null): Promise<void> {
  await $.state.set(SHIP, s)
  const key = await storeKey($)
  await (s === null ? $.store.delete(key) : $.store.set(key, s))
}

async function tell($: EngineInterface, text: string): Promise<void> {
  const sent = await $.ui.notify(text, { title: TITLE }).catch(() => null)
  if (sent?.isSent !== true) $.ui.toast(`🚢 ${text}`)
}

/** What What's Next's briefing should carry, so the fresh session knows the PR Ship It goes on watching. */
export function briefingNote(s: Ship): string {
  const open = s.open.map(i => `- ${i.kind} from ${i.author}${i.path !== undefined ? ` on ${i.path}` : ''}: ${i.body.split('\n')[0]}`)
  return [
    `Ship It is watching PR #${s.number} (${s.url}) for this work: ${labelOf(s).replace('🚢 ', '')}.`,
    open.length === 0 ? 'Nothing is open on it.' : `Open on it:\n${open.join('\n')}`,
    'Put the PR number, its URL and these open items in the briefing\'s current state, and say Ship It will hand new feedback to the new session.',
  ].join('\n')
}

// Linked PRs: every other PR the session links is tracked without acting on it. One glyph each in the status
// row, a band line when one changes in a way that needs you, and a row each in the /prs pane.

type PrRef = { repo: string; number: number; url: string }

export const prId = (pr: { repo: string; number: number }): string => `${pr.repo}#${pr.number}`

/** Every PR link in a piece of text, once each. */
export function prsIn(text: string): PrRef[] {
  const found = new Map<string, PrRef>()
  for (const m of text.matchAll(/https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/g)) {
    const pr = { repo: m[1] ?? '', number: Number(m[2]), url: m[0] }
    found.set(prId(pr), pr)
  }
  return [...found.values()]
}

/** `git@github.com:me/app.git` or `https://github.com/me/app` → `me/app`. */
export function repoOfRemote(remote: string | null | undefined): string | null {
  const match = /github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(remote ?? '')
  return match?.[1] ?? null
}

/** A PR named as a link, `owner/name#12`, `#12` or `12`; the bare forms in `here`. */
export function parseRef(ref: string, here: string | null): PrRef | null {
  const linked = prsIn(ref)[0]
  if (linked !== undefined) return linked
  const match = /^(?:([\w.-]+\/[\w.-]+))?#?(\d+)$/.exec(ref.trim())
  const repo = match?.[1] ?? here
  if (match === null || repo === null) return null
  const number = Number(match[2])
  return { repo, number, url: `https://github.com/${repo}/pull/${number}` }
}

/** What one look at a PR found. */
export type Seen = Pick<Tracked, 'isDraft' | 'checks' | 'reviewDecision' | 'threads'> & { state: string; mergeable: string; title: string }

/** The PR's most urgent state: whose move it is. */
export function kindOf(pr: Seen): PrKind {
  if (pr.state === 'MERGED') return 'merged'
  if (pr.state === 'CLOSED') return 'closed'
  if (pr.mergeable === 'CONFLICTING') return 'conflict'
  if (pr.checks.some(c => c.state === 'fail')) return 'fail'
  if (pr.reviewDecision === 'CHANGES_REQUESTED') return 'changes'
  if (pr.threads.human > 0) return 'threads'
  if (pr.checks.some(c => c.state === 'pending')) return 'pending'
  if (pr.reviewDecision === 'REVIEW_REQUIRED') return 'review'
  if (!pr.isDraft && pr.mergeable === 'MERGEABLE' && pr.threads.bot === 0) return 'ready'
  return 'open'
}

const KIND_GLYPH: Record<PrKind, string> = {
  merged: '🟣',
  closed: '⚫',
  conflict: '⚔️',
  fail: '❌',
  changes: '📝',
  threads: '💬',
  pending: '⏳',
  review: '👀',
  ready: '✅',
  open: '🟢',
}
const KIND_WORD: Record<PrKind, string> = {
  merged: 'merged',
  closed: 'closed',
  conflict: 'conflicts with its base',
  fail: 'CI failing',
  changes: 'changes requested',
  threads: 'comments open',
  pending: 'CI running',
  review: 'awaiting review',
  ready: 'ready to merge',
  open: 'open',
}
// The status row shows the most urgent PRs first: the ones that are your move.
const URGENCY: readonly PrKind[] = ['conflict', 'fail', 'changes', 'threads', 'ready', 'pending', 'review', 'open', 'merged', 'closed']
// Changes that are worth a band line, and the ones also worth a notification.
const NEWS: readonly PrKind[] = ['merged', 'closed', 'conflict', 'fail', 'changes', 'ready']
const LOUD: readonly PrKind[] = ['merged', 'fail', 'ready']

export function glyphOf(row: Tracked): string {
  if (row.kind === null) return '…'
  return row.kind === 'threads' ? `💬${row.threads.human}` : KIND_GLYPH[row.kind]
}

const rank = (row: Tracked) => (row.kind === null ? URGENCY.length : URGENCY.indexOf(row.kind))
const isDone = (row: Tracked) => row.kind === 'merged' || row.kind === 'closed'

/** The status row's chips, most urgent first; a merged or closed PR only until the pane is opened. */
export function trackLabel(b: Board): string | null {
  const shown = b.rows.filter(r => !isDone(r) || r.changedAt > b.seenAt).sort((x, y) => rank(x) - rank(y))
  if (shown.length === 0) return null
  const chips = shown.slice(0, MAX_CHIPS).map(r => `#${r.number} ${glyphOf(r)}`)
  const more = shown.length - MAX_CHIPS
  return `${chips.join(' · ')}${more > 0 ? ` +${more}` : ''}`
}

/** A band line for what changed between two looks, or null. The first look says nothing. */
export function newsOf(before: Tracked, after: Tracked): string | null {
  if (before.kind === null || after.kind === null) return null
  const pr = `#${after.number}`
  if (after.kind !== before.kind && NEWS.includes(after.kind)) {
    if (after.kind !== 'fail') return `${pr} ${KIND_WORD[after.kind]}`
    const failed = after.checks.filter(c => c.state === 'fail').map(c => c.name)
    return `${pr} CI failed (${failed.slice(0, 2).join(', ')}${failed.length > 2 ? ', …' : ''})`
  }
  const more = after.threads.human - before.threads.human
  return more > 0 && !isDone(after) ? `${pr} ${more} new comment${more === 1 ? '' : 's'}` : null
}

/** Drops the oldest merged or closed rows first, then the oldest, down to the cap. */
export function capped(rows: readonly Tracked[]): Tracked[] {
  const kept = [...rows]
  while (kept.length > MAX_TRACKED) {
    const done = kept.findIndex(isDone)
    kept.splice(done === -1 ? 0 : done, 1)
  }
  return kept
}

const PR_FIELDS = `number url title state isDraft mergeable reviewDecision
      commits(last: 1) { nodes { commit { statusCheckRollup { contexts(first: 100) { nodes { __typename ... on CheckRun { name status conclusion detailsUrl } ... on StatusContext { context state targetUrl } } } } } } }
      reviewThreads(first: 100) { nodes { isResolved comments(last: 1) { nodes { body author { __typename } } } } }`

/** One query for every row, each PR under its own alias. */
export function boardQuery(rows: readonly { repo: string; number: number }[]): string {
  const parts = rows.map((r, i) => {
    const [owner = '', name = ''] = r.repo.split('/')
    return `  p${i}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) {\n    pullRequest(number: ${r.number}) {\n      ${PR_FIELDS}\n    }\n  }`
  })
  return `query {\n${parts.join('\n')}\n}`
}

export type PrNode = {
  number: number
  url: string
  title: string
  state: string
  isDraft: boolean
  mergeable: string
  reviewDecision: string | null
  commits: { nodes: { commit: { statusCheckRollup: { contexts: { nodes: Rollup[] } } | null } }[] }
  reviewThreads: { nodes: { isResolved: boolean; comments: { nodes: { body: string; author: { __typename: string } | null }[] } }[] }
}

/** An open thread whose last word is a bot's, or Claude's own reply, isn't waiting on a person. */
export function seenOf(node: PrNode): Seen {
  const last = node.reviewThreads.nodes.filter(t => !t.isResolved).map(t => t.comments.nodes.at(-1))
  const bot = last.filter(c => c === undefined || c.author?.__typename === 'Bot' || isMine(c.body)).length
  return {
    title: node.title,
    state: node.state,
    mergeable: node.mergeable,
    isDraft: node.isDraft,
    reviewDecision: node.reviewDecision,
    checks: checksOf(node.commits.nodes[0]?.commit.statusCheckRollup?.contexts.nodes ?? []),
    threads: { human: last.length - bot, bot },
  }
}

/** What What's Next's briefing should carry about the tracked PRs. */
export function boardNote(rows: readonly Tracked[]): string {
  return [
    'Ship It also tracks these PRs linked to this session, without acting on them:',
    ...rows.map(r => `- ${r.url}${r.title !== null ? ` "${r.title}"` : ''}: ${r.kind === null ? 'not looked at yet' : KIND_WORD[r.kind]}`),
    'List them in the briefing\'s current state.',
  ].join('\n')
}

function ago(ms: number): string {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`
}

/** One pane row: glyph, number, title, then CI, review, threads and how long since it changed. */
export function rowText(row: Tracked, now: number, isNew: boolean, columns: number): string {
  const passed = row.checks.filter(c => c.state === 'pass').length
  const ci = row.checks.length === 0 ? 'no CI' : `CI ${passed}/${row.checks.length}`
  const review = row.reviewDecision === 'APPROVED' ? 'approved' : row.reviewDecision === 'CHANGES_REQUESTED' ? 'changes' : row.reviewDecision === 'REVIEW_REQUIRED' ? 'review' : ''
  const threads = row.threads.human + row.threads.bot === 0 ? '' : `💬 ${row.threads.human}${row.threads.bot > 0 ? ` (+${row.threads.bot} bot)` : ''}`
  const tail = [row.kind === null ? 'looking…' : ci, review, threads, row.isDraft ? 'draft' : '', ago(now - row.changedAt)].filter(p => p !== '').join('  ')
  const head = `${isNew ? '•' : ' '} ${glyphOf(row)} #${row.number}  `
  const room = Math.max(8, columns - head.length - tail.length - 4)
  const title = row.title ?? row.repo
  return `${head}${title.length > room ? `${title.slice(0, room - 1)}…` : title.padEnd(room)}  ${tail}`
}

let boardTimer: { cancel: () => void } | null = null
let boardPrint = ''
let boardQuiet = 0
// The pane's dots mark rows changed since the open before this one; none after a reload.
let dotsSince = Number.POSITIVE_INFINITY
// The rows tracked when `/clear` ran, kept until the new session starts.
let carriedBoard: Board | null = null

async function boardKey($: EngineInterface): Promise<string> {
  return `board:${await $.session.id()}`
}

async function changeBoard($: EngineInterface, fn: (b: Board) => Board): Promise<Board> {
  await update($, board, fn)
  const now = await read($, board)
  const key = await boardKey($)
  await (now.rows.length === 0 ? $.store.delete(key) : $.store.set(key, now))
  return now
}

function stopBoard(): void {
  boardTimer?.cancel()
  boardTimer = null
}

function scheduleBoard($: EngineInterface, ms: number): void {
  stopBoard()
  boardTimer = $.clock.after(ms, () => void pollBoard($).catch(() => scheduleBoard($, settings.pollMs)))
}

/** Adds PRs to the board, skipping the one Ship It drives and any already there. How many were new. */
async function track($: EngineInterface, prs: readonly PrRef[], source: TrackSource): Promise<number> {
  const s = await read($, ship)
  // While raising, the branch's new PR is Ship It's own.
  if (s?.phase === 'raising' && (source === 'session' || source === 'branch')) return 0
  const driven = s !== null && s.phase !== 'closed' && s.repo !== null ? `${s.repo}#${s.number}` : null
  const rows = (await read($, board)).rows
  const fresh = prs.filter(pr => prId(pr) !== driven && !rows.some(r => prId(r) === prId(pr)))
  if (fresh.length === 0) return 0
  const at = await $.clock.now()
  const added: Tracked[] = fresh.map(pr => ({
    ...pr,
    title: null,
    source,
    kind: null,
    isDraft: false,
    checks: [],
    reviewDecision: null,
    threads: { human: 0, bot: 0 },
    addedAt: at,
    changedAt: at,
  }))
  await changeBoard($, b => ({ ...b, rows: capped([...b.rows.filter(r => !added.some(a => prId(a) === prId(r))), ...added]) }))
  scheduleBoard($, 1)
  return fresh.length
}

async function untrack($: EngineInterface, id: string): Promise<boolean> {
  const had = (await read($, board)).rows.some(r => prId(r) === id)
  await changeBoard($, b => ({
    ...b,
    rows: b.rows.filter(r => prId(r) !== id),
    selected: b.selected === id ? null : b.selected,
    ...(b.bannerPr === id ? { banner: null, bannerPr: null } : {}),
  }))
  return had
}

async function pollBoard($: EngineInterface): Promise<void> {
  const live = (await read($, board)).rows.filter(r => !isDone(r))
  if (live.length === 0) return
  const found = (await gh($, ['api', 'graphql', '-f', `query=${boardQuery(live)}`], true)) as { data?: Record<string, { pullRequest: PrNode | null } | null> } | null
  const data = found?.data
  if (data == null) return scheduleBoard($, settings.pollMs)
  const at = await $.clock.now()
  const looked = new Map<string, Tracked>()
  const news: { line: string; id: string; kind: PrKind }[] = []
  // A PR GitHub can't resolve (a wrong number, a private or deleted repo) never will, so it stops being tracked.
  const lost: Tracked[] = []
  live.forEach((row, i) => {
    const node = data[`p${i}`]?.pullRequest
    if (node == null) return void lost.push(row)
    const look = seenOf(node)
    const kind = kindOf(look)
    const { title, isDraft, checks, reviewDecision, threads } = look
    const changed = kind !== row.kind || threads.human !== row.threads.human
    const seen: Tracked = { ...row, title, isDraft, checks, reviewDecision, threads, kind, changedAt: changed ? at : row.changedAt }
    const line = newsOf(row, seen)
    if (line !== null) news.push({ line, id: prId(row), kind })
    looked.set(prId(row), seen)
  })
  const now = await changeBoard($, b => ({
    ...b,
    rows: b.rows.filter(r => !lost.some(l => prId(l) === prId(r))).map(r => looked.get(prId(r)) ?? r),
    ...(news.length === 0 ? {} : { banner: news.map(n => n.line).join(' · '), bannerPr: news.length === 1 ? (news[0]?.id ?? null) : null }),
  }))
  if (lost.length > 0) $.ui.toast(`🚢 Can't see ${lost.map(r => prId(r)).join(', ')} on GitHub; stopped tracking ${lost.length === 1 ? 'it' : 'them'}`)
  const loud = news.filter(n => LOUD.includes(n.kind))
  if (loud.length > 0) await tell($, loud.map(n => n.line).join(' · '))

  const print = JSON.stringify(now.rows.map(r => [prId(r), r.kind, r.threads, r.checks]))
  boardQuiet = print === boardPrint ? boardQuiet + 1 : 0
  boardPrint = print
  if (now.rows.every(isDone)) return stopBoard()
  // Running CI is about to say something, so it is looked at without backing off.
  const isRunning = now.rows.some(r => !isDone(r) && r.checks.some(c => c.state === 'pending'))
  scheduleBoard($, isRunning ? settings.pollMs : settings.pollMs * 2 ** Math.min(boardQuiet, MAX_BACKOFF))
}

/** After a Bash call: a PR it created or changed, or a push that could move a tracked PR's CI. */
async function linked($: EngineInterface, done: unknown): Promise<void> {
  type GitOperation = { pr?: { number: number; url?: string; action: string }; push?: { branch: string } }
  const op = (done as { result?: { gitOperation?: GitOperation } } | null)?.result?.gitOperation
  const rows = (await read($, board)).rows
  if (op?.pr !== undefined) {
    const { number, url, action } = op.pr
    const repo = (url !== undefined ? repoOf(url) : null) ?? repoOfRemote((await $.session.repo())?.remote)
    if (repo === null) return
    if (rows.some(r => prId(r) === `${repo}#${number}`)) return scheduleBoard($, 1)
    if (action !== 'merged' && action !== 'closed') await track($, [{ repo, number, url: url ?? `https://github.com/${repo}/pull/${number}` }], 'session')
    return
  }
  if (op?.push !== undefined && rows.some(r => !isDone(r))) scheduleBoard($, AFTER_PUSH_MS)
}

/** The checked-out branch's open PR, at the start of a session. */
async function trackBranch($: EngineInterface): Promise<void> {
  const pr = (await gh($, ['pr', 'view', '--json', 'number,url,state'])) as { number: number; url: string; state: string } | null
  const repo = pr === null ? null : repoOf(pr.url)
  if (pr?.state === 'OPEN' && repo !== null) await track($, [{ repo, number: pr.number, url: pr.url }], 'branch')
}

async function loadBoard($: EngineInterface): Promise<void> {
  stopBoard()
  const saved = (await $.store.get(await boardKey($))) as Board | undefined
  await $.state.set(BOARD, saved ?? EMPTY)
  if (saved?.rows.some(r => !isDone(r)) === true) scheduleBoard($, 1)
}

async function openPrs($: EngineInterface): Promise<void> {
  const at = await $.clock.now()
  dotsSince = (await read($, board)).seenAt
  await changeBoard($, b => ({ ...b, seenAt: at }))
  await $.ui.open({ id: PRS_PANE, title: PRS_TITLE, focus: true, closeOnEscape: true, rows: 14 })
}

async function openTracked($: EngineInterface, id: string | null): Promise<void> {
  const row = (await read($, board)).rows.find(r => prId(r) === id)
  if (row === undefined) return
  await $.process.run(['gh', 'pr', 'view', String(row.number), '-R', row.repo, '--web']).catch(() => null)
}

/** Hands a tracked PR to Ship It to see through, when it isn't already driving one. */
async function promote($: EngineInterface, id: string): Promise<void> {
  const s = await read($, ship)
  const row = (await read($, board)).rows.find(r => prId(r) === id)
  if ((s !== null && s.phase !== 'closed') || row === undefined || isDone(row)) return
  await begin($, { ...fresh(await $.clock.now()), phase: 'watching', number: row.number, url: row.url, repo: row.repo, turn: null })
  await untrack($, id)
  schedule($, 1)
  await $.ui.close({ id: PRS_PANE }).catch(() => undefined)
  await openPane($)
}

// A PR watched when `/clear` ran, kept until the new session starts.
let carried: Ship | null = null
let timer: { cancel: () => void } | null = null
let lastPrint = ''
let quiet = 0

function stopPolling(): void {
  timer?.cancel()
  timer = null
}

function schedule($: EngineInterface, ms: number): void {
  stopPolling()
  timer = $.clock.after(ms, () => void poll($).catch(() => schedule($, settings.pollMs)))
}

async function poll($: EngineInterface): Promise<void> {
  const s = await read($, ship)
  if (s === null || s.number === null || s.repo === null || s.phase === 'raising' || s.phase === 'closed') return
  const seen = await look($, s.repo, s.number)
  if (seen === null) return schedule($, settings.pollMs)
  const { view, talk } = seen
  const checks = checksOf(view.statusCheckRollup ?? [])
  const open = itemsOf(view, talk, checks)
  const print = JSON.stringify([view.state, view.reviewDecision, view.mergeable, checks, open.map(i => i.id)])
  quiet = print === lastPrint ? quiet + 1 : 0
  lastPrint = print

  if (view.state !== 'OPEN') {
    const word = view.state === 'MERGED' ? 'was merged' : 'was closed'
    await change($, x => ({ ...x, phase: 'closed', checks, open, turn: null, banner: `#${x.number} ${word}` }))
    stopPolling()
    return tell($, `#${s.number} ${word}`)
  }

  const ready = isReady(view, talk, checks)
  const now = await change($, x => {
    const phase = ready && (x.phase === 'watching' || x.phase === 'handed-back') ? 'ready' : !ready && x.phase === 'ready' ? 'watching' : x.phase
    return { ...x, phase, checks, open, banner: phase === 'ready' && x.phase !== 'ready' ? `#${x.number} is ready to merge` : x.banner }
  })
  if (now === null) return
  if (now.phase === 'ready' && s.phase !== 'ready') {
    await tell($, `#${now.number} is ready to merge`)
    if (settings.canMerge && !now.isMergeAsked) await merge($, now)
  }
  await answer($, now)
  schedule($, settings.pollMs * 2 ** Math.min(quiet, MAX_BACKOFF))
}

/** Hands new items to Claude, or hands the PR back once the rounds are used up. */
async function answer($: EngineInterface, s: Ship): Promise<void> {
  if ((s.phase !== 'watching' && s.phase !== 'ready') || s.turn !== null) return
  const items = s.open.filter(i => !s.handled.includes(i.id) && (!i.isBot || s.botRounds < BOT_ROUNDS))
  if (items.length === 0) return
  if (s.rounds >= settings.maxRounds) {
    if (s.phase === 'ready') return
    await change($, x => ({ ...x, phase: 'handed-back', banner: `#${x.number}: ${settings.maxRounds} rounds done, over to you` }))
    return tell($, `#${s.number}: ${settings.maxRounds} rounds done, over to you`)
  }
  const asked = await change($, x => ({
    ...x,
    phase: 'watching',
    handled: [...x.handled, ...items.map(i => i.id)],
    rounds: x.rounds + 1,
    botRounds: x.botRounds + (items.some(i => i.isBot) ? 1 : 0),
    turn: 'queued',
  }))
  if (asked === null) return
  try {
    await $.prompt.submit({ text: addressPrompt(asked, items) })
    await change($, x => ({ ...x, turn: 'running' }))
  } catch {
    await change($, x => ({ ...x, turn: null }))
  }
}

async function merge($: EngineInterface, s: Ship): Promise<void> {
  if (s.repo === null || s.number === null) return
  await change($, x => ({ ...x, isMergeAsked: true }))
  const allowed = (await gh($, ['repo', 'view', s.repo, '--json', 'squashMergeAllowed,mergeCommitAllowed,rebaseMergeAllowed'])) as Record<string, boolean> | null
  const method = allowed?.squashMergeAllowed !== false ? '--squash' : allowed.mergeCommitAllowed ? '--merge' : '--rebase'
  const done = await $.process.run(['gh', 'pr', 'merge', String(s.number), '-R', s.repo, method]).catch(() => null)
  await tell($, done?.exitCode === 0 ? `Merged #${s.number}` : `Could not merge #${s.number}: ${done?.stderr.trim() ?? 'gh failed'}`)
}

function fresh(at: number): Ship {
  return {
    phase: 'raising',
    number: null,
    url: null,
    repo: null,
    checks: [],
    open: [],
    handled: [],
    outcomes: [],
    rounds: 0,
    botRounds: 0,
    turn: 'queued',
    raiseTurns: 0,
    hasReplied: false,
    isMergeAsked: false,
    banner: null,
    at,
  }
}

async function raise($: EngineInterface): Promise<void> {
  if ((await $.session.repo()) === null) return $.ui.toast('🚢 Ship It works inside a git repository')
  const auth = await $.process.run(['gh', 'auth', 'status']).catch(() => null)
  if (auth?.exitCode !== 0) return $.ui.toast('🚢 Ship It needs the GitHub CLI, signed in: gh auth login')
  await begin($, fresh(await $.clock.now()))
  try {
    await $.prompt.submit({ text: raisePrompt() })
    await change($, x => ({ ...x, turn: 'running' }))
  } catch {
    await begin($, null)
  }
}

/** After a turn while raising: the branch's PR, once there is one. */
async function findPr($: EngineInterface): Promise<void> {
  const pr = (await gh($, ['pr', 'view', '--json', 'number,url,state'])) as { number: number; url: string; state: string } | null
  const repo = pr === null ? null : repoOf(pr.url)
  if (pr !== null && pr.state === 'OPEN' && repo !== null) {
    await change($, x => ({ ...x, phase: 'watching', number: pr.number, url: pr.url, repo, turn: null }))
    await untrack($, `${repo}#${pr.number}`)
    return schedule($, 1)
  }
  const now = await change($, x => ({ ...x, turn: null, raiseTurns: x.raiseTurns + 1 }))
  if (now !== null && now.raiseTurns >= RAISE_TURNS) {
    await begin($, null)
    $.ui.toast('🚢 No PR found for this branch; Ship It stopped')
  }
}

async function press($: EngineInterface): Promise<void> {
  const s = await read($, ship)
  if (s === null || s.phase === 'closed') return raise($)
  await openPane($)
}

async function openPane($: EngineInterface): Promise<void> {
  await $.ui.open({ id: PANE, title: TITLE, focus: true, closeOnEscape: true, rows: 20 })
}

async function openPr($: EngineInterface): Promise<void> {
  const s = await read($, ship)
  if (s?.number == null || s.repo === null) return
  await $.process.run(['gh', 'pr', 'view', String(s.number), '-R', s.repo, '--web']).catch(() => null)
}

async function stop($: EngineInterface): Promise<void> {
  stopPolling()
  await begin($, null)
  await $.ui.close({ id: PANE }).catch(() => undefined)
}

async function togglePause($: EngineInterface): Promise<void> {
  const now = await change($, x => ({ ...x, phase: x.phase === 'paused' ? 'watching' : 'paused' }))
  if (now?.phase === 'watching') schedule($, 1)
}

async function anotherRound($: EngineInterface): Promise<void> {
  await change($, x => ({ ...x, phase: 'watching', rounds: 0, botRounds: 0, banner: null }))
  schedule($, 1)
}

const DIDS: readonly Did[] = ['fixed', 'pushed-back', 'rerun', 'reported', 'skipped']

export function outcomesOf(input: unknown): Outcome[] {
  const list = (input as { outcomes?: unknown } | null)?.outcomes
  if (!Array.isArray(list)) return []
  return list.flatMap((o: unknown) => {
    const { id, did, note } = (o ?? {}) as Record<string, unknown>
    return typeof id === 'string' && DIDS.includes(did as Did) ? [{ id, did: did as Did, note: typeof note === 'string' ? note : '' }] : []
  })
}

async function load($: EngineInterface): Promise<void> {
  stopPolling()
  const saved = (await $.store.get(await storeKey($))) as Ship | undefined
  // A raise or a turn in flight did not survive the restart.
  const s = saved === undefined || saved.phase === 'raising' ? null : { ...saved, turn: null }
  await $.state.set(SHIP, s)
  if (s !== null && s.phase !== 'closed') schedule($, 1)
}

async function prune($: EngineInterface): Promise<void> {
  const cutoff = (await $.clock.now()) - KEEP_DAYS * 24 * 60 * 60 * 1000
  for (const key of await $.store.keys()) {
    if (key.startsWith('ship:')) {
      const s = (await $.store.get(key)) as Ship | undefined
      if ((s?.at ?? 0) < cutoff) await $.store.delete(key)
    }
    if (key.startsWith('board:')) {
      const b = (await $.store.get(key)) as Board | undefined
      if (Math.max(0, ...(b?.rows ?? []).map(r => r.changedAt)) < cutoff) await $.store.delete(key)
    }
  }
}

// The hint line under the prompt can be shared with other mods: items on a row keyed `desk-hint` are kept
// in order by their keys, so the row reads the same in any load order.
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

// The engine draws the band's collapse mark `[-]` over the right end of its first row.
const MARKER_CELLS = 4

const CHECK_ICON = { pass: '✅', pending: '⏳', fail: '❌' } as const
const ITEM_ICON = { thread: '💬', comment: '💬', review: '📝', check: '❌', conflict: '⚔️' } as const
const DID_WORD: Record<Did, string> = { fixed: 'fixed', 'pushed-back': 'pushed back', rerun: 'reran', reported: 'reported', skipped: 'skipped' }

export const register: Register = (on, options) => {
  settings = {
    isConfirming: options.confirmOutward !== false,
    pollMs: Math.max(15, Number(options.pollSeconds ?? 60)) * 1000,
    maxRounds: Math.max(1, Number(options.maxRounds ?? 5)),
    canMerge: options.allowAutoMerge === true,
  }

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: COMMAND, description: '🚢 Raise a PR for this work and see it through to mergeable' })
    await $.command.register({ name: PRS_COMMAND, description: '🚢 Linked PRs: state, CI and feedback (add or remove <link|#n>)' })
    await $.tool.register({
      name: 'report',
      description: 'Ship It: record what you did about each PR item it handed you, once you have replied and pushed.',
      inputSchema: {
        type: 'object',
        properties: {
          outcomes: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'The item id Ship It gave, e.g. thread:PRRT_x:PRRC_y' },
                did: { type: 'string', enum: DIDS },
                note: { type: 'string', description: 'One short line: what changed, or why not' },
              },
              required: ['id', 'did', 'note'],
            },
          },
        },
        required: ['outcomes'],
      },
    })
    void prune($).catch(() => undefined)
    if (e.isInteractive) {
      void load($)
        .then(() => loadBoard($))
        .then(() => trackBranch($))
        .catch(() => undefined)
    }
    return next(e)
  })

  // `/clear` and `/resume` go on under a new session id and fire no `session.start`. A clear keeps watching the
  // same PR, which is what What's Next's fresh start needs; a resume picks up whatever that session watched.
  on('classic.SessionStart', ($, e, next) => {
    if (e.source === 'resume') {
      void load($).catch(() => undefined)
      void loadBoard($).catch(() => undefined)
    }
    if (e.source === 'clear' && carried !== null) {
      const s = carried
      carried = null
      void begin($, s)
        .then(() => schedule($, 1))
        .catch(() => undefined)
    }
    if (e.source === 'clear' && carriedBoard !== null) {
      const b = carriedBoard
      carriedBoard = null
      void changeBoard($, () => b)
        .then(() => scheduleBoard($, 1))
        .catch(() => undefined)
    }
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear' || e.reason === 'resume') {
      stopPolling()
      const s = await read($, ship).catch(() => null)
      carried = e.reason === 'clear' && s !== null && s.phase !== 'raising' && s.phase !== 'closed' ? { ...s, turn: null } : null
      // A clear moves the watch to the new session; a resume leaves it stored for when this session is resumed.
      await (e.reason === 'clear' ? begin($, null) : $.state.set(SHIP, null)).catch(() => undefined)

      stopBoard()
      const b = await read($, board).catch(() => EMPTY)
      carriedBoard = e.reason === 'clear' && b.rows.some(r => !isDone(r)) ? { ...b, rows: b.rows.filter(r => !isDone(r)), banner: null, bannerPr: null } : null
      await (e.reason === 'clear' ? changeBoard($, () => EMPTY) : $.state.set(BOARD, EMPTY)).catch(() => undefined)
    }
    return next(e)
  })

  on('model.fork', async ($, e, next) => {
    if (next.origin.plugin !== 'whats-next') return next(e)
    const s = await read($, ship)
    const rows = (await read($, board)).rows.filter(r => !isDone(r))
    const notes = [
      ...(s === null || s.phase === 'raising' || s.phase === 'closed' ? [] : [briefingNote(s)]),
      ...(rows.length === 0 ? [] : [boardNote(rows)]),
    ]
    return notes.length === 0 ? next(e) : next({ ...e, prompt: [e.prompt, ...notes].join('\n\n') })
  })

  on('command.run', { command: PRS_COMMAND }, async ($, e) => {
    const [verb = '', ...rest] = e.args.trim().split(/\s+/)
    if (verb === 'add' || verb === 'remove') {
      const pr = parseRef(rest.join(' '), repoOfRemote((await $.session.repo())?.remote))
      if (pr === null) return { text: '🚢 Name a PR: a link, owner/name#12 or #12' }
      if (verb === 'remove') return { text: (await untrack($, prId(pr))) ? `🚢 Stopped tracking #${pr.number}` : `🚢 Not tracking #${pr.number}` }
      return { text: (await track($, [pr], 'manual')) > 0 ? `🚢 Tracking #${pr.number}` : `🚢 Already on #${pr.number}` }
    }
    await openPrs($)
    return { text: '🚢 Linked PRs' }
  })

  on('command.run', { command: COMMAND }, async $ => {
    const s = await read($, ship)
    if (s !== null && s.phase !== 'closed') {
      await openPane($)
      return { text: `🚢 Watching #${s.number ?? '…'}` }
    }
    // A prompt submitted from this hook would wait on the turn the command holds, so it goes once the command is done.
    $.clock.after(1, () => void raise($).catch(() => undefined))
    return { text: '🚢 Over to Claude to raise the PR' }
  })

  on('turn.complete', ($, e, next) => {
    if (e.agentId === undefined) {
      void (async () => {
        const s = await read($, ship)
        if (s === null) return
        if (s.phase === 'raising' && s.turn !== 'queued') return findPr($)
        if (s.turn === 'running') {
          await change($, x => ({ ...x, turn: null }))
          schedule($, AFTER_TURN_MS)
        }
      })().catch(() => undefined)
    }
    return next(e)
  })

  on('prompt.submit', ($, e, next) => {
    if (e.origin.kind !== 'plugin') {
      void change($, x => (x.banner === null ? x : { ...x, banner: null })).catch(() => undefined)
      void (async () => {
        if ((await read($, board)).banner !== null) await changeBoard($, b => ({ ...b, banner: null, bannerPr: null }))
        const pasted = prsIn(e.text)
        if (pasted.length > 0) await track($, pasted, 'pasted')
      })().catch(() => undefined)
    }
    return next(e)
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const done = await next(e)
    void linked($, done).catch(() => undefined)
    return done
  })

  on('tool.call', { tool: REPORT }, async ($, e) => {
    const outcomes = outcomesOf(e)
    const now = await change($, x => ({
      ...x,
      hasReplied: true,
      outcomes: [...x.outcomes.filter(o => !outcomes.some(n => n.id === o.id)), ...outcomes],
      banner: `#${x.number} · ${tally(outcomes)} · ${ciWord(x.checks)}`,
    }))
    return { result: now === null ? 'Ship It is not watching a PR.' : `Recorded ${outcomes.length} outcome${outcomes.length === 1 ? '' : 's'}.` }
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const s = await read($, ship)
    if (s === null || s.phase === 'closed') return next(e)
    if (isRewrite(e.command)) return { deny: 'Ship It: no force-pushes or history rewrites while it watches a PR. Make a new commit instead.' }
    const foreign = resolvedIn(e.command).filter(id => !handedThreads(s).includes(id))
    if (foreign.length > 0) return { deny: `Ship It: ${foreign.join(', ')} was not handed to you, so leave it for its reviewer.` }
    return next(e)
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'Ship It: its guard failed, so the command did not run.' }))

  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const below = await next(e)
    const s = await read($, ship)
    const { Box, Button } = $.ui.resolve(e)
    const wrap = (children: RenderNode[]) => (
      <Box key={DESK} flexDirection="row" columnGap={2}>
        {children}
      </Box>
    )
    const row = joinDesk(below, <Button key="desk-4-ship-it" plain dimColor label={labelOf(s)} onPress={() => void press($)} />, wrap)
    const chips = trackLabel(await read($, board))
    return chips === null ? row : joinDesk(row, <Button key="desk-5-ship-it-prs" plain dimColor label={chips} onPress={() => void openPrs($)} />, wrap)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const s = await read($, ship)
    const b = await read($, board)
    if (e.props.hasSurvey || (s?.banner == null && b.banner === null)) return next(e)
    const below = await next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {below}
        {s?.banner != null && (
          <Box flexDirection="row" flexWrap="wrap" columnGap={2} width={e.props.bodyColumns - MARKER_CELLS}>
            <Box flexShrink={1}>
              <Text>🚢 {s.banner}</Text>
            </Box>
            <Box flexDirection="row" columnGap={2} flexShrink={0}>
              {s.number !== null && <Button key="band-pr" plain label="Open PR" onPress={() => void openPr($)} />}
              <Button key="band-details" plain label="Details" onPress={() => void openPane($)} />
              <Button key="band-dismiss" plain dimColor label="Dismiss" onPress={() => void change($, x => ({ ...x, banner: null }))} />
            </Box>
          </Box>
        )}
        {b.banner !== null && (
          <Box flexDirection="row" flexWrap="wrap" columnGap={2} width={e.props.bodyColumns - MARKER_CELLS}>
            <Box flexShrink={1}>
              <Text>🚢 {b.banner}</Text>
            </Box>
            <Box flexDirection="row" columnGap={2} flexShrink={0}>
              {b.bannerPr !== null && <Button key="track-pr" plain label="Open PR" onPress={() => void openTracked($, b.bannerPr)} />}
              <Button key="track-details" plain label="Details" onPress={() => void openPrs($)} />
              <Button key="track-dismiss" plain dimColor label="Dismiss" onPress={() => void changeBoard($, x => ({ ...x, banner: null, bannerPr: null }))} />
            </Box>
          </Box>
        )}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PRS_PANE }, async ($, e) => {
    const s = await read($, ship)
    const b = await read($, board)
    const at = await $.clock.now()
    const { Box, Text, Button } = $.ui.resolve(e)
    const isDriving = s !== null && s.phase !== 'closed' && s.phase !== 'raising'
    const chosen = b.rows.find(r => prId(r) === b.selected) ?? b.rows[0]
    return (
      <Box flexDirection="column">
        {isDriving && (
          <Text dimColor wrap="truncate-end">
            {'  '}
            {labelOf(s)} · Ship It is seeing this one through
          </Text>
        )}
        {b.rows.length === 0 && <Text dimColor>No other linked PRs. Paste a PR link, or run /prs add &lt;link|#n&gt;.</Text>}
        {b.rows.map(r => (
          <Button key={`row-${prId(r)}`} plain dimColor={r !== chosen} onPress={() => void changeBoard($, x => ({ ...x, selected: prId(r) }))}>
            {rowText(r, at, r.changedAt > dotsSince, e.props.bodyColumns)}
          </Button>
        ))}
        {chosen !== undefined && (
          <Box flexDirection="row" columnGap={2} marginTop={1}>
            <Text dimColor>#{chosen.number}:</Text>
            <Button key="prs-open" hotkey="o" plain label="Open" autoFocus onPress={() => void openTracked($, prId(chosen))} />
            {!isDriving && !isDone(chosen) && <Button key="prs-ship" hotkey="s" plain label="Ship it" onPress={() => void promote($, prId(chosen))} />}
            <Button key="prs-untrack" hotkey="x" plain label="Untrack" onPress={() => void untrack($, prId(chosen))} />
            <Button key="prs-refresh" hotkey="r" plain label="Refresh" onPress={() => scheduleBoard($, 1)} />
          </Box>
        )}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const s = await read($, ship)
    const { Box, Text, Button } = $.ui.resolve(e)
    if (s === null || s.phase === 'closed') {
      return (
        <Box flexDirection="column">
          <Text bold>🚢 Ship It</Text>
          <Text dimColor>{s === null ? 'Not watching a PR. Press 🚢 ship it to raise one.' : `${s.banner ?? 'Done.'}`}</Text>
        </Box>
      )
    }
    const outcome = (id: string) => s.outcomes.find(o => o.id === id)
    const talking = s.open.filter(i => i.kind !== 'check')
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" columnGap={1} marginBottom={1}>
          <Text bold>{labelOf(s)}</Text>
          <Text dimColor>
            · round {s.rounds} of {settings.maxRounds}
          </Text>
        </Box>
        <Text bold>Checks</Text>
        {s.checks.length === 0 && <Text dimColor>  none yet</Text>}
        {s.checks.map(c => (
          <Text key={`check-${c.name}`} wrap="truncate-end">
            {'  '}
            {CHECK_ICON[c.state]} {c.name}
          </Text>
        ))}
        <Box marginTop={1}>
          <Text bold>Open</Text>
        </Box>
        {talking.length === 0 && <Text dimColor>  nothing open</Text>}
        {talking.map(item => {
          const did = outcome(item.id)
          const waiting = s.handled.includes(item.id) ? (did === undefined ? 'with Claude' : `${DID_WORD[did.did]}: ${did.note}`) : 'not handed over yet'
          return (
            <Box key={`item-${item.id}`} flexDirection="column">
              <Text wrap="truncate-end">
                {'  '}
                {ITEM_ICON[item.kind]} {item.author}
                {item.path !== undefined ? ` · ${item.path}` : ''} · {item.body.split('\n')[0]}
              </Text>
              <Text dimColor wrap="truncate-end">
                {'     '}→ {waiting}
              </Text>
            </Box>
          )
        })}
        <Box flexDirection="row" columnGap={2} marginTop={1}>
          <Button key="act-pr" hotkey="o" plain label="Open PR" autoFocus onPress={() => void openPr($)} />
          <Button key="act-pause" hotkey="p" plain label={s.phase === 'paused' ? 'Resume' : 'Pause'} onPress={() => void togglePause($)} />
          {s.phase === 'handed-back' && <Button key="act-round" hotkey="r" plain label="Another round" onPress={() => void anotherRound($)} />}
          <Button key="act-stop" hotkey="s" plain label="Stop" onPress={() => void stop($)} />
        </Box>
      </Box>
    )
  })
}
