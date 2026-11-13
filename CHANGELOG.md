# Changelog

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
