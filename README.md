# lorcan-plugins

Claude Code plugins by Lorcan Chinnock: skills, hooks and mods.

```
/plugin marketplace add LorcanChinnock/claude-plugins
```

Then install what you want with `/plugin install <plugin>@lorcan-plugins`.

## Desk Neighbours

Five small colleagues that sit around your terminal. Each has one glyph and one job, works on its own,
and gets along with the others. Most turns they say nothing at all.

| | Plugin | What it does | Pane |
|---|---|---|---|
| 😤 | [`grudge`](plugins/grudge) | Remembers your corrections. Offers to hold a lasting preference ("use pnpm, not npm"), reminds Claude of it every session, and quietly fixes commands it can swap safely. | `/grudges` |
| 🎾 | [`your-serve`](plugins/your-serve) | Tells you when Claude needs you: one line with the question it ended on, and its answers as buttons. | `/your-serve` |
| 🧾 | [`receipts`](plugins/receipts) | Notes when Claude says "done" with nothing run since its last edit, and the `console.log`s and `.only`s it left behind. | `/receipts` |
| 🔫 | [`shrink-ray`](plugins/shrink-ray) | Shrinks big pastes and long command output before Claude reads them. The full originals are kept. | `/shrink-ray` |
| 📺 | [`previously-on`](plugins/previously-on) | Catches you up: a recap when you come back to a session, yesterday's sessions each morning, and `/standup`. | `/previously-on` |

Install any of them, or all five:

```
/plugin install grudge@lorcan-plugins
/plugin install your-serve@lorcan-plugins
/plugin install receipts@lorcan-plugins
/plugin install shrink-ray@lorcan-plugins
/plugin install previously-on@lorcan-plugins
```

### What you'll see

**A status row** under the prompt, one item per installed neighbour, always in the same order:

```
? for shortcuts   😤 3 grudges  🎾 ready  🧾 2 unchecked  🔫 12.4k deflected  📺 on air
```

Click an item (fullscreen terminal) or run its command to open its pane: what it's tracking, and buttons to act
on it. Open several and they become tabs. Esc closes a pane.

**The band** above the prompt, only when a neighbour has something to say. One line each, Your Serve on top:

```
🎾 Your serve: Keep the old cache or drop it?            1: Keep  2: Drop
🧾 No receipt: nothing ran since edit to src/auth.ts      6: Run them
```

All five in a real session, with Your Serve and Previously On both in the band:

![Claude Code with all five neighbours: a Your Serve question and a Previously On recap above the prompt, the status row below](docs/screenshots/previously-recap.png)

Band buttons never send anything. They put text in your prompt for you to read, edit and send yourself.
To press one from the keyboard, type its digit into an empty prompt. With text in the prompt a digit just
types, so focus the band with `ctrl+x tab` first. A click works too. Each neighbour has its own digits, so they
never clash:

| Your Serve | Grudge | Receipts | Shrink Ray | Previously On |
|---|---|---|---|---|
| `1` `2` `3` | `4` `5` | `6` `7` `8` | `9` | `0` |

Lines clear when you send your next prompt.

### Settings

Change these in `/config`, or with `/plugin configure <plugin>@lorcan-plugins`.

| Plugin | Setting | Default |
|---|---|---|
| `your-serve` | Toast when a turn that needs you took longer than (seconds) | 60 |
| `your-serve` | Also say "Claude needs a decision" out loud (macOS) | off |
| `previously-on` | Recap after this many idle minutes | 20 |

### What runs in the background

Worth knowing before you install:

- **Model calls on your account.** Grudge, Your Serve, Receipts and Previously On ask a small model (Haiku) short
  questions: is this a lasting correction, what is Claude asking, does this answer claim it's done, what was this
  session about. Each runs only after a cheap local check passes, so a typical turn makes none. Previously On's recap
  re-reads the session transcript once per return, served mostly from the prompt cache.
- **Files on disk.** Shrink Ray keeps full originals in `~/.claude/shrink-ray/` so Claude can read them if it
  needs to. Files older than seven days are removed at session start (macOS and Linux).
- **Stored data.** Each plugin keeps a small store in your Claude Code config directory: Grudge its rules,
  Receipts each repo's test command, Shrink Ray a lifetime counter, Previously On a one-line-per-session log
  for two weeks. Uninstalling a plugin leaves its store in place.
- Nothing is sent anywhere else.

### Requirements

Desk Neighbours are mods: plugins written against Claude Code's function-hook API, which is in early access.
They are built and tested on Claude Code 2.1.288. The API can change between releases, so a newer Claude Code may
need a newer version of these plugins. If a mod seems to do nothing, `claude --debug` logs why it didn't load;
please [open an issue](https://github.com/LorcanChinnock/claude-plugins/issues) with that line.

## Updating

Third-party marketplaces don't update on their own unless you turn on auto-update in `/plugin` → Marketplaces:

```
claude plugin marketplace update lorcan-plugins
```

## Developing

Each plugin lives in `plugins/<name>/` and is listed in [`.claude-plugin/marketplace.json`](.claude-plugin/marketplace.json),
where `metadata.pluginRoot` resolves bare sources under `./plugins`.

```
claude plugin validate . --strict          # the marketplace and every plugin
claude plugin test plugins/<name>          # a mod's tests
claude --plugin-dir plugins/<name>         # try one in a session, reloading on save
```

CI runs both on every push and pull request. See [CHANGELOG.md](CHANGELOG.md) for what changed.

## License

[MIT](LICENSE)
