# 🧾 Receipts

Catches "fixed" when nothing has run since the last edit, along with any debug lines left behind.

![Claude adds a console.log and says it didn't run anything; Receipts flags the crumb, and 7 fills in a prompt to sweep it](../../docs/screenshots/receipts.gif)

```
/plugin install receipts@claude-desk-neighbours
```

## How it works

Receipts keeps an eye on every file edit and shell command. It picks up each repo's check command (tests,
typecheck, lint or build) from the last one that passed, and remembers it between sessions. It only keeps the
check itself, the way you'd run it again, so `git stash && pnpm test 2>&1 | tail -25` gets saved as `pnpm test`.
A command that just mentions a check, like writing a test file with a heredoc, doesn't count.

If a turn edits files and then claims it worked ("fixed", "tests pass", "done") without running a check after
the last edit, you get a line under the answer:

```
🧾 No receipt: nothing ran since edit to src/auth.ts
```

It also flags crumbs left in lines Claude added this turn: `console.log`, `debugger`, `print(` outside tests,
`.only(`, `fit(`, `fdescribe(`, `binding.pry`, `dbg!`, and new `TODO`/`FIXME`s.

```
🧾 No receipt: nothing ran since edit to src/auth.ts · 2 crumbs (console.log api.ts:41, .only auth.test.ts:12)
```

In the demo at the top, Claude was told not to run anything and said so, which is why there's no "No receipt",
just the crumb.

The band suggests what to do next. Each button fills in your prompt, and nothing goes anywhere until you send it.
Type the digit into an empty prompt or click the button:

| Key | Button | Fills |
|---|---|---|
| `6` | Run them | Run `` `pnpm test` `` and show me the result. |
| `7` | Sweep | Remove these leftovers: console.log in src/api.ts:41, … |
| `8` | Make it a rule | From now on, always run `` `pnpm test` `` before saying something is done. |

"Make it a rule" only shows up after the second missing receipt in a session. If you have Grudge installed, it'll
offer to hold the rule.

If a turn checked its work and didn't leave any crumbs, you won't see anything.

## The pane

Click the `🧾` item in the status row (`watching`, `2 unchecked`, `✓ checked`), or run `/receipts`. It shows the
check command, which files haven't been checked, the last turn's crumbs, and any missed receipts this session.

![The Receipts pane after a passing test run: checks with pnpm test, nothing unchecked, no crumbs](../../docs/screenshots/receipts-pane.png)

## In the background

Receipts only asks Haiku whether an answer really claims to be done when the turn edited files, used words like
"done" or "fixed", and didn't run a check after its last edit. That call has a 2.5 second limit. Each repo's
check command is kept in the plugin's store.
