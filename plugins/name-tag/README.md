# 🏷️ Name Tag

Names your session for you.

```
/plugin install name-tag@claude-desk-neighbours
```

## How it works

Once you've sent 3 prompts, Name Tag asks Haiku for a title of 3 to 6 words, based on your first few messages. It
sets that as the session's title on your next prompt, because a hook can only set a title in a prompt's result.

It names a session once. If you've already named it yourself with `/rename`, it does nothing, and it ignores turns
that subagents run.

## The status item

A small item joins the status row under the prompt while it works: `🏷️ 1/3` counts your prompts, `🏷️ naming…`
shows while the title is being written, and `🏷️ named` shows for one prompt after the title is set, then goes. It's
plain text with nothing to click, and it never shows in a session you've already named.

Change the number of prompts in `/config`, or with `/plugin configure name-tag@claude-desk-neighbours`.

The one model call sends your first three prompts, cut to 300 characters each, to Haiku on your account.
