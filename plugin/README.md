# Claude (ACP)

Run agents on Claude Code, signed in with your own Claude account, through the Agent
Client Protocol. Pick **Claude (ACP)** as an agent's Harness and mention it in a
conversation.

## Before you start, on each computer

Buzz installs this plugin, not the adapter it runs. In Terminal, run once:

```sh
curl -fsSL https://raw.githubusercontent.com/pyus13/buzz-claude-acp/main/scripts/install-adapter.sh | sh
```

It needs Node.js 20 or later. Then sign in to Claude once with `claude auth login`
(from [Claude Code](https://claude.com/claude-code)), and press **Check again** in
Settings → Agent setup.

## Settings

- **Model** and **Thinking**: Claude's models and effort levels for your account.
  Blank follows the default in Settings → Agent setup.
- **Instructions**: what the agent does.
- **Workspace**: the folder Claude works in.
- **Sessions**: one Claude session per thread, or per channel.
- **Permissions**: Claude Code's permission mode. *Bypass permissions* runs every
  tool without asking.

Activity and usage come from Buzz's own Claude plugin, which must be turned on.
