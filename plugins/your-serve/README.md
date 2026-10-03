# 🎾 Your Serve

Tells you when Claude needs you, so the question at the end of a long answer doesn't get missed.

![Claude ends a long answer with a question; Your Serve puts it above the prompt with its answers, and 1 fills in the reply](../../docs/screenshots/your-serve.gif)

```
/plugin install your-serve@lorcan-plugins
```

## How it works

When a turn ends with a question, a choice between options, or "should I also…", the band's top line says so:

```
🎾 Your serve: Keep the old cache or drop it?          1: Keep  2: Drop  3: Something else
```

Pressing an answer puts a natural reply in your prompt ("Drop the old cache.") for you to send. Type its
digit into an empty prompt, or click it. With no clear options, the line shows just the question. It stays until
you send a prompt. Answers that are statements produce nothing, and subagents' turns are ignored.

When Claude asks several things at once, the line asks them one at a time, however many there are:

```
🎾 Your serve (2/3): What should the new timeout be?          1: 30s  2: 60s  skip
```

Each answer moves to the next question, and the last one puts them all in your prompt as one reply:

```
1. Keep the old cache or drop it? Drop the old cache.
2. What should the new timeout be? Make it 30 seconds.
3. Add a retry? Yes, add a retry.
```

A question you skip (or one with no clear options) is left without an answer, for you to type after it before
sending. Click `skip`: the digits after 3 belong to the other Desk Neighbours.

The line wraps rather than cutting anything off: when the question and its answers don't fit on one line, the
answers move to the next. At most three answers get buttons; for any other answer, type it.

Your Serve reads the text of Claude's answer, so a question Claude asks with its own question picker doesn't
show here. The picker is already in front of you.

If the turn took longer than a minute, a toast says `🎾 Claude needs a decision` too, in case you'd wandered off.

## The pane

Click `🎾 ready` in the status row, or run `/your-serve`: the question waiting on you with its answers, and the
questions Claude asked earlier this session.

![The Your Serve pane: "Should I run pnpm add debug and make the swap?" waiting, with an earlier question listed below](../../docs/screenshots/your-serve-pane.png)

## Settings

| Setting | Default |
|---|---|
| Toast when a turn that needs you took longer than (seconds) | 60 |
| Also say it out loud (macOS) | off |

## In the background

Only answers whose ending has a question mark, an options list or asking phrasing are sent to Haiku, which picks out
every question and up to three answers for each.
