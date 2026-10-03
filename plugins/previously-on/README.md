# 📺 Previously On

Catches you up when you come back.

```
/plugin install previously-on@lorcan-plugins
```

## How it works

- **Return recap.** Your first keystroke after 20 idle minutes, in a session with finished turns, brings up:

  ```
  📺 Previously on payments-service…
     Waiting on you: keep or drop the old cache?
     Done: retry logic for webhook sends, tests green
     Pending: idempotency key on refunds
  ```

  It's made once per return and reused if nothing has changed. It clears when you send a prompt, or press
  Dismiss: `0` in an empty prompt, or a click. Typing one key after 20 minutes away:

  ![A return recap: done and pending lines, with 0: Dismiss](../../docs/screenshots/previously-return.png)

  The same recap on demand (**Recap now** in the pane), here while a Your Serve question was waiting:

  ![A recap under a Your Serve question: waiting on you, keep formatMinor in money.js or move it; done; pending](../../docs/screenshots/previously-recap.png)
- **Morning digest.** The first session of your day shows the last day's sessions, once:

  ```
  📺 Yesterday: payments-service (webhook retries) · web-app (login copy fixes)
  ```

- **`/standup`** prints the last day's and today's sessions, ready to paste into a standup channel.

  ![/standup output: yesterday, nothing logged; today, payments-service and its topic](../../docs/screenshots/previously-standup.png)

## The pane

Click `📺 on air` in the status row, or run `/previously-on`: today's and the last day's sessions, **Recap now**
(`r`) and **Copy standup** (`c`).

![The Previously On pane: today's session, with Recap now and Copy standup buttons](../../docs/screenshots/previously-pane.png)

## Settings

| Setting | Default |
|---|---|
| Recap after this many idle minutes | 20 |

## In the background

The recap re-reads the session transcript with one model call, mostly served from the prompt cache. After the
first turn and every fifth, Haiku names the session's topic from your prompts for the day log. The log is one
line per session, kept for two weeks in the plugin's store.
