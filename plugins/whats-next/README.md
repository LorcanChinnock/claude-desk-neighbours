# ⏭️ What's Next

When a session gets long, What's Next writes a briefing for the next task, lets you check it, and starts it in a
fresh context. It's like handing your desk to a colleague with a proper note, instead of letting `/compact`
summarise everything.

```
/plugin install whats-next@claude-desk-neighbours
```

## How it works

Click `⏭️ whats next` in the status row under the prompt, or run `/whats-next`. Claude looks back over the
conversation and writes a self-contained prompt for the next task: the goal, what's done, the branch and working
directory, the files that matter, the decisions you agreed on, what was tried and didn't work, how to check it, and
the tasks after it. It writes paths instead of "as above" or `[Image #1]`, because the new session won't see any of
this one. To pick the task yourself, add a focus: `/whats-next the auth tests`.

The briefing opens in a pane:

- `Start` (`s`) clears the conversation and sends the briefing as the first prompt of the fresh one.
- `Edit` (`e`) clears the conversation and puts the briefing in your prompt box, so you can tweak it before sending.
- `Copy` (`c`) copies it and leaves the pane open.
- `Cancel`, or Esc, closes the pane and leaves the session as it was.

After a clear, the first row of the new conversation says which session it continued from, so you can `/resume`
the old one if the briefing missed something.

If nothing is left to do, What's Next says so in one line and doesn't open the pane.

## The nudge

When the context gets to 70% full, the band above the prompt says `Context is 72% full.` with a `⏭️ Start fresh?`
button. It shows once per session. You can change the threshold in `/config`, or set it to 0 to turn the nudge off.

## In the background

Each briefing is one model call on your session's own model. It runs over the same conversation the main thread
last sent, so most of it is served from the prompt cache. It has no tools. After a turn ends, What's Next reads
the context fill the status line already has, which costs nothing. It keeps nothing between sessions.
