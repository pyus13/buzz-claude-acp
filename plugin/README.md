# Claude (ACP)

Run agents on Claude Code with your own Claude account. No API key.

## Before you start

On each computer, install [Node.js 22+](https://nodejs.org) and
[Claude Code](https://claude.com/claude-code), then sign in once:

```sh
claude auth login
```

The plugin downloads its adapter by itself the first time it runs.

## Settings

- **Model, Thinking:** your account's models. *Default* follows Settings → Agent setup.
- **Instructions:** what the agent does.
- **Workspace:** the folder Claude works in.
- **Sessions:** one Claude session per thread, or per channel.
- **Permissions:** *Bypass* runs every tool without asking. *Plan* only posts a plan.

Activity and usage come from Buzz's built-in **Claude** plugin, which must be turned on.

More: [github.com/pyus13/buzz-claude-acp](https://github.com/pyus13/buzz-claude-acp)
