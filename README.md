<p align="center">
  <img src="docs/logo.png" width="760" alt="Desk Neighbours: small colleagues that sit around your Claude Code terminal, drawn as a prompt box with a neighbour's light on in the status row beneath it.">
</p>

<p align="center">
  <a href="https://github.com/LorcanChinnock/claude-desk-neighbours/actions/workflows/validate.yml"><img src="https://github.com/LorcanChinnock/claude-desk-neighbours/actions/workflows/validate.yml/badge.svg" alt="CI"></a>
  <img src="https://img.shields.io/badge/Claude%20Code-2.1.289-d97757" alt="Built for Claude Code 2.1.289">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license"></a>
</p>

<p align="center">
  <a href="#-your-serve">🎾 Your Serve</a> ·
  <a href="#-show--tell">📸 Show & Tell</a> ·
  <a href="#️-whats-next">⏭️ What's Next</a> ·
  <a href="#-ship-it">🚢 Ship It</a> ·
  <a href="#-reflect">🪞 Reflect</a>
</p>

Claude Code does the actual work well. It's the stuff around the work that slips. It asks you something in the
last line of a long reply. The screenshot you pasted three prompts ago is just `[Image #1]`. The session gets so
long that the context fills up. The PR waits on a review comment you haven't seen. What the session taught Claude is gone when it ends. **Desk Neighbours** are five small mods for that kind of thing. They sit in a status row under your prompt and only pipe up, in a
single line above it, when there's something worth saying.

```
/plugin marketplace add LorcanChinnock/claude-desk-neighbours
```

Then install whichever ones you want. They each work on their own, and play nicely together if you have more than one:

```
/plugin install your-serve@claude-desk-neighbours
/plugin install show-and-tell@claude-desk-neighbours
/plugin install whats-next@claude-desk-neighbours
/plugin install ship-it@claude-desk-neighbours
/plugin install reflect@claude-desk-neighbours
```

---

## 🎾 Your Serve

**A button that has Claude ask you what it needs, so you don't miss the question at the bottom of a long answer.**

- Click `🎾 your serve` in the status row, or run `/your-serve`, and Claude asks each open question in its own
  question picker, one at a time, with the options it would suggest.
- If nothing is waiting on you, Claude says so in one line.
- Press it whenever you like. If Claude is still working, the request waits until the turn is over.

[Everything Your Serve does →](plugins/your-serve)

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

## ⏭️ What's Next

**When a session gets long, writes a briefing for the next task and starts it in a fresh context.**

- Click `⏭️ whats next` in the status row, or run `/whats-next [focus]`. Claude writes a self-contained prompt for
  the next task: the goal, where things stand, the files that matter, decisions made, what didn't work, and how to
  check it's done. Add a focus (`/whats-next the auth tests`) to pick the task yourself.
- The briefing opens in a pane. `Start` clears the conversation and sends it as the first prompt, `Edit` clears it
  and puts the briefing in your prompt box, `Copy` copies it, and `Cancel` leaves everything as it was.
- When the context gets to 70% full, the band above the prompt offers a fresh start, once per session.
- If nothing is left to do, it says so in one line.

[Everything What's Next does →](plugins/whats-next)

## 🚢 Ship It

**One press raises a PR for the session's work, then sees it through to ready-to-merge.**

- Click `🚢 ship it` in the status row, or run `/ship-it`, and Claude commits the files it changed, pushes and
  opens the PR, asking first.
- Ship It then watches CI and reviews. When feedback comes in, Claude works through it critically: it fixes what's
  right, pushes back on what isn't, replies on every thread and resolves the ones it fixed.
- The status row shows the PR's state (`🚢 #46 · CI ⏳`), and a notification says when it's ready to merge. It
  never merges unless you turn that on.
- Every other PR the session links (one Claude opens, a link you paste, the branch's PR, or `/prs add`) gets a
  glyph in the status row for whose move it is (`#51 ❌ · #53 ✅`), and a line above the prompt when one needs
  you. `/prs` lists them all with CI, reviews and open threads.

[Everything Ship It does →](plugins/ship-it)

## 🪞 Reflect

**One press has Claude look back over the session and write down what's worth keeping, so the next one starts smarter.**

- Click `🪞 reflect` in the status row, or run `/reflect`, and Claude goes back over the conversation for your
  corrections, its own mistakes, things it had to dig for and approaches that worked.
- It puts each finding in the one place it belongs: its memory, the project's `CLAUDE.md`, the docs, or a skill.
  It skips what the repo already records, and keeps instruction files short.
- It never edits your user-level `CLAUDE.md` or settings without asking first. It ends with a list of what it
  changed and where.

[Everything Reflect does →](plugins/reflect)

---

## How they work together

Your Serve, What's Next, Ship It and Reflect each add an item to the status row under the prompt, always in that order.
Show & Tell has no status-row item: run `/gallery`, or click `Gallery` in its band, to open its pane; Esc closes
it. What's Next's review pane and Ship It's pane open the same way and close with Esc too.

If What's Next starts a fresh session while Ship It is watching a PR, the briefing names the PR and what's open on
it, and Ship It carries on watching in the new session. The same goes for the other PRs it tracks.

```
? for shortcuts   🎾 your serve   ⏭️ whats next   🚢 #46 · CI ⏳   #51 ❌ · #53 ✅   🪞 reflect
```

When a neighbour has something to tell you, it gets a line in the band above the prompt. Long lines wrap instead
of getting cut off. Show & Tell's band buttons don't have digits, so either click them or open the gallery and use
its letter keys. The band clears when you send your next prompt.

## Settings

You can change these in `/config`, or with `/plugin configure <plugin>@claude-desk-neighbours`.

| Plugin | Setting | Default |
|---|---|---|
| `show-and-tell` | Keep new thumbnails above the prompt for (seconds) | 20 |
| `whats-next` | Offer a fresh start when the context is this full (%, 0 turns it off) | 70 |
| `ship-it` | Confirm before pushing and replying | on |
| `ship-it` | Check the PR every (seconds) | 60 |
| `ship-it` | Automatic rounds per PR | 5 |
| `ship-it` | Merge when ready | off |

## What runs in the background

Here's what goes on behind the scenes, so you know before you install:

- **Model calls.** Your Serve's press starts a normal turn on your session's model. What's Next writes its
  briefing with one call on your session's model, over the same conversation, so most of it comes from the prompt
  cache. Each Ship It round starts a normal turn on your session's model. Reflect's press starts a normal turn too, and
  Claude then edits your memory, project `CLAUDE.md`, docs and skills with its usual file tools. Show & Tell makes no
  model calls.
- **Files on disk.** Show & Tell keeps copies of pasted and tool images in `~/.claude/show-and-tell/`, and uses
  `cp`, `sips` or `magick` to copy and convert them. It deletes files older than seven days when a session starts
  (macOS and Linux).
- **GitHub, through `gh`.** While Ship It watches a PR it polls it with `gh` (every minute, less often when
  nothing changes), and Claude's replies are posted with your `gh` login. Other PRs linked to the session are
  polled together in one `gh api graphql` call on the same schedule. It keeps them in its plugin store so
  `/resume` picks them back up.
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
