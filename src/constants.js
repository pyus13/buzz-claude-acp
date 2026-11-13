// What this harness is called, and the fixed values it runs with.

export const TYPE_ID = "claude-acp";
export const TITLE = "Claude (ACP)";
/** The plugin id, used when the host does not say which plugin owns a call. */
export const PLUGIN_ID = "local.claude-acp";
/** The `host.processes` entry in manifest.json. */
export const PROCESS = "claude";

/** Buzz's own Claude harness. Its Activity tab and usage reader read the same
 * Claude Code session files this harness writes, so they are reused here. */
export const CLAUDE_TYPE = "buzz.claude-code/claude-code";
/** Where Buzz's Claude lists an agent's sessions (`localSessions` in its
 * sessions.ts). This harness keeps that record current for its agents. */
export const CLAUDE_SESSIONS = "buzz.claude-code.sessions.v1";

/** Permission modes Claude Code offers, with how Buzz describes each. */
export const MODES = Object.freeze([
  ["bypassPermissions", "Bypass permissions", "Claude runs every tool without asking."],
  ["auto", "Auto", "Claude decides which actions need care; Buzz allows what it asks."],
  ["acceptEdits", "Accept edits", "Edits files without asking; Buzz allows other tools."],
  ["plan", "Plan", "Claude plans and posts the plan; it changes nothing."],
]);

export const SCOPES = Object.freeze([
  ["thread", "One session per thread"],
  ["channel", "One session per channel"],
]);

/** Removed from the adapter's environment: each would make Claude use
 * something other than the person's own login, or think it runs inside
 * another Claude session. */
export const SCRUBBED_ENV = Object.freeze({
  ANTHROPIC_API_KEY: null,
  ANTHROPIC_AUTH_TOKEN: null,
  CLAUDECODE: null,
  CLAUDE_CODE_ENTRYPOINT: null,
  CLAUDE_CODE_SESSION_ID: null,
  CLAUDE_CODE_CHILD_SESSION: null,
  CLAUDE_CODE_MESSAGING_SOCKET: null,
  CLAUDE_CODE_MESSAGING_TOKEN: null,
  CLAUDE_CODE_SESSION_ATTENDED: null,
  CLAUDE_AGENT_SDK_VERSION: null,
  CLAUDE_PID: null,
});

/** How long the adapter may take to start, open a session or change one. */
export const START_TIMEOUT_MS = 120_000;
/** How long closing a session may take before it is left to the process. */
export const CLOSE_TIMEOUT_MS = 30_000;
/** An idle conversation closes its Claude session and MCP server after this
 * long, as Buzz's own ACP sessions do; its next turn resumes the session. */
export const IDLE_MS = 15 * 60_000;
/** Claude sessions kept open at once across all agents. Each holds one of the
 * 64 loopback MCP servers Buzz allows all plugins together; past this, the
 * least recently used idle one closes first. */
export const MAX_LIVE_SESSIONS = 12;
/** The adapter's last words kept for an error message. */
export const STDERR_LIMIT = 4_000;
/** Conversations whose sessions are remembered per agent, newest first. */
export const SAVED_CONVERSATIONS = 200;
