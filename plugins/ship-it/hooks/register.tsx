import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement, RenderNode } from 'claude-code'

import type { Check, Did, Item, Outcome, Ship } from '../types'

const SHIP = { plugin: 'ship-it', key: 'ship' } as const
const ship = atom(SHIP, null)

const COMMAND = 'ship-it'
const PANE = 'ship-it'
const TITLE = '🚢 Ship It'
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

async function gh($: EngineInterface, args: readonly string[]): Promise<unknown> {
  const done = await $.process.run(['gh', ...args], { timeoutMs: 60_000 }).catch(() => null)
  if (done === null || done.exitCode !== 0) return null
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
    const s = (await $.store.get(key)) as Ship | undefined
    if (key.startsWith('ship:') && (s?.at ?? 0) < cutoff) await $.store.delete(key)
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
    if (e.isInteractive) void load($).catch(() => undefined)
    return next(e)
  })

  // `/clear` and `/resume` go on under a new session id and fire no `session.start`. A clear keeps watching the
  // same PR, which is what What's Next's fresh start needs; a resume picks up whatever that session watched.
  on('classic.SessionStart', ($, e, next) => {
    if (e.source === 'resume') void load($).catch(() => undefined)
    if (e.source === 'clear' && carried !== null) {
      const s = carried
      carried = null
      void begin($, s)
        .then(() => schedule($, 1))
        .catch(() => undefined)
    }
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear' || e.reason === 'resume') {
      stopPolling()
      const s = await read($, ship).catch(() => null)
      carried = e.reason === 'clear' && s !== null && s.phase !== 'raising' && s.phase !== 'closed' ? { ...s, turn: null } : null
      await begin($, null).catch(() => undefined)
    }
    return next(e)
  })

  on('model.fork', async ($, e, next) => {
    const s = next.origin.plugin === 'whats-next' ? await read($, ship) : null
    return s === null || s.phase === 'raising' || s.phase === 'closed' ? next(e) : next({ ...e, prompt: `${e.prompt}\n\n${briefingNote(s)}` })
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
    if (e.origin.kind !== 'plugin') void change($, x => (x.banner === null ? x : { ...x, banner: null })).catch(() => undefined)
    return next(e)
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
    const mine = <Button key="desk-4-ship-it" plain dimColor label={labelOf(s)} onPress={() => void press($)} />
    return joinDesk(below, mine, children => (
      <Box key={DESK} flexDirection="row" columnGap={2}>
        {children}
      </Box>
    ))
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const s = await read($, ship)
    if (e.props.hasSurvey || s?.banner == null) return next(e)
    const below = await next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {below}
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
