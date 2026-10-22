import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import type { Board, Ship, Tracked } from '../types'
import {
  MARKER,
  boardNote,
  briefingNote,
  capped,
  checksOf,
  glyphOf,
  isReady,
  isRewrite,
  itemsOf,
  kindOf,
  labelOf,
  newsOf,
  parseRef,
  prsIn,
  raisePrompt,
  repoOfRemote,
  resolvedIn,
  tally,
  trackLabel,
} from '../hooks/register'
import type { PrNode, PrView, Seen, Talk } from '../hooks/register'

const URL = 'https://github.com/me/app/pull/46'
const HEAD = 'abc123'

const VIEW: PrView = {
  number: 46,
  url: URL,
  state: 'OPEN',
  isDraft: false,
  mergeable: 'MERGEABLE',
  reviewDecision: null,
  headRefOid: HEAD,
  statusCheckRollup: [{ __typename: 'CheckRun', name: 'validate', status: 'IN_PROGRESS', detailsUrl: 'https://ci/1' }],
}

const QUIET: Talk = { threads: [], comments: [], reviews: [] }
const REVIEWER = { login: 'ana', __typename: 'User' }
const BOT = { login: 'claude', __typename: 'Bot' }

function thread(id: string, comments: { id: string; body: string; bot?: boolean }[], isResolved = false): Talk['threads'][number] {
  return {
    id,
    isResolved,
    path: 'src/a.ts',
    line: 3,
    comments: { nodes: comments.map(c => ({ id: c.id, body: c.body, url: `${URL}#${c.id}`, author: c.bot === true ? BOT : REVIEWER })) },
  }
}

const green = (view: PrView): PrView => ({ ...view, statusCheckRollup: [{ __typename: 'CheckRun', name: 'validate', status: 'COMPLETED', conclusion: 'SUCCESS' }] })

type World = {
  clock: ReturnType<typeof mock.clock>
  gh: { view: PrView; talk: Talk; branchPr: { number: number; url: string; state: string } | null; prs: Record<string, PrNode> }
  /** What a Bash call's result carries: the engine's reading of the git and gh work it did. */
  bash: { gitOperation?: unknown }
  ran: string[][]
  asks: string[]
  notes: string[]
  store: Map<string, unknown>
  session: string
}

