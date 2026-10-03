# Changelog

## [0.7.0](https://github.com/LorcanChinnock/claude-desk-neighbours/compare/v0.6.0...v0.7.0) (2026-10-03)


### Features

* **closing-time:** watch a PR until CI and agent reviews are green ([#17](https://github.com/LorcanChinnock/claude-desk-neighbours/issues/17)) ([b217dc7](https://github.com/LorcanChinnock/claude-desk-neighbours/commit/b217dc7efc15332349b9e33e3fbaee53659d067b))

## [0.6.0](https://github.com/LorcanChinnock/claude-desk-neighbours/compare/v0.5.0...v0.6.0) (2026-10-03)


### ⚠ BREAKING CHANGES

* rename the repo and marketplace to claude-desk-neighbours ([#15](https://github.com/LorcanChinnock/claude-desk-neighbours/issues/15))

### Miscellaneous Chores

* rename the repo and marketplace to claude-desk-neighbours ([#15](https://github.com/LorcanChinnock/claude-desk-neighbours/issues/15)) ([c45e422](https://github.com/LorcanChinnock/claude-desk-neighbours/commit/c45e422a994f6dcc05fbf79f4e3b596205b368bc))

## [0.5.0](https://github.com/LorcanChinnock/claude-plugins/compare/v0.4.0...v0.5.0) (2026-10-03)


### Features

* **show-and-tell:** thumbnails on paste and a session gallery ([#12](https://github.com/LorcanChinnock/claude-plugins/issues/12)) ([f8307a0](https://github.com/LorcanChinnock/claude-plugins/commit/f8307a0b169e3c60190bac5fb69c8986d3ff0cfc))

## [0.4.0](https://github.com/LorcanChinnock/claude-plugins/compare/v0.3.0...v0.4.0) (2026-10-03)


### Features

* **your-serve:** ask any number of questions ([675e4b8](https://github.com/LorcanChinnock/claude-plugins/commit/675e4b8135563266037fda58e195b71544b6977c))

## 0.3.0

Desk Neighbours:

- Your Serve asks several questions one at a time. When Claude ends a turn asking more than one thing, the band
  shows each in turn (`🎾 Your serve (2/3): …`), up to four, and the last answer puts them all in the prompt as one
  numbered reply. `skip` leaves a question blank there to type. It used to pick one question, and a numbered list
  of questions read as the options of a single one.

Releases are now cut by release-please from conventional PR titles, so later entries are generated.

## 0.2.1

Desk Neighbours:

- After `/resume`, the mods load their saved data again, as 0.2.0 made them do after `/clear`. Resuming another
  conversation also starts a session with empty state and runs no `session.start`.
- Receipts only counts and learns a real check step. It used to match a check word anywhere in a command and keep
  the whole command, cut at 200 characters, so writing a test file with a heredoc was learned as the repo's check
  and "Run them" offered to run it again. Now `git rm x && pnpm test 2>&1 | tail -25` is learned as `pnpm test`, a
  heredoc's body never counts, and a check too long to keep whole is skipped rather than cut.

## 0.2.0

Desk Neighbours:

- Band buttons use digits, so they press from an empty prompt without `ctrl+x tab` first: Your Serve `1`–`3`,
  Grudge `4`–`5`, Receipts `6`–`8`, Shrink Ray `9`, Previously On `0`. Your Serve's pane uses the same digits.
- Each plugin's README has screenshots from a real session, and a GIF of it in use.
- The repo README is rewritten around the five neighbours: a logo, and for each one its GIF and the details
  that make it interesting.
- Nothing in the band or a pane is cut off any more: lines wrap, and buttons move to the next line when they
  don't fit. Band lines also stay clear of the band's `[-]` mark, which used to cover the last button.
- Your Serve no longer clips answers to 14 characters or the question to 80, and asks Haiku to name each
  choice ("Cap at 30s") rather than number it ("Option 1").
- Previously On cuts a long session topic at a word break, not mid-word.
- After `/clear`, the mods load their saved data again. `/clear` starts a session with empty state and runs no
  `session.start`, so Grudge showed "no grudges", Shrink Ray "0 all time", Receipts forgot the check command and
  Previously On's pane showed an empty day log until Claude Code restarted.

## 0.1.1

Desk Neighbours (`grudge`, `your-serve`, `receipts`, `shrink-ray`, `previously-on`):

- Shrink Ray removes originals older than seven days when a session starts (macOS and Linux).
- A README for each plugin and a fuller marketplace README: what each one shows, its settings, and what it runs
  in the background.
- CI runs every mod's tests as well as strict validation.

## 0.1.0

- First release of Desk Neighbours: five mods that share the band above the prompt and a clickable status row
  under it, each with its own pane and command.
