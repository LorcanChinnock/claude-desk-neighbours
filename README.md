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

## Adding a plugin

1. Create `plugins/<name>/.claude-plugin/plugin.json` (`name` is the only required field).
2. Add `{ "name": "<name>", "source": "<name>", "description": "…" }` to `.claude-plugin/marketplace.json` —
   `metadata.pluginRoot` resolves bare sources under `./plugins`.
3. `claude plugin validate . --strict`

Local testing: `claude plugin marketplace add ./` loads plugins in place; `/reload-plugins` picks up edits.

Bundled scripts must live inside the plugin directory and be referenced via `${CLAUDE_PLUGIN_ROOT}`;
persistent state goes in `${CLAUDE_PLUGIN_DATA}`.
