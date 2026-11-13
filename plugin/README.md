# Claude (ACP)

Run agents on Claude Code, signed in with your own Claude account, through the Agent
Client Protocol. Pick **Claude (ACP)** as an agent's Harness and mention it in a
conversation.

## Before you start

- Install the adapter: `sh scripts/install-adapter.sh` from the plugin's repository.
- Sign in to Claude once: `claude auth login`.

## Settings

- **Model** and **Thinking**: Claude's models and effort levels for your account.
  Blank follows the default in Settings → Agent setup.
- **Instructions**: what the agent does.
- **Workspace**: the folder Claude works in.
- **Sessions**: one Claude session per thread, or per channel.
- **Permissions**: Claude Code's permission mode. *Bypass permissions* runs every
  tool without asking.

Activity and usage come from Buzz's own Claude plugin, which must be turned on.
