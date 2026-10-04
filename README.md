<p align="center">
  <img src="docs/logo.png" width="760" alt="Desk Neighbours: seven small colleagues for your Claude Code terminal. Grudge remembers, Your Serve nudges you, Receipts checks claims, Shrink Ray trims noise, Previously On catches you up, Show & Tell shows you, Closing Time closes the PR.">
</p>

<p align="center">
  <a href="https://github.com/LorcanChinnock/claude-desk-neighbours/actions/workflows/validate.yml"><img src="https://github.com/LorcanChinnock/claude-desk-neighbours/actions/workflows/validate.yml/badge.svg" alt="CI"></a>
  <img src="https://img.shields.io/badge/Claude%20Code-2.1.289-d97757" alt="Built for Claude Code 2.1.289">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license"></a>
</p>

<p align="center">
  <a href="#-grudge">😤 Grudge</a> ·
  <a href="#-your-serve">🎾 Your Serve</a> ·
  <a href="#-receipts">🧾 Receipts</a> ·
  <a href="#-shrink-ray">🔫 Shrink Ray</a> ·
  <a href="#-previously-on">📺 Previously On</a> ·
  <a href="#-show--tell">📸 Show & Tell</a> ·
  <a href="#-closing-time">🔔 Closing Time</a>
</p>

Claude Code does the actual work well. It's the stuff around the work that slips. You correct it and it's
forgotten by the next session. It asks you something in the last line of a long reply. It says "fixed!" without
running anything, reads a 1,200-line log in full, and has no way to catch you up when you come back from lunch.
**Desk Neighbours** are seven small mods, one for each of those. They sit in a status row under your prompt and
only pipe up, in a single line above it, when there's something worth saying.

```
/plugin marketplace add LorcanChinnock/claude-desk-neighbours
```

Then install whichever ones you want. They all work on their own, and they play nicely together if you have more
than one:

```
/plugin install grudge@claude-desk-neighbours
/plugin install your-serve@claude-desk-neighbours
/plugin install receipts@claude-desk-neighbours
/plugin install shrink-ray@claude-desk-neighbours
/plugin install previously-on@claude-desk-neighbours
/plugin install show-and-tell@claude-desk-neighbours
/plugin install closing-time@claude-desk-neighbours
```

---

## 😤 Grudge

**Remembers your corrections, so you only have to say "no, use pnpm" once.**

![Saying "no, use pnpm, not npm": Grudge offers to hold it while Claude works, and 4 holds it](docs/screenshots/grudge.gif)

- Short prompts that look like corrections go to Haiku, which decides whether you've stated a lasting preference
  ("use pnpm, not npm") or a one-off ("that's the wrong file"). You only get offered the lasting ones, and nothing
  is saved unless you press Hold.
- Held rules get sent with every request in that repo, so Claude already knows them when a session starts.
  Personal style, like British spelling, applies in every repo.
- If a rule is a straight command swap (`npm` → `pnpm`, `python` → `python3` and a few others), Grudge rewrites
  the command before it runs and leaves a note under the tool call: `😤 grudge #1: npm → pnpm`. It only does this
  where the arguments mean the same thing for both commands.
- `/grudges` shows what it's holding, how many times each rule has been enforced, and a Forgive button.

[Everything Grudge does →](plugins/grudge)

## 🎾 Your Serve

**Lets you know when Claude is waiting on you, so you don't miss the question at the bottom of a long answer.**

![Claude ends a long answer with a question; Your Serve puts it above the prompt with its answers, and 1 sends the reply straight to Claude](docs/screenshots/your-serve.gif)

- When a turn ends by asking you something, Haiku pulls out what you need to answer and up to three possible
  answers. Each answer is labelled with the choice itself ("Add 30s cap"), not "Option 2".
- Pressing `1`, `2` or `3` sends Claude a natural-sounding reply, so there's no Enter to press after. If you've
  already started typing, the reply goes on the end of your draft instead, for you to finish and send.
- If the turn took more than a minute you also get a toast, and on macOS it can say "Claude needs a decision" out
  loud.
- It ignores plain statements and subagent turns, so it only speaks up when it's actually your move.

[Everything Your Serve does →](plugins/your-serve)

## 🧾 Receipts

**Catches "fixed" when nothing has run since the last edit, along with any debug lines left behind.**

