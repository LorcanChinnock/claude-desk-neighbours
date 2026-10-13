# 🏷️ Name Tag

Names your session for you.

```
/plugin install name-tag@claude-desk-neighbours
```

## How it works

Once you've sent 3 prompts, Name Tag asks Haiku for a title of 3 to 6 words, based on your first few messages. It
sets that as the session's title on your next prompt, because a hook can only set a title in a prompt's result.

It names a session once. If you've already named it yourself with `/rename`, it does nothing, and it ignores turns
that subagents run. It has no pane and no status item.

Change the number of prompts in `/config`, or with `/plugin configure name-tag@claude-desk-neighbours`.

The one model call sends your first three prompts, cut to 300 characters each, to Haiku on your account.