function world(on: On): World {
  const w: World = { clock: mock.clock(on, { now: 1_000 }), gh: { view: VIEW, talk: QUIET, branchPr: null, prs: {} }, bash: {}, ran: [], asks: [], notes: [], store: new Map(), session: 'sess-1' }
  on('store.get', ($, e) => ({ value: w.store.get(e.key) }))
  on('store.set', ($, e) => {
    w.store.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  on('store.delete', ($, e) => {
    w.store.delete(e.key)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...w.store.keys()] }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  on('classic.SessionStart', () => ({}))
  on('session.id', () => ({ value: w.session }))
  on('session.repo', () => ({ value: { root: '/work/app', remote: 'git@github.com:me/app.git', internal: false, name: null } }))
  on('process.run', ($, e) => {
    const argv = [...e.argv]
    w.ran.push(argv)
    const ok = (out: unknown = '') => ({
      value: { exitCode: 0, stdout: typeof out === 'string' ? out : JSON.stringify(out), stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
    })
    const fail = { value: { exitCode: 1, stdout: '', stderr: 'no pull requests found', isStdoutTruncated: false, isStderrTruncated: false } }
    const [, noun, verb, arg] = argv
    if (noun === 'pr' && verb === 'view' && arg === '--json') return w.gh.branchPr === null ? fail : ok(w.gh.branchPr)
    if (noun === 'pr' && verb === 'view' && argv.includes('--json')) return ok(w.gh.view)
    if (noun === 'api' && argv.some(a => a.includes('p0:'))) {
      const query = argv.find(a => a.startsWith('query=')) ?? ''
      const data: Record<string, unknown> = {}
      for (const m of query.matchAll(/(p\d+): repository\(owner: "([^"]+)", name: "([^"]+)"\) \{\s*pullRequest\(number: (\d+)\)/g)) {
        data[m[1] ?? ''] = { pullRequest: w.gh.prs[`${m[2]}/${m[3]}#${m[4]}`] ?? null }
      }
      // Like GitHub, any part that doesn't resolve fails the call, but the data that did still comes back.
      const isPartial = Object.values(data).some(d => (d as { pullRequest: unknown }).pullRequest === null)
      return isPartial ? { value: { ...ok({ data }).value, exitCode: 1, stderr: 'gh: Could not resolve to a PullRequest' } } : ok({ data })
    }
    if (noun === 'api') {
      const { threads, comments, reviews } = w.gh.talk
      return ok({ data: { repository: { pullRequest: { reviewThreads: { nodes: threads }, comments: { nodes: comments }, reviews: { nodes: reviews } } } } })
    }
    if (noun === 'repo') return ok({ squashMergeAllowed: true, mergeCommitAllowed: true, rebaseMergeAllowed: true })
    return ok()
  })
  on('prompt.submit', ($, e) => {
    if (e.origin.kind === 'plugin') w.asks.push(e.text)
    return { text: e.text }
  })
  on('ui.notify', ($, e) => {
    w.notes.push(e.text)
    return { value: { isSent: true as const, channel: 'kitty' as const } }
  })
  on('ui.toast', ($, e) => {
    w.notes.push(e.text)
    return { value: undefined }
  })
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('ui.close', () => ({ value: undefined }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('tool.register', ($, e) => ({ value: { tool: `mcp__ship-it__${e.name}` } }))
  on('tool.call', ($, e) => ({ result: e.tool === 'Bash' ? { stdout: '', stderr: '', interrupted: false, ...w.bash } : 'ran' }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>? for shortcuts</Text>
  })
  return w
}

const start = ($: Engine) => $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
const turnEnds = ($: Engine) => $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' })
const HINT = { plugin: 'ship-it', component: 'PromptHint', props: { isDraft: false, isWorking: false, hint: '? for shortcuts' } } as const

async function label($: Engine): Promise<string | undefined> {
  const hint = await $.ui.mount({ ...HINT, surface: 'terminal' })
  const text = (await hint.find({ key: 'desk-4-ship-it' }))?.text
  await hint.unmount()
  return text
}

/** Presses the button, lets the raise turn end with the branch's PR open, and takes the first look at it. */
async function shipped($: Engine, w: World): Promise<void> {
  await start($)
  const hint = await $.ui.mount({ ...HINT, surface: 'terminal' })
  await hint.press({ key: 'desk-4-ship-it' })
  await hint.unmount()
  w.gh.branchPr = { number: 46, url: URL, state: 'OPEN' }
  await turnEnds($)
  await w.clock.settle()
  await w.clock.advance(1)
}

test('reads checks, open items and readiness off the PR', () => {
  const checks = checksOf([
    { __typename: 'CheckRun', name: 'a', status: 'COMPLETED', conclusion: 'SUCCESS' },
    { __typename: 'CheckRun', name: 'b', status: 'QUEUED' },
    { __typename: 'StatusContext', context: 'c', state: 'ERROR', targetUrl: 'https://ci/c' },
  ])
  expect(checks.map(c => c.state)).toEqual(['pass', 'pending', 'fail'])

  const talk: Talk = {
    threads: [
      thread('PRRT_1', [{ id: 'C1', body: 'rename this' }]),
      thread('PRRT_2', [{ id: 'C2', body: 'nit' }, { id: 'C3', body: `no, because… ${MARKER}` }]),
      thread('PRRT_3', [{ id: 'C4', body: 'done' }], true),
    ],
    comments: [{ id: 'IC1', body: 'looks off', url: URL, author: BOT }],
    reviews: [
      { id: 'R1', state: 'APPROVED', body: 'lgtm', url: URL, author: REVIEWER },
      { id: 'R2', state: 'CHANGES_REQUESTED', body: 'see threads', url: URL, author: REVIEWER },
    ],
  }
  const items = itemsOf({ ...VIEW, mergeable: 'CONFLICTING' }, talk, checks)
  expect(items.map(i => i.id)).toEqual(['thread:PRRT_1:C1', 'thread:PRRT_2:C2', 'review:R2', 'comment:IC1', `check:c:${HEAD}`, `conflict:${HEAD}`])
  expect(items.find(i => i.kind === 'comment')?.isBot).toBe(true)

  expect(isReady(green(VIEW), QUIET, checksOf(green(VIEW).statusCheckRollup ?? []))).toBe(true)
  expect(isReady(VIEW, QUIET, checksOf(VIEW.statusCheckRollup ?? []))).toBe(false)
  expect(isReady(green(VIEW), { ...QUIET, threads: [thread('PRRT_2', [{ id: 'C3', body: MARKER }])] }, [])).toBe(false)
  expect(isReady({ ...green(VIEW), reviewDecision: 'REVIEW_REQUIRED' }, QUIET, [])).toBe(false)

  expect(tally([{ id: 'a', did: 'fixed', note: '' }, { id: 'b', did: 'fixed', note: '' }, { id: 'c', did: 'pushed-back', note: '' }])).toBe('fixed 2, pushed back on 1')
})

test('knows a rewrite from an ordinary push, and which threads a command resolves', () => {
  for (const bad of ['git push --force', 'git push -f origin x', 'git push -uf origin x', 'git push origin +x', 'git push --force-with-lease', 'git rebase main', 'git commit --amend -m x', 'git reset --hard HEAD~1']) {
    expect([bad, isRewrite(bad)]).toEqual([bad, true])
  }
  for (const fine of ['git push', 'git push -u origin feat/x', 'git commit -m "force the issue"', 'git reset src/a.ts', 'git merge origin/main']) {
    expect([fine, isRewrite(fine)]).toEqual([fine, false])
  }
  expect(resolvedIn(`gh api graphql -f query='mutation { resolveReviewThread(input: {threadId: "PRRT_kw1"}) { thread { id } } }'`)).toEqual(['PRRT_kw1'])
  expect(resolvedIn('gh api graphql -f query=\'mutation { addPullRequestReviewThreadReply(input: {pullRequestReviewThreadId: "PRRT_kw1"}) }\'')).toEqual([])
})

test('the raise asks for explicit paths, no force-push and, by default, confirmation', () => {
  expect(raisePrompt()).toContain('explicit path')
  expect(raisePrompt()).toContain('Never force-push')
  expect(raisePrompt()).toContain('AskUserQuestion')
})

test('one press raises the PR, then the status row follows it', async ($, on) => {
  const w = world(on)
  expect(labelOf(null)).toBe('🚢 ship it')
  await shipped($, w)
  expect(w.asks).toEqual([raisePrompt()])
  expect(w.ran).toContainEqual(['gh', 'auth', 'status'])
  expect(await label($)).toBe('🚢 #46 · CI ⏳')
  expect(w.asks).toHaveLength(1)
})

test('a raise that ends with no PR gives up after three turns', async ($, on) => {
  const w = world(on)
  await start($)
  await $.command.run({ command: 'ship-it', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
  await w.clock.advance(1)
  expect(w.asks).toEqual([raisePrompt()])
  for (let n = 0; n < 3; n += 1) {
    await turnEnds($)
    await w.clock.settle()
  }
  expect(await label($)).toBe('🚢 ship it')
  expect(w.notes).toContain('🚢 No PR found for this branch; Ship It stopped')
})

test('new feedback is handed over once, and again only when someone answers', async ($, on) => {
  const w = world(on)
  w.gh.talk = { ...QUIET, threads: [thread('PRRT_1', [{ id: 'C1', body: 'rename this' }])] }
  await shipped($, w)
  expect(w.asks).toHaveLength(2)
  expect(w.asks[1]).toContain('### thread:PRRT_1:C1')
  expect(w.asks[1]).toContain('rename this')
  expect(w.asks[1]).toContain('push back')
  expect(await label($)).toBe('🚢 #46 · 1 comment')

  // Claude pushed back and the turn ended: its own reply is not new feedback.
  w.gh.talk = { ...QUIET, threads: [thread('PRRT_1', [{ id: 'C1', body: 'rename this' }, { id: 'C2', body: `I'd keep it. ${MARKER}` }])] }
  await turnEnds($)
  await w.clock.settle()
  await w.clock.advance(10_000)
  expect(w.asks).toHaveLength(2)

  // The reviewer answers back.
  w.gh.talk = { ...QUIET, threads: [thread('PRRT_1', [{ id: 'C1', body: 'rename this' }, { id: 'C2', body: MARKER }, { id: 'C5', body: 'please do' }])] }
  await w.clock.advance(60_000 * 2)
  expect(w.asks).toHaveLength(3)
  expect(w.asks[2]).toContain('### thread:PRRT_1:C5')
})

test('no new turn while one is still running, and polling backs off while nothing changes', async ($, on) => {
  const w = world(on)
  await shipped($, w)
  const looks = () => w.ran.filter(a => a[1] === 'api').length
  expect(looks()).toBe(1)
  await w.clock.advance(60_000)
  expect(looks()).toBe(2)
  // Unchanged: the next look is two minutes out, then four.
  await w.clock.advance(60_000)
  expect(looks()).toBe(2)
  await w.clock.advance(60_000)
  expect(looks()).toBe(3)

  w.gh.talk = { ...QUIET, comments: [{ id: 'IC1', body: 'why?', url: URL, author: REVIEWER }] }
  await w.clock.advance(240_000)
  expect(w.asks).toHaveLength(2)
  w.gh.talk = { ...QUIET, comments: [...w.gh.talk.comments, { id: 'IC2', body: 'and this?', url: URL, author: REVIEWER }] }
  await w.clock.advance(60_000)
  // The first round's turn has not ended yet.
  expect(w.asks).toHaveLength(2)
})

test('refuses force-pushes and resolving threads it was not handed', async ($, on) => {
  const w = world(on)
  w.gh.talk = { ...QUIET, threads: [thread('PRRT_mine', [{ id: 'C1', body: 'fix' }])] }
  await shipped($, w)
  const bash = (command: string) => $.tool.call({ tool: 'Bash', command, description: 'x' })
  expect((await bash('git push --force')).deny).toContain('no force-pushes')
  expect((await bash(`gh api graphql -f query='mutation { resolveReviewThread(input: {threadId: "PRRT_other"}) { thread { id } } }'`)).deny).toContain('PRRT_other')
  expect((await bash(`gh api graphql -f query='mutation { resolveReviewThread(input: {threadId: "PRRT_mine"}) { thread { id } } }'`)).deny).toBeUndefined()
  expect((await bash('git push')).deny).toBeUndefined()
})

test('nothing is guarded when Ship It is not watching', async ($, on) => {
  world(on)
  await start($)
  expect((await $.tool.call({ tool: 'Bash', command: 'git push --force', description: 'x' })).deny).toBeUndefined()
})

test('hands the PR back once the rounds are used up, and caps bot rounds sooner', { options: { maxRounds: 3 } }, async ($, on) => {
  const w = world(on)
  await shipped($, w)
  const round = async (id: string, bot: boolean) => {
    w.gh.talk = { ...QUIET, comments: [...w.gh.talk.comments, { id, body: id, url: URL, author: bot ? BOT : REVIEWER }] }
    await w.clock.advance(60_000 * 8)
    await turnEnds($)
    await w.clock.settle()
  }
  await round('B1', true)
  await round('B2', true)
  await round('B3', true)
  // Two bot rounds, then bot comments wait for you.
  expect(w.asks).toHaveLength(3)
  await round('H1', false)
  expect(w.asks).toHaveLength(4)
  await round('H2', false)
  expect(w.asks).toHaveLength(4)
  expect(await label($)).toBe('🚢 #46 · 5 comments')
  expect(w.notes).toContain('#46: 3 rounds done, over to you')
})

test('says when the PR is ready and does not merge it', async ($, on) => {
  const w = world(on)
  w.gh.view = green(VIEW)
  await shipped($, w)
  expect(await label($)).toBe('🚢 #46 · ✅ ready')
  expect(w.notes).toEqual(['#46 is ready to merge'])
  expect(w.ran.some(a => a[2] === 'merge')).toBe(false)
  for (const surface of ['terminal', 'desktop'] as const) {
    const band = await $.ui.mount({
      plugin: 'ship-it',
      surface,
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} },
    })
    expect(await band.find({ type: 'Text', text: '🚢 #46 is ready to merge' })).toBeDefined()
    await band.unmount()
  }
})

test('merges a ready PR when the setting allows it', { options: { allowAutoMerge: true } }, async ($, on) => {
  const w = world(on)
  w.gh.view = green(VIEW)
  await shipped($, w)
  expect(w.ran).toContainEqual(['gh', 'pr', 'merge', '46', '-R', 'me/app', '--squash'])
})

test('a report fills the band and the pane', async ($, on) => {
  const w = world(on)
  w.gh.talk = { ...QUIET, threads: [thread('PRRT_1', [{ id: 'C1', body: 'rename this' }]), thread('PRRT_2', [{ id: 'C2', body: 'use a map' }])] }
  await shipped($, w)
  await $.tool.call({
    tool: 'mcp__ship-it__report',
    outcomes: [
      { id: 'thread:PRRT_1:C1', did: 'fixed', note: 'renamed in 1a2b3c' },
      { id: 'thread:PRRT_2:C2', did: 'pushed-back', note: 'an array is clearer here' },
    ],
  })
  const stored = w.store.get('ship:sess-1') as Ship
  expect(stored.banner).toBe('#46 · fixed 1, pushed back on 1 · CI running')
  for (const surface of ['terminal', 'desktop'] as const) {
    const pane = await $.ui.mount({
      plugin: 'ship-it',
      surface,
      component: 'Pane',
      requestId: 'ship-it',
      props: { title: 'x', isFocused: true, bodyColumns: 90, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
    })
    expect(await pane.find({ type: 'Text', text: /fixed: renamed in 1a2b3c/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /pushed back: an array is clearer here/ })).toBeDefined()
    await pane.press({ key: 'act-pause' })
    expect(await label($)).toBe('🚢 #46 · ⏸ paused')
    await pane.press({ key: 'act-pause' })
    await pane.unmount()
  }
})

test('a new session picks the PR back up from the store', async ($, on) => {
  const w = world(on)
  await shipped($, w)
  const looks = w.ran.filter(a => a[1] === 'api').length
  await start($)
  await w.clock.advance(1)
  expect(w.ran.filter(a => a[1] === 'api').length).toBe(looks + 1)
  expect(await label($)).toBe('🚢 #46 · CI ⏳')
})

test('stop forgets the PR and its poll', async ($, on) => {
  const w = world(on)
  await shipped($, w)
  const pane = await $.ui.mount({
    plugin: 'ship-it',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'ship-it',
    props: { title: 'x', isFocused: true, bodyColumns: 90, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
  })
  await pane.press({ key: 'act-stop' })
  const looks = w.ran.length
  await w.clock.advance(60_000 * 10)
  expect(w.ran.length).toBe(looks)
  expect(w.store.has('ship:sess-1')).toBe(false)
  expect(await label($)).toBe('🚢 ship it')
})

test("a /clear keeps watching the PR under the new session, as What's Next's fresh start needs", async ($, on) => {
  const w = world(on)
  w.gh.talk = { ...QUIET, threads: [thread('PRRT_1', [{ id: 'C1', body: 'rename this' }])] }
  await shipped($, w)
  await $.session.end({ reason: 'clear', sessionId: 'sess-1', resume: { id: 'sess-1' } })
  w.session = 'sess-2'
  await $.classic.SessionStart({ source: 'clear' })
  await w.clock.advance(1)
  expect(w.store.has('ship:sess-1')).toBe(false)
  expect((w.store.get('ship:sess-2') as Ship).number).toBe(46)
  expect(await label($)).toBe('🚢 #46 · 1 comment')

  const note = briefingNote(w.store.get('ship:sess-2') as Ship)
  expect(note).toContain(`PR #46 (${URL})`)
  expect(note).toContain('thread from ana on src/a.ts: rename this')
})

test('leaving with /resume keeps the watch stored for when that session is resumed', async ($, on) => {
  const w = world(on)
  await shipped($, w)
  await $.session.end({ reason: 'resume', sessionId: 'sess-1', resume: { id: 'sess-2' } })
  w.session = 'sess-2'
  await $.classic.SessionStart({ source: 'resume' })
  await w.clock.settle()
  expect(await label($)).toBe('🚢 ship it')
  await $.session.end({ reason: 'resume', sessionId: 'sess-2', resume: { id: 'sess-1' } })
  w.session = 'sess-1'
  await $.classic.SessionStart({ source: 'resume' })
  await w.clock.advance(1)
  expect(await label($)).toBe('🚢 #46 · CI ⏳')
})

test('a ready PR with feedback left past the round cap stays ready and quiet', { options: { maxRounds: 1 } }, async ($, on) => {
  const w = world(on)
  w.gh.view = green(VIEW)
  w.gh.talk = { ...QUIET, comments: [{ id: 'IC1', body: 'nice', url: URL, author: REVIEWER }] }
  await shipped($, w)
  await turnEnds($)
  await w.clock.settle()
  w.gh.talk = { ...QUIET, comments: [...w.gh.talk.comments, { id: 'IC2', body: 'one more thing', url: URL, author: REVIEWER }] }
  await w.clock.advance(10_000)
  const said = [...w.notes]
  await w.clock.advance(60_000 * 30)
  expect(w.notes).toEqual(said)
  expect(w.notes.some(n => n.includes('over to you'))).toBe(false)
  expect(await label($)).toBe('🚢 #46 · ✅ ready')
})

// Linked PRs

const OTHER = 'https://github.com/me/app/pull/51'

function node(number: number, over: Partial<PrNode> = {}, contexts: PrNode['commits']['nodes'][number]['commit']['statusCheckRollup'] = null): PrNode {
  return {
    number,
    url: `https://github.com/me/app/pull/${number}`,
    title: `PR ${number}`,
    state: 'OPEN',
    isDraft: false,
    mergeable: 'MERGEABLE',
    reviewDecision: null,
    commits: { nodes: [{ commit: { statusCheckRollup: contexts } }] },
    reviewThreads: { nodes: [] },
    ...over,
  }
}

const running = { contexts: { nodes: [{ __typename: 'CheckRun', name: 'lint', status: 'IN_PROGRESS' }] } }
const failing = { contexts: { nodes: [{ __typename: 'CheckRun', name: 'lint', status: 'COMPLETED', conclusion: 'FAILURE' }] } }
const passing = { contexts: { nodes: [{ __typename: 'CheckRun', name: 'lint', status: 'COMPLETED', conclusion: 'SUCCESS' }] } }

function row(number: number, over: Partial<Tracked> = {}): Tracked {
  return {
    repo: 'me/app',
    number,
    url: `https://github.com/me/app/pull/${number}`,
    title: `PR ${number}`,
    source: 'session',
    kind: 'open',
    isDraft: false,
    checks: [],
    reviewDecision: null,
    threads: { human: 0, bot: 0 },
    addedAt: 0,
    changedAt: 0,
    ...over,
  }
}

const seen = (over: Partial<Seen>): Seen => ({ title: 't', state: 'OPEN', mergeable: 'MERGEABLE', isDraft: false, reviewDecision: null, checks: [], threads: { human: 0, bot: 0 }, ...over })
const PRS_PANE = { plugin: 'ship-it', surface: 'terminal', component: 'Pane', requestId: 'ship-it-prs', props: { title: 'x', isFocused: true, bodyColumns: 90, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } } as const
const BAND = { plugin: 'ship-it', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} } } as const

async function chips($: Engine): Promise<string | undefined> {
  const hint = await $.ui.mount({ ...HINT, surface: 'terminal' })
  const text = (await hint.find({ key: 'desk-5-ship-it-prs' }))?.text
  await hint.unmount()
  return text
}

const bash = ($: Engine, command = 'gh pr create') => $.tool.call({ tool: 'Bash', command, description: 'x' })
const boardOf = (w: World, session = 'sess-1') => w.store.get(`board:${session}`) as Board | undefined

test('one glyph per PR, the most urgent one', () => {
  const fail = { name: 'lint', state: 'fail' as const, url: null }
  const pending = { name: 'test', state: 'pending' as const, url: null }
  expect(kindOf(seen({ state: 'MERGED', mergeable: 'CONFLICTING' }))).toBe('merged')
  expect(kindOf(seen({ mergeable: 'CONFLICTING', checks: [fail] }))).toBe('conflict')
  expect(kindOf(seen({ checks: [fail, pending], reviewDecision: 'CHANGES_REQUESTED' }))).toBe('fail')
  expect(kindOf(seen({ reviewDecision: 'CHANGES_REQUESTED', threads: { human: 2, bot: 0 } }))).toBe('changes')
  expect(kindOf(seen({ threads: { human: 2, bot: 0 }, checks: [pending] }))).toBe('threads')
  expect(kindOf(seen({ checks: [pending], reviewDecision: 'REVIEW_REQUIRED' }))).toBe('pending')
  expect(kindOf(seen({ reviewDecision: 'REVIEW_REQUIRED' }))).toBe('review')
  expect(kindOf(seen({}))).toBe('ready')
  expect(kindOf(seen({ isDraft: true }))).toBe('open')
  expect(kindOf(seen({ threads: { human: 0, bot: 1 } }))).toBe('open')
  expect(glyphOf(row(1, { kind: 'threads', threads: { human: 3, bot: 0 } }))).toBe('💬3')
  expect(glyphOf(row(1, { kind: null }))).toBe('…')
})

test('the status row shows the most urgent PRs first, and a merged one only until the pane is opened', () => {
  const b: Board = {
    rows: [row(1, { kind: 'pending' }), row(2, { kind: 'fail' }), row(3, { kind: 'merged', changedAt: 5 }), row(4, { kind: 'ready' }), row(5, { kind: 'open' })],
    banner: null,
    bannerPr: null,
    selected: null,
    seenAt: 0,
  }
  expect(trackLabel(b)).toBe('#2 ❌ · #4 ✅ · #1 ⏳ +2')
  expect(trackLabel({ ...b, rows: [row(3, { kind: 'merged', changedAt: 5 })] })).toBe('#3 🟣')
  expect(trackLabel({ ...b, rows: [row(3, { kind: 'merged', changedAt: 5 })], seenAt: 10 })).toBeNull()
  expect(trackLabel({ ...b, rows: [] })).toBeNull()
})

test('says what changed, and nothing on the first look or when nothing that matters did', () => {
  const failed = { name: 'lint', state: 'fail' as const, url: null }
  expect(newsOf(row(1, { kind: null }), row(1, { kind: 'fail', checks: [failed] }))).toBeNull()
  expect(newsOf(row(1, { kind: 'pending' }), row(1, { kind: 'fail', checks: [failed] }))).toBe('#1 CI failed (lint)')
  expect(newsOf(row(1, { kind: 'pending' }), row(1, { kind: 'pending' }))).toBeNull()
  expect(newsOf(row(1, { kind: 'pending' }), row(1, { kind: 'review' }))).toBeNull()
  expect(newsOf(row(1, { kind: 'pending' }), row(1, { kind: 'ready' }))).toBe('#1 ready to merge')
  expect(newsOf(row(1, { kind: 'threads', threads: { human: 1, bot: 0 } }), row(1, { kind: 'threads', threads: { human: 3, bot: 0 } }))).toBe('#1 2 new comments')
})

test('reads PR links, refs and remotes, and keeps at most eight rows', () => {
  expect(prsIn(`see ${OTHER} and ${OTHER}, and https://github.com/acme/web/pull/7.`).map(p => `${p.repo}#${p.number}`)).toEqual(['me/app#51', 'acme/web#7'])
  expect(repoOfRemote('git@github.com:me/app.git')).toBe('me/app')
  expect(repoOfRemote('https://github.com/me/app')).toBe('me/app')
  expect(repoOfRemote('https://gitlab.com/me/app.git')).toBeNull()
  expect(parseRef('#51', 'me/app')?.url).toBe(OTHER)
  expect(parseRef('acme/web#7', 'me/app')?.repo).toBe('acme/web')
  expect(parseRef(OTHER, null)?.number).toBe(51)
  expect(parseRef('51', null)).toBeNull()
  expect(parseRef('the auth one', 'me/app')).toBeNull()
  const rows = [row(1, { kind: 'merged' }), ...[2, 3, 4, 5, 6, 7, 8, 9].map(n => row(n))]
  expect(capped(rows).map(r => r.number)).toEqual([2, 3, 4, 5, 6, 7, 8, 9])
})

test('a PR Claude opens is tracked from the Bash result, once', async ($, on) => {
  const w = world(on)
  await start($)
  w.gh.prs['me/app#51'] = node(51, {}, running)
  w.bash = { gitOperation: { pr: { number: 51, url: OTHER, action: 'created' } } }
  await bash($)
  await w.clock.settle()
  await w.clock.advance(1)
  expect(await chips($)).toBe('#51 ⏳')
  expect(await label($)).toBe('🚢 ship it')
  await bash($, 'gh pr edit 51 --title x')
  await w.clock.settle()
  expect(boardOf(w)?.rows.map(r => [r.number, r.source, r.title])).toEqual([[51, 'session', 'PR 51']])
})

test('a pasted PR link is tracked, but not the one Ship It already drives', async ($, on) => {
  const w = world(on)
  await shipped($, w)
  w.gh.prs['me/app#51'] = node(51, { reviewDecision: 'REVIEW_REQUIRED' })
  await $.prompt.submit({ text: `look at ${URL} and ${OTHER}`, origin: { kind: 'composer' }, wait: false })
  await w.clock.settle()
  await w.clock.advance(1)
  expect(boardOf(w)?.rows.map(r => r.number)).toEqual([51])
  expect(await chips($)).toBe('#51 👀')
  expect(await label($)).toBe('🚢 #46 · CI ⏳')
})

test("the branch's open PR is tracked when a session starts", async ($, on) => {
  const w = world(on)
  w.gh.branchPr = { number: 51, url: OTHER, state: 'OPEN' }
  w.gh.prs['me/app#51'] = node(51)
  await start($)
  await w.clock.settle()
  await w.clock.advance(1)
  expect(boardOf(w)?.rows.map(r => [r.number, r.source, r.kind])).toEqual([[51, 'branch', 'ready']])
})

test('a change worth knowing gets one band line and, when loud, a notification', async ($, on) => {
  const w = world(on)
  await start($)
  w.gh.prs['me/app#51'] = node(51, {}, running)
  w.gh.prs['me/app#52'] = node(52, {}, running)
  await $.command.run({ command: 'prs', args: 'add #51', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
  await $.command.run({ command: 'prs', args: 'add https://github.com/me/app/pull/52', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
  await w.clock.advance(1)
  // Still running: nothing to say.
  await w.clock.advance(60_000)
  expect(boardOf(w)?.banner).toBeNull()
  expect(w.notes).toEqual([])

  w.gh.prs['me/app#51'] = node(51, {}, failing)
  w.gh.prs['me/app#52'] = node(52, {}, passing)
  await w.clock.advance(60_000)
  expect(boardOf(w)?.banner).toBe('#51 CI failed (lint) · #52 ready to merge')
  expect(w.notes).toEqual(['#51 CI failed (lint) · #52 ready to merge'])
  const band = await $.ui.mount(BAND)
  expect(await band.find({ type: 'Text', text: '🚢 #51 CI failed (lint) · #52 ready to merge' })).toBeDefined()
  expect(await band.find({ key: 'track-pr' })).toBeUndefined()
  await band.unmount()

  // Your next prompt clears it.
  await $.prompt.submit({ text: 'ok', origin: { kind: 'composer' }, wait: false })
  await w.clock.settle()
  expect(boardOf(w)?.banner).toBeNull()
})

test('looks less often while nothing changes, and stops once every PR is merged or closed', async ($, on) => {
  const w = world(on)
  await start($)
  w.gh.prs['me/app#51'] = node(51)
  await $.command.run({ command: 'prs', args: 'add #51', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
  const looks = () => w.ran.filter(a => a[1] === 'api').length
  await w.clock.advance(1)
  expect(looks()).toBe(1)
  await w.clock.advance(60_000)
  expect(looks()).toBe(2)
  await w.clock.advance(60_000)
  expect(looks()).toBe(2)
  await w.clock.advance(60_000)
  expect(looks()).toBe(3)

  w.gh.prs['me/app#51'] = node(51, { state: 'MERGED' })
  await w.clock.advance(240_000)
  expect(looks()).toBe(4)
  expect(w.notes).toEqual(['#51 merged'])
  await w.clock.advance(60_000 * 30)
  expect(looks()).toBe(4)
  expect(await chips($)).toBe('#51 🟣')
})

test('the pane lists each PR and hands one to Ship It to see through', async ($, on) => {
  const w = world(on)
  await start($)
  w.gh.prs['me/app#51'] = node(51, { title: 'Fix the recorder crash', reviewThreads: { nodes: [{ isResolved: false, comments: { nodes: [{ body: 'why?', author: { __typename: 'User' } }] } }] } }, failing)
  await $.command.run({ command: 'prs', args: 'add #51', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
  await w.clock.advance(1)
  await $.command.run({ command: 'prs', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
  const pane = await $.ui.mount(PRS_PANE)
  expect((await pane.find({ key: 'row-me/app#51' }))?.text).toMatch(/• ❌ #51 {2}Fix the recorder crash +CI 0\/1 {2}💬 1 {2}now$/)
  await pane.press({ key: 'prs-ship' })
  await pane.unmount()
  await w.clock.advance(1)
  expect(boardOf(w)).toBeUndefined()
  expect((w.store.get('ship:sess-1') as Ship).number).toBe(51)
  expect(await chips($)).toBeUndefined()
})

test('/prs remove and the pane untrack a PR', async ($, on) => {
  const w = world(on)
  await start($)
  w.gh.prs['me/app#51'] = node(51)
  const prs = (args: string) => $.command.run({ command: 'prs', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
  expect((await prs('add #51')).text).toBe('🚢 Tracking #51')
  expect((await prs('add #51')).text).toBe('🚢 Already on #51')
  expect((await prs('add nonsense')).text).toBe('🚢 Name a PR: a link, owner/name#12 or #12')
  expect((await prs('remove #51')).text).toBe('🚢 Stopped tracking #51')
  expect(boardOf(w)).toBeUndefined()
  await prs('add #51')
  const pane = await $.ui.mount(PRS_PANE)
  await pane.press({ key: 'prs-untrack' })
  await pane.unmount()
  expect(boardOf(w)).toBeUndefined()
})

test('tracked PRs survive a new session and a /clear, and go into the briefing', async ($, on) => {
  const w = world(on)
  await start($)
  w.gh.prs['me/app#51'] = node(51, {}, running)
  await $.command.run({ command: 'prs', args: 'add #51', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
  await w.clock.advance(1)

  await start($)
  await w.clock.settle()
  await w.clock.advance(1)
  expect(await chips($)).toBe('#51 ⏳')

  await $.session.end({ reason: 'clear', sessionId: 'sess-1', resume: { id: 'sess-1' } })
  w.session = 'sess-2'
  await $.classic.SessionStart({ source: 'clear' })
  await w.clock.advance(1)
  expect(boardOf(w)).toBeUndefined()
  expect(boardOf(w, 'sess-2')?.rows.map(r => r.number)).toEqual([51])
  expect(boardNote(boardOf(w, 'sess-2')?.rows ?? [])).toContain(`${OTHER} "PR 51": CI running`)
})

test("a PR GitHub can't resolve stops being tracked without freezing the rest", async ($, on) => {
  const w = world(on)
  await start($)
  w.gh.prs['me/app#51'] = node(51, {}, running)
  const prs = (args: string) => $.command.run({ command: 'prs', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
  await prs('add #51')
  await prs('add #99999')
  await w.clock.advance(1)
  expect(boardOf(w)?.rows.map(r => [r.number, r.kind])).toEqual([[51, 'pending']])
  expect(w.notes).toEqual(["🚢 Can't see me/app#99999 on GitHub; stopped tracking it"])

  w.gh.prs['me/app#51'] = node(51, {}, failing)
  await w.clock.advance(60_000)
  expect(boardOf(w)?.banner).toBe('#51 CI failed (lint)')
})