![Claude adds a console.log and says it didn't run anything; Receipts flags the crumb, and 7 sends a prompt to sweep it, which Claude does](docs/screenshots/receipts.gif)

- If a turn edits files and then says "done", "fixed" or "tests pass" when nothing that checks the work has run
  since the last edit, Receipts points it out under the answer. Press `6` to ask Claude to run the check.
- It works out each repo's check command from the last test, typecheck, lint or build that passed, and remembers
  it between sessions.
- It also looks for crumbs in the lines Claude added this turn: `console.log`, `debugger`, `.only(`, `fit(`,
  `binding.pry`, `dbg!` and new `TODO`s. `7` asks Claude to clean them up.
- The second time in a session that a receipt is missing, it offers to make "always run the tests before saying
  done" a rule. If you have Grudge installed, Grudge will offer to hold it.

[Everything Receipts does →](plugins/receipts)

## 🔫 Shrink Ray

**Cuts a 1,240-line CI log down to the 30 lines Claude actually needs.**

![A 272-line test run reaches Claude as 50 lines; Claude reads the saved original for the totals, then the pane lists the shrink](docs/screenshots/shrink-ray.gif)

- Command output over 150 lines gets shrunk before Claude sees it. Colour codes and progress bars are stripped,
  repeated lines collapse into `×37`, and passing tests are dropped. Failures, anything that looks like an error,
  the exit code, and the start and end of the output are always kept.
- The full output is saved and Claude gets the path, so it can go and read the rest if it needs to. Originals
  are cleaned up after seven days.
- The status row keeps a running count of tokens saved (`🔫 1.8k deflected`), and `/shrink-ray` lists every
  shrink with a button to copy the original's path.
- It makes no model calls. Everything happens locally.

[Everything Shrink Ray does →](plugins/shrink-ray)

## 📺 Previously On

**Catches you up when you come back.**

![After 20 minutes away, the first keystroke brings up a recap of the session; 0 dismisses it](docs/screenshots/previously-on.gif)

- After 20 minutes idle, your first keystroke brings up a short "Previously on…" recap of what's waiting on you,
  what's done and what's still pending. It's generated once each time you come back, and reused if nothing has
  changed.
- The first session of your day shows what you worked on last time, across all your repos.
- `/standup` prints yesterday's and today's sessions so you can paste them straight into your standup channel.
- It keeps one short line per session, for two weeks.

[Everything Previously On does →](plugins/previously-on)

## 📸 Show & Tell

**Shows a thumbnail as soon as you paste a screenshot, and keeps a gallery of every image in the session.**

![A pasted screenshot of a broken checkout shows as a thumbnail before sending; Claude fixes it and snapshots the page, and /gallery shows both](docs/screenshots/show-and-tell.gif)

- Hit `ctrl+v` with a screenshot on your clipboard and a thumbnail shows up above the prompt straight away,
  before you've sent anything. It disappears when you send, or after 20 seconds.
- Claude's pictures show up the same way: images it reads, screenshots from browser and MCP tools, and anything
  it writes or generates with a command (`playwright screenshot`, a chart script).
- `/gallery` lists them all, newest first, with a big preview. From there you can open one, put `@path` in your
  prompt, copy its path or show it in its folder.
- Pictures only render in terminals that support the kitty graphics protocol, like Ghostty and kitty. Other
  terminals, tmux and the desktop app show the same rows as text.

[Everything Show & Tell does →](plugins/show-and-tell)

## 🔔 Closing Time

**Watches a PR until CI passes and the agent reviewers are happy, and pushes back on review comments that are wrong.**

![/ship raises the PR; CI fails and Claude fixes it; a bot leaves three comments; triage accepts one and declines two; the replies are posted and the PR goes green](docs/screenshots/closing-time.gif)

- `/ship` gets Claude to raise the PR, and Closing Time watches it from then on. It picks up any other PR Claude
  raises with `gh pr create` too, and `/closing-time watch 123` watches one that already exists.
- When CI fails, Claude gets the failing checks and the end of their logs once they've all finished, and is told to
  fix the cause rather than weaken the check. A job whose log looks like a flake is rerun once instead.
- Each bot review comment goes to a read-only triage agent first. It checks the claim against the code and
  accepts, declines or hands it to you, with evidence. Claude only gets the accepted ones, and comment text always
  reaches it as quoted data.
- Replies to declined and fixed comments are drafted, and none are posted until you press Post. It hands over to
  you after 2 failed fixes on one check or 3 rounds of review fixes, and it never merges.

[Everything Closing Time does →](plugins/closing-time)

---

## How they work together

There's a status row under the prompt with one item for each neighbour you've installed, always in the same
order. Click an item, or run its command, to open its pane. Open a few and they turn into tabs. Esc closes a pane.

```
? for shortcuts   😤 3 grudges  🎾 ready  🧾 2 unchecked  🔫 12.4k deflected  📺 on air  📸 4  🔔 #42 CI 3/5 · reviews 1/2
```

When a neighbour has something to tell you, it gets a line in the band above the prompt. Your Serve always goes
on top, and long lines wrap instead of getting cut off:

![Claude Code with five of the neighbours: a Your Serve question and a Previously On recap in the band, the status row below](docs/screenshots/previously-recap.png)

Buttons that write a prompt for you (Your Serve's answers and Receipts' suggestions) send it straight away. If
you've already started typing, the text goes on the end of your draft instead, so you can finish it and send it
yourself. To press one, type its digit into an empty prompt or click it. If there's already text in the prompt, press
`ctrl+x tab` first. Each neighbour has its own digits, so they never clash. Show & Tell's and Closing Time's band
buttons don't have digits, so either click them or open their pane and use its letter keys:

| Your Serve | Grudge | Receipts | Shrink Ray | Previously On |
|---|---|---|---|---|
| `1` `2` `3` | `4` `5` | `6` `7` `8` | `9` | `0` |

The band clears when you send your next prompt.

## Settings

You can change these in `/config`, or with `/plugin configure <plugin>@claude-desk-neighbours`.

| Plugin | Setting | Default |
|---|---|---|
| `your-serve` | Toast when a turn that needs you took longer than (seconds) | 60 |
| `your-serve` | Also say "Claude needs a decision" out loud (macOS) | off |
| `previously-on` | Recap after this many idle minutes | 20 |
| `show-and-tell` | Keep new thumbnails above the prompt for (seconds) | 20 |
| `closing-time` | Watch any PR Claude raises, not only ones from `/ship` | on |
| `closing-time` | Agent reviewers (comma-separated logins; empty means any bot that reviews) | empty |
| `closing-time` | Post thread replies: `ask` waits for you to press Post, `auto` posts them | `ask` |
| `closing-time` | Rerun a job once when its log looks like a flake | on |
| `closing-time` | Fix attempts per check / review rounds before handing over to you | 2 / 3 |
| `closing-time` | Minutes to wait for a bot review / with no change before it stops watching | 15 / 60 |

## What runs in the background

Here's what goes on behind the scenes, so you know before you install:

- **Model calls on your account.** Grudge, Your Serve, Receipts and Previously On send short questions to a small
  model (Haiku): is this a lasting correction, what is Claude asking, is this answer claiming it's done, what was
  this session about. Each call only happens after a cheap local check passes, so most turns don't make any.
  Previously On's recap re-reads the session transcript once each time you come back, mostly from the prompt
  cache. Closing Time asks Haiku whether a failed CI log looks like a flake, and starts one read-only triage
  subagent on your session's model for each bot review comment.
- **GitHub, through `gh`.** Closing Time runs `gh` with your login while it watches a PR: a GraphQL query on
  each check, the PR diff and failed job logs when there's something to look at, and reruns of flaky jobs. It only
  posts replies to review threads when you press Post (or if you've set it to `auto`).
- **Files on disk.** Shrink Ray saves full originals in `~/.claude/shrink-ray/` so Claude can read them if it
  needs to. Show & Tell keeps copies of pasted and tool images in `~/.claude/show-and-tell/`, and uses `cp`,
  `sips` or `magick` to copy and convert them. Both delete files older than seven days when a session starts
  (macOS and Linux).
- **Stored data.** Each plugin keeps a small store in your Claude Code config directory. Grudge keeps its rules
  there, Receipts each repo's check command, Shrink Ray a lifetime counter, and Previously On a log with one line
  per session going back two weeks. Uninstalling a plugin doesn't delete its store.
- Nothing is sent anywhere else.

## Requirements

Desk Neighbours are mods, which means they're plugins written against Claude Code's function-hook API. That API
is still in early access. They're built and tested on Claude Code 2.1.289, and since the API can change between
releases, a newer Claude Code might need a newer version of these plugins. If a mod doesn't seem to be doing
anything, `claude --debug` will log why it didn't load. Please
[open an issue](https://github.com/LorcanChinnock/claude-desk-neighbours/issues) and include that line.

## Updating

Third-party marketplaces don't update by themselves unless you turn on auto-update in `/plugin` → Marketplaces.
To update by hand:

```
claude plugin marketplace update claude-desk-neighbours
```

## Developing

Each plugin lives in `plugins/<name>/` and is listed in [`.claude-plugin/marketplace.json`](.claude-plugin/marketplace.json),
where `metadata.pluginRoot` resolves bare sources under `./plugins`.

```
claude plugin validate . --strict          # the marketplace and every plugin
claude plugin test plugins/<name>          # a mod's tests
claude --plugin-dir plugins/<name>         # try one in a session, reloading on save
```

CI runs the first two on every push and pull request. [CHANGELOG.md](CHANGELOG.md) has the history of what's
changed.

## License

[MIT](LICENSE)
