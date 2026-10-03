# 😤 Grudge

Remembers your corrections, so you only say "no, use pnpm" once.

```
/plugin install grudge@lorcan-plugins
```

## How it works

- **The offer.** When you send a short prompt that reads like a lasting preference ("no, use pnpm",
  "don't use default exports", "always use the logger, not console"), the band offers, while Claude works:

  ```
  😤 Hold a grudge? "use pnpm, not npm"                      g: Hold  n: Nah
  ```

  Nothing is remembered unless you press Hold. One-off fixes ("that's the wrong file") don't get an offer.
  An ignored offer fades when you send your next prompt.
- **Standing preferences.** Every held rule is given to Claude in every session in that repo. Rules about
  personal style (spelling, tone) are held everywhere.
- **Fixed commands.** Where a rule is an exact command swap, Grudge fixes the command before it runs and notes it
  under the tool call: `😤 grudge #4: npm → pnpm`. Swaps are whole commands only (never `.npmrc`) and only
  where the arguments mean the same thing:

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

## The pane

Click `😤 3 grudges` in the status row, or run `/grudges`:

```
😤 Grudges · payments-service
#4   use pnpm, not npm             held 12 Sep · enforced 31×   [ Forgive ]
#7   no default exports            held 20 Sep · reminded       [ Forgive ]
everywhere
#1   British spelling in comments  held 2 Aug · reminded        [ Forgive ]
```

Forgiving a rule removes it at once.

## In the background

A prompt under 400 characters that contains a correction marker is sent to Haiku to judge whether it's a lasting
preference. Other prompts cost nothing. Rules are kept in the plugin's store.
