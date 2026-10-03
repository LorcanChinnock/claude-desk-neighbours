# Changelog

## Unreleased

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
