# 🎾 Your Serve

A button that has Claude ask you what it needs, one question at a time, so nothing gets lost at the bottom of a
long answer.

```
/plugin install your-serve@claude-desk-neighbours
```

## How it works

Click `🎾 your serve` in the status row under the prompt, or run `/your-serve`. Claude looks back over its last
reply and asks you each open question in its own question picker, one at a time, with the options it would
suggest. If nothing is waiting on you, it says so in one line.

Press it whenever you like: after a long answer, when you've lost track of what Claude asked, or when you'd rather
pick from options than type. If Claude is still working, the request waits until the turn is over.

Claude sees the request as a message from Your Serve, not as something you typed.

## In the background

Each press starts a normal turn on your session's model. Your Serve makes no calls of its own and keeps nothing
between sessions.
