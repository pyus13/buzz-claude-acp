# Claude (ACP) for Buzz

A [Buzz](https://github.com/block/buzz-app) plugin that adds **Claude (ACP)** to the
Harness picker: agents that run on **Claude Code with your own Claude account**, no API
key, through the [Agent Client Protocol](https://agentclientprotocol.com) adapter
[`@agentclientprotocol/claude-agent-acp`](https://www.npmjs.com/package/@agentclientprotocol/claude-agent-acp).

It works like Buzz's own Claude: mentions, Attention wakes, watches and timers, every
Buzz tool, Model and Thinking pickers, steering a running turn, Stop, Start a new
session, Compact, sessions that resume across restarts, Activity and usage.

> Running Claude with your personal login inside a third-party app may not be allowed
> on every Claude plan. Check Anthropic's current terms for yours.

## Install

Each computer needs **three things**. Buzz installs only the plugin, never the
adapter it runs, so do step 1 on every computer you use it on.

You need Buzz desktop (macOS or Linux, November 2026 or later), Node.js 20+
([nodejs.org](https://nodejs.org)), and [Claude Code](https://claude.com/claude-code)
signed in once with `claude auth login`.

**1. Install the adapter.** In Terminal:

```sh
curl -fsSL https://raw.githubusercontent.com/pyus13/buzz-claude-acp/main/scripts/install-adapter.sh | sh
```

It installs a pinned adapter under `~/.local/share/buzz-claude-acp`, writes
`~/.local/bin/buzz-claude-acp`, and checks that it answers. Run it again to repair or
update. From a clone, `sh scripts/install-adapter.sh` does the same, and `--check` only
checks.

**2. Add the plugin to Buzz:** Settings → Plugins → Manage plugins → **Add**, then one of:

| Option | What to enter |
|---|---|
| **Git or GitHub repository** | `pyus13/buzz-claude-acp`. Branch or tag: a release tag like `v1.0.0`, or blank for the latest. Folder: `plugin`. |
| **From URL** | The release's `claude-acp-<version>.plugin.json` link and its SHA-256 from `SHA256SUMS`. |
| **From folder** | **Browse** to this repository's `plugin` folder. |

**3. Use it:** New agent → Create a new agent → Harness **Claude (ACP)**, then mention
the agent in a conversation. Settings → Agent setup shows the sign-in and a default
model for this device.

If you skipped step 1, the agent and Settings → Agent setup say "Claude (ACP) needs its
adapter on this computer" with the command above. Run it, then press **Check again**.

**Updating:** open the plugin in Settings → Plugins and choose **Update**. Rerun the
installer when a release changes the adapter version.

## Settings

- **Model, Thinking:** your account's models; *Default* follows Settings → Agent setup.
- **Instructions:** what the agent does. Changing them starts new sessions.
- **Workspace:** the folder Claude works in (default `~/.buzz`).
- **Sessions:** one Claude session per thread, or per channel.
- **Permissions:** Claude Code's mode. *Bypass permissions*, the default, runs every tool
  without asking. *Plan* posts a plan and changes nothing.

Activity and usage come from Buzz's built-in **Claude** plugin, which must be turned on.
It needs no API key.

## Icons

| File | Where Buzz shows it | Source |
|---|---|---|
| `src/assets/harness-mark.svg` | Beside "Claude (ACP)" in the Harness picker, Agent setup and harness changes | `tools/icon/harness-mark.mjs` |
| `plugin/icon.png` | Settings → Plugins tile | `tools/icon/list-glyph.mjs`, `list-tile.mjs` |

`npm run icons` redraws both; `npm run icons -- --check` verifies the committed files.
Buzz versions before installed-plugin icons
([block/buzz-app#2698](https://github.com/block/buzz-app/pull/2698)) show a placeholder
tile in Settings → Plugins; the harness mark shows everywhere.

## Build

```sh
npm install
npm test           # unit, runtime and UI tests (no Claude needed)
npm run build      # bundles src/ into plugin/plugin.js
npm run check      # fails if plugin/plugin.js is out of date
npm run test:e2e   # real adapter and your Claude login; a few turns
npm run release    # dist/: artifact, zip, SHA256SUMS, release notes
```

Buzz loads one self-contained file, so `src/` (ES modules, classic JSX with `h`) is
bundled by esbuild into `plugin/plugin.js`, which is committed so Git installs need no
build. Never edit `plugin/plugin.js` by hand.

| Path | Owns |
|---|---|
| `src/index.js` | What the plugin registers with Buzz. |
| `src/config.js` | Agent settings: reading, syncing, moving between harnesses. |
| `src/acp/` | The adapter process (`connection.js`) and protocol details (`protocol.js`). |
| `src/runtime/` | Agents (`agent.js`), conversations and turns (`conversation.js`), saved sessions (`records.js`), models and sign-in (`catalog.js`), device defaults (`defaults.js`). |
| `src/ui/` | Views that mirror Buzz's own components so its stylesheet styles them. |

## Release

1. Update `version` in `package.json` and add a section to `CHANGELOG.md`.
2. `npm run build && npm test`, commit.
3. `git tag vX.Y.Z && git push origin main vX.Y.Z`. The Release workflow builds
   `dist/` and publishes the GitHub release with its files and install notes.

## Fix things

| Symptom | Fix |
|---|---|
| "Claude (ACP) needs its adapter on this computer", or "Could not start buzz-claude-acp" | Run the installer from step 1 on that computer, then **Check again**. |
| Agent setup says "Sign in to Claude" | Run `claude auth login`, then **Check again**. |
| "Claude (ACP) could not finish: …" | The text after the colon is Claude's or the adapter's error. |
| A conversation seems stuck | Use **Start a new session** on the conversation. |
| Activity asks for Buzz's Claude plugin | Turn on **Claude** in Settings → Plugins. |
| You changed `src/` but Buzz runs old code | `npm run build`, then **Update** the plugin in Buzz. |

To debug a turn, reproduce it with `npm run test:e2e -- turn`, or add a runtime test with
the scripted adapter in `test/fake-claude.js`.

## Limits

- Buzz keeps the Save button's footer docking, "Discard changes?" prompts and
  Activity's live refresh internal to its own harnesses.
- Security-review agents, remote execution and tool hooks are bundled-harness only.
- Windows isn't supported: Buzz plugin processes run on macOS and Linux.

## License

MIT. Claude is a trademark of Anthropic. Not affiliated with or endorsed by Anthropic
or Block.
