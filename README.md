<p align="center">
  <img src="plugin/icon.png" width="96" alt="">
</p>

<h1 align="center">Claude (ACP) for Buzz</h1>

<p align="center">
  Run your <a href="https://github.com/block/buzz-app">Buzz</a> agents on Claude Code with your own Claude account. No API key.
</p>

---

## Quick start

1. **On your computer:** install [Node.js 22+](https://nodejs.org) and [Claude Code](https://claude.com/claude-code), then sign in once:

   ```sh
   claude auth login
   ```

2. **In Buzz:** Settings → Plugins → Manage plugins → **Add** → *Git or GitHub repository*

   | Field | Value |
   |---|---|
   | Repository | `pyus13/buzz-claude-acp` |
   | Folder | `plugin` |

3. **Create an agent** with Harness **Claude (ACP)** and mention it.

The plugin downloads its adapter by itself the first time it runs.

## What you get

- Mentions, wakes, watches and timers, with every Buzz tool
- Model and thinking pickers, steering, Stop, new session and compact
- Sessions that resume after a restart
- Activity and usage, through Buzz's built-in Claude plugin

## Settings

| Setting | What it does |
|---|---|
| **Model**, **Thinking** | Your account's models. *Default* follows Settings → Agent setup. |
| **Instructions** | What the agent does. |
| **Workspace** | The folder Claude works in. Default `~/.buzz`. |
| **Sessions** | One Claude session per thread, or per channel. |
| **Permissions** | *Bypass* runs every tool without asking (default). *Plan* only posts a plan. |

## Troubleshooting

| You see | Do this |
|---|---|
| *needs Node.js 22 or later* | Install [Node.js](https://nodejs.org), then **Check again** in Settings → Agent setup. |
| *Sign in to Claude* | Run `claude auth login`, then **Check again**. |
| *can't reach the npm registry* | Connect to the internet once. After that it starts offline. |
| *could not finish: …* | The text after the colon is Claude's own error. |
| Activity asks for Buzz's Claude plugin | Turn on **Claude** in Settings → Plugins. It needs no API key. |

<details>
<summary><b>Other ways to install</b></summary>

- **From a release:** *Add from URL* with the release's `claude-acp-<version>.plugin.json` and its SHA-256 from `SHA256SUMS`.
- **From a folder:** clone this repository, then *Browse* to its `plugin` folder.
- **A fixed version:** put a release tag, like `v1.1.0`, in *Branch or tag*.

To update, open the plugin in Settings → Plugins and choose **Update**.

</details>

<details>
<summary><b>Develop</b></summary>

```sh
npm install
npm test           # unit, runtime and UI tests
npm run build      # src/ → plugin/plugin.js
npm run test:e2e   # real Claude, a few turns
npm run icons      # redraw the icons
npm run release    # dist/ for a GitHub release
```

`src/` is bundled into the one file Buzz loads, `plugin/plugin.js`, which is committed so
GitHub installs need no build. Edit `src/`, never the bundle.

| Path | Owns |
|---|---|
| `src/index.js` | What the plugin registers with Buzz |
| `src/config.js` | Agent settings, sync and harness changes |
| `src/acp/` | The adapter process and protocol |
| `src/runtime/` | Agents, conversations, sessions, models, defaults |
| `src/ui/` | Views built from Buzz's own components |
| `tools/icon/` | Icon sources |

**Releasing:** bump `version` in `package.json`, add a `CHANGELOG.md` entry, then push a
`vX.Y.Z` tag. The Release workflow publishes it.

</details>

## Notes

- Using your Claude login in a third-party app may not be allowed on every plan. Check Anthropic's terms.
- macOS and Linux only. Save-footer docking and Activity's live refresh stay internal to Buzz's own harnesses.

<sub>MIT License. Claude is a trademark of Anthropic. Not affiliated with Anthropic or Block.</sub>
