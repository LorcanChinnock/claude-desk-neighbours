# 🚢 Ship It

One press raises a PR for the session's work, then stays on it: it watches CI and reviews, works through the
feedback, replies on every thread and tells you when the PR is ready to merge.

```
/plugin install ship-it@claude-desk-neighbours
```

Needs the GitHub CLI, signed in (`gh auth login`).

## How it works

Click `🚢 ship it` in the status row under the prompt, or run `/ship-it`.

1. **Raise.** Claude checks the branch, offers to make one if you're on the default branch, stages only the files
   it changed by explicit path, commits, pushes and opens the PR with `gh pr create`, following the repo's PR
   template. It asks before pushing and before opening the PR.
2. **Watch.** Ship It looks at the PR every minute with `gh`, with no model calls. It waits longer, up to eight
   minutes, while nothing changes. The status row shows where things are: `🚢 #46 · CI ⏳`,
   `🚢 #46 · 2 comments`, `🚢 #46 · ✅ ready`.
3. **Answer.** When a review thread, comment, review, failing check or merge conflict comes in, Ship It hands it
   to Claude in a new turn once the session is free. Claude decides whether each one is right, and pushes back
   with reasons where it isn't. It fixes what's valid, runs the checks for what it changed, commits and pushes,
   then replies on each thread with what changed or why not. It resolves the threads it fixed and leaves the ones
   it disagreed with open for the reviewer. For failing CI it reads the logs, fixes real failures, reruns a flaky
   one once, and reports failures unrelated to the PR without touching them.
4. **Done.** When checks pass, reviews are approved and no threads are open, a line above the prompt and a
   notification say `#46 is ready to merge`. Ship It doesn't merge unless you turn that on.

Each round ends with a line above the prompt, like `🚢 #46 · fixed 2, pushed back on 1 · CI green`, with
`Open PR`, `Details` and `Dismiss`. Press the status-row item, or run `/ship-it` again, to open the pane: every
check and open item, and what Claude did about each. From there you can pause, stop, or give it another round.

Replies are posted with your `gh` login and end with `🤖 via Ship It`, so reviewers can tell.

With [What's Next](../whats-next) installed, a briefing written while Ship It is watching a PR includes the PR and
what's open on it, and Ship It keeps watching after the fresh start. So does a plain `/clear`.

## Guardrails

- While Ship It is watching a PR, it refuses force-pushes, amends, rebases and hard resets, and refuses to
  resolve a review thread it didn't hand to Claude.
- It stops handing feedback to Claude after five rounds per PR and hands the PR back to you. Bots that re-review
  on every push get two rounds; their later comments wait for you.
- One round at a time: new feedback waits until Claude's current round has ended.

## Settings

| Setting | Default |
|---|---|
| Confirm before pushing and replying | on |
| Check the PR every (seconds) | 60 |
| Automatic rounds per PR | 5 |
| Merge when ready | off |

## In the background

- Polls with `gh pr view` and `gh api graphql` while a PR is being watched, and stops when it's merged, closed or
  you press Stop.
- Each round starts a normal turn on your session's model. Ship It makes no model calls of its own.
- Keeps the PR it's watching in the plugin's store, keyed by session, so `/resume` picks it back up. Entries older
  than 14 days are removed when a session starts.
