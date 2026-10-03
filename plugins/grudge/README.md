# 😤 Grudge

Remembers your corrections, so you only have to say "no, use pnpm" once.

![Saying "no, use pnpm, not npm": Grudge offers to hold it while Claude works, and 4 holds it](../../docs/screenshots/grudge.gif)

```
/plugin install grudge@lorcan-plugins
```

## How it works

When you send a short prompt that sounds like a lasting preference ("no, use pnpm", "don't use default exports",
"always use the logger, not console"), the band offers to remember it while Claude carries on working:

```
😤 Hold a grudge? "use pnpm, not npm"                      4: Hold  5: Nah
```

Nothing gets remembered unless you press Hold, either by typing `4` into an empty prompt or by clicking it.
One-off fixes ("that's the wrong file") don't get an offer at all, and if you ignore an offer it goes away when
you send your next prompt.

Every rule you hold is passed to Claude in every session in that repo. Rules about personal style, like spelling
or tone, apply in every repo.

When a rule is an exact command swap, Grudge fixes the command before it runs and adds a note under the tool
call: `😤 grudge #4: npm → pnpm`. It only swaps whole commands (it never touches `.npmrc`), and only where the
arguments mean the same thing:

| From | To | After |
|---|---|---|
| `npm` | `pnpm` | `install`, `i`, `run`, `test`, `start` |
| `npm` | `yarn` | `run`, `test`, `start` |
| `npm` | `bun` | `install`, `i`, `run` |
| `pnpm` | `npm` | `install`, `i`, `run`, `test`, `start` |
| `yarn` | `npm` | `run`, `test`, `start` |
| `yarn` | `pnpm` | `install`, `run`, `test`, `start` |
| `pip` | `pip3` | anything |
| `python` | `python3` | anything |

Here Claude was asked to run `npm test` anyway, and it ran as `pnpm test`:

![A Bash call with the note "grudge #1: npm → pnpm" under it](../../docs/screenshots/grudge-swap.png)

## The pane

Click `😤 1 grudge` in the status row, or run `/grudges`. Rules for this repo are listed first, then the ones
that apply everywhere:

![The Grudges pane listing "use pnpm, not npm", held 3 Oct, enforced 1×, with a Forgive button](../../docs/screenshots/grudge-pane.png)

Forgive a rule and it's gone straight away.

## In the background

If a prompt is under 400 characters and has something in it that looks like a correction, it goes to Haiku to
decide whether it's a lasting preference. Any other prompt costs nothing. Rules are kept in the plugin's store.
