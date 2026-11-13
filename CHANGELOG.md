# Changelog

## 1.1.0

- **No install step.** The plugin starts the pinned Claude ACP adapter with `npx`,
  which downloads it on first use and runs it from npm's cache after. A computer
  needs only Node.js 22 or later and a Claude login. `scripts/install-adapter.sh` is
  gone.
- **Starts fast and offline:** the adapter runs from npm's cache. A cache older than the
  pinned release is noticed and refreshed once, automatically.
- **Plain messages** when Node.js is missing or npm can't reach the registry, with what
  to do.
- **A calmer README** with a three-step quick start.
- Updating to this version asks you to review the plugin's access again: it now
  starts `npx` instead of `buzz-claude-acp`.

## 1.0.1

- **One-line adapter install** for each computer, no clone needed:
  `curl -fsSL https://raw.githubusercontent.com/pyus13/buzz-claude-acp/main/scripts/install-adapter.sh | sh`.
  Buzz installs only the plugin, so a computer without the adapter couldn't start it.
- When the adapter is missing, the agent and Settings → Agent setup say so and show
  that command.
- The installer says when Claude Code is missing, and points at Node.js when it is.

## 1.0.0

First release.

- **Claude (ACP) harness:** agents run on Claude Code through the Agent Client
  Protocol adapter, signed in with your own Claude account. No API key.
- **Works like Buzz's Claude:** mentions, Attention wakes, watches and timers,
  every Buzz tool, model and thinking pickers, steering a running turn, Stop,
  Start a new session, Compact, and sessions that resume across restarts.
- **Activity and usage** come from Buzz's own Claude plugin, which reads the same
  Claude Code sessions.
- **Settings sync** like Buzz's Claude: model, thinking, sessions and permissions.
  Instructions and workspace move with an agent that changes harness.
- **Settings → Agent setup:** sign-in status, and this device's default model and
  thinking.
- **Stays within Buzz's limits:** idle sessions close after 15 minutes and resume
  when needed, with at most 12 open at once, and no process outlives its agent.
- **Plan mode** posts the plan and changes nothing. Permissions are granted once,
  never written into your own Claude settings.
