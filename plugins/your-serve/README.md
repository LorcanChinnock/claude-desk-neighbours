# 🎾 Your Serve

Lets you know when Claude is waiting on you, so you don't miss the question at the bottom of a long answer.

![Claude ends a long answer with a question; Your Serve puts it above the prompt with its answers, and 1 fills in the reply](../../docs/screenshots/your-serve.gif)

```
/plugin install your-serve@claude-desk-neighbours
```

## How it works

When a turn ends with a question, a choice between options, or a "should I also…", it shows up on the top line
of the band:

```
🎾 Your serve: Keep the old cache or drop it?          1: Keep  2: Drop  3: Something else
```

Press an answer and a natural-sounding reply ("Drop the old cache.") lands in your prompt, ready to send. You
can type its digit into an empty prompt or click it. If there aren't any clear options, you just get the
question. Either way it stays put until you send a prompt. Answers that don't ask anything produce nothing, and
subagent turns are ignored.

If Claude asks several things at once, you get them one at a time, however many there are:

```
🎾 Your serve (2/3): What should the new timeout be?          1: 30s  2: 60s  other  skip
```

Each answer takes you to the next question. After the last one, they all go into your prompt as a single reply:

```
1. Keep the old cache or drop it? Drop the old cache.
2. What should the new timeout be? Make it 30 seconds.
3. Add a retry? Yes, add a retry.
```

If none of the answers fit, click `other` and type your own. Enter answers the question with what you typed and
moves on, the same as pressing an answer. If you skip a question, or press Enter on an empty `other`, it's left
unanswered so you can type your answer after it in the prompt before sending. You have to click `other` and
`skip` (or reach them with Tab) because the digits after 3 belong to the other Desk Neighbours. The mobile app
can't show a text field, so there you only get `skip`.

Nothing gets cut off. If the question and its answers don't fit on one line, the answers wrap onto the next one.
Only three answers get buttons. For anything else, use `other`, or with a single question just type it in the
prompt.

Your Serve reads the text of Claude's answer, so it won't show questions Claude asks through its own question
picker. You've already got the picker in front of you anyway.

If the turn took longer than a minute, you'll also get a `🎾 Claude needs a decision` toast in case you'd
wandered off.

## The pane

Click `🎾 ready` in the status row, or run `/your-serve`, to see the question waiting on you with its answers,
plus the questions Claude asked earlier in the session.

![The Your Serve pane: "Should I run pnpm add debug and make the swap?" waiting, with an earlier question listed below](../../docs/screenshots/your-serve-pane.png)

## Settings

| Setting | Default |
|---|---|
| Toast when a turn that needs you took longer than (seconds) | 60 |
| Also say it out loud (macOS) | off |

## In the background

Haiku only sees answers that end with a question mark, a list of options or something phrased as a question. It
picks out every question and up to three answers for each one.
