# 🪞 Reflect

A button that has Claude look back over the session and write down what's worth keeping, so the next session
starts smarter.

```
/plugin install reflect@claude-desk-neighbours
```

## How it works

Click `🪞 reflect` in the status row under the prompt, or run `/reflect`. Claude goes back over the whole
conversation for:

- your corrections, and the preferences or rules they show
- its own mistakes, and the check that would have caught each one early
- things it only found out by digging, such as how a system, repo or tool really behaves
- approaches that worked and that you confirmed
- docs, comments or instructions that were missing, stale or wrong.

It puts each finding in the one place it belongs and updates it there:

| Finding | Where it goes |
|---|---|
| Facts about you, feedback on how to work, project context | Claude's memory (it updates an existing memory instead of adding a duplicate) |
| A rule every session in the project needs | The project's `CLAUDE.md` |
| Knowledge about the code that people need as well as Claude | The project's docs, README or code comments |
| A repeatable workflow that went wrong or was missing | A skill |

It skips anything the repo or an existing instruction already records, and anything that only mattered to this
conversation. It keeps instruction files short: a line goes in only if it applies every time.

Your user-level `CLAUDE.md` and settings are the exception. Claude proposes a change there and why, then waits for
your answer. It finishes with a list of what it changed and where, and anything it left for you to decide. If
nothing is worth keeping, it says so in one line and changes nothing.

Press it at the end of a session, after a correction you don't want to repeat, or when something took several
tries to work out. If Claude is still working, the request waits until the turn is over.

Claude sees the request as a message from Reflect, not as something you typed.

## In the background

Each press starts a normal turn on your session's model. Claude then edits files with its usual tools, under your
usual permission mode, so you still approve edits the way you normally do. Reflect makes no calls of its own and
keeps nothing between sessions.
