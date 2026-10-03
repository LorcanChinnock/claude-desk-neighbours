# lorcan-plugins

Claude Code plugin marketplace: skills, hooks and mods.

## Install

```
/plugin marketplace add LorcanChinnock/claude-plugins
/plugin install <plugin>@lorcan-plugins
```

Updates are manual for third-party marketplaces unless you enable auto-update in `/plugin` → Marketplaces:

```
claude plugin marketplace update lorcan-plugins
```

## Plugins

| Plugin | What it does |
| ------ | ------------ |
| `grudge` | 😤 Remembers your corrections: offers to hold a lasting preference, reminds Claude of it every session, fixes commands it can swap safely. `/grudges` |
| `your-serve` | 🎾 Tells you when Claude needs you: the question it ended on, its answers as buttons. `/your-serve` |
| `receipts` | 🧾 Notes when Claude says done with nothing run since its last edit, and debug crumbs it left. `/receipts` |
| `shrink-ray` | 🔫 Shrinks big pastes and long command output; full originals saved outside the project. `/shrink-ray` |
| `previously-on` | 📺 A recap when you come back, a morning digest of yesterday, and `/standup`. `/previously-on` |

The last five are **Desk Neighbours**: mods (function-hook plugins) that each work alone and share the
band above the prompt and one status row under it when installed together. Click a status item (fullscreen
terminal) or run its command to open its pane. Install any or all:

```
/plugin install grudge@lorcan-plugins
/plugin install your-serve@lorcan-plugins
/plugin install receipts@lorcan-plugins
/plugin install shrink-ray@lorcan-plugins
/plugin install previously-on@lorcan-plugins
```

Test a mod with `claude plugin test plugins/<name>`.

## Adding a plugin

1. Create `plugins/<name>/.claude-plugin/plugin.json` (`name` is the only required field).
2. Add `{ "name": "<name>", "source": "<name>", "description": "…" }` to `.claude-plugin/marketplace.json` —
   `metadata.pluginRoot` resolves bare sources under `./plugins`.
3. `claude plugin validate . --strict`

Local testing: `claude plugin marketplace add ./` loads plugins in place; `/reload-plugins` picks up edits.

Bundled scripts must live inside the plugin directory and be referenced via `${CLAUDE_PLUGIN_ROOT}`;
persistent state goes in `${CLAUDE_PLUGIN_DATA}`.
