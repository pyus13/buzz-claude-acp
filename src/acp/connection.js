// One Claude ACP adapter process (the manifest's `npx` command) and its
// JSON-RPC connection: newline-delimited messages over stdio, as the Agent
// Client Protocol defines them.
import { ADAPTER_ENV, NODE_REQUIRED, PROCESS, START_TIMEOUT_MS, STDERR_LIMIT, TITLE } from "../constants.js";
import { errorText, lastLines, permissionAnswer } from "./protocol.js";

/* global __VERSION__ */
const CLIENT_INFO = { name: "buzz-claude-acp", version: typeof __VERSION__ === "string" ? __VERSION__ : "dev" };

/** npm could not find the pinned version in its cached package list: the
 * cache predates that release, so ask the registry. */
const STALE_CACHE = /ETARGET|notarget|No matching version/;
/** npm could not reach the registry. */
const OFFLINE = /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENETUNREACH|network/i;

export class AcpConnection {
  /** Starts the adapter in `cwd` and completes the ACP handshake. With an
   * `agent`, the process carries a Buzz credential that acts as that agent,
   * so `buzz` commands Claude runs reach the community as it (newer Buzz).
   *
   * npx runs the pinned adapter from npm's cache, which is quick and works
   * offline. A cache older than that release doesn't list it yet; then the
   * start is tried once more with the registry. */
  static async start(host, options) {
    try {
      return await AcpConnection.open(host, options, { npm_config_prefer_offline: "true" });
    } catch (error) {
      if (!error.staleCache) throw error;
      return AcpConnection.open(host, options, { npm_config_prefer_offline: "false" });
    }
  }

  static async open(host, { cwd, agent, permissionMode }, npm) {
    const connection = new AcpConnection(permissionMode);
    try {
      await connection.spawn(host, cwd, agent, npm);
      if (agent && typeof connection.process.actAs === "function")
        await connection.process.actAs({ pubkey: agent.pubkey, relay: agent.relay }).catch((error) => {
          // Only `buzz` commands inside Claude's tools lose their identity.
          console.warn("claude-acp: could not bind the agent's credential", error);
        });
      connection.info = await connection.request(
        "initialize",
        {
          protocolVersion: 1,
          // Claude Code reads and writes files and runs commands itself.
          clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
          clientInfo: CLIENT_INFO,
        },
        START_TIMEOUT_MS,
      );
      return connection;
    } catch (error) {
      // A process that never finished starting is not left running.
      void connection.stop();
      throw connection.startFailure(error);
    }
  }

  /** Why the adapter didn't start, in words a person can act on. */
  startFailure(error) {
    const said = this.stderr;
    if (!/npm (error|ERR)/.test(said)) return error;
    if (STALE_CACHE.test(said)) return Object.assign(new Error(errorText(error)), { staleCache: true });
    if (OFFLINE.test(said))
      return new Error(
        `${TITLE} couldn't download Claude's ACP adapter: this computer can't reach the npm registry. Connect once; after that it starts offline.`,
      );
    return new Error(`${TITLE} couldn't install Claude's ACP adapter with npm:\n${lastLines(said, 4)}`);
  }

  /** `permissionMode(sessionId)`: the mode a session runs in, which decides
   * how its permission prompts are answered. */
  constructor(permissionMode = () => undefined) {
    this.permissionMode = permissionMode;
    this.process = undefined;
    this.info = undefined;
    /** The latest `auth/status_update` the adapter sent, if any. */
    this.auth = undefined;
    /** Why the connection ended; undefined while it is open. */
    this.closed = undefined;
    /** Set when this side ended it, so its end is not reported as a failure. */
    this.stopped = false;
    this.stderr = "";
    this.nextId = 0;
    this.pending = new Map();
    this.sessionListeners = new Map();
    this.closeListeners = new Set();
  }

  async spawn(host, cwd, agent, npm = {}) {
    let buffer = "";
    try {
      this.process = await host.spawn(PROCESS, {
        cwd,
        env: { ...ADAPTER_ENV, ...npm },
        ...(agent ? { agentCredential: true } : {}),
        onStdout: (data) => {
          buffer += data;
          for (let end = buffer.indexOf("\n"); end >= 0; end = buffer.indexOf("\n")) {
            const line = buffer.slice(0, end).trim();
            buffer = buffer.slice(end + 1);
            if (line) this.receive(line);
          }
        },
        onStderr: (data) => {
          this.stderr = (this.stderr + data).slice(-STDERR_LIMIT);
        },
      });
    } catch (error) {
      const reason = errorText(error);
      // No npx: Node.js isn't installed, or not where Buzz looks for programs.
      throw new Error(
        /no such file|not found|os error 2|enoent/i.test(reason)
          ? `${TITLE} needs ${NODE_REQUIRED} on this computer. Install it from https://nodejs.org, then press Check again in Settings → Agent setup.`
          : `Could not start Claude's ACP adapter (${reason}).`,
      );
    }
    void this.process.exited.then(
      (code) => {
        const status = code === null || code === undefined ? "" : ` with exit code ${code}`;
        const said = this.stderr.trim() ? `:\n${lastLines(this.stderr)}` : "";
        this.close(`${TITLE} stopped${status}${said}`);
      },
      (error) => this.close(`${TITLE} stopped: ${errorText(error)}`),
    );
  }

  get capabilities() {
    return this.info?.agentCapabilities ?? {};
  }

  get sessionCapabilities() {
    return this.capabilities.sessionCapabilities ?? {};
  }

  /** Whether the adapter can join a message into a running turn. */
  get canSteer() {
    return this.info?._meta?.steering?.supported === true;
  }

  /** Calls `listener` with each `session/update` for `sessionId`. */
  onSession(sessionId, listener) {
    this.sessionListeners.set(sessionId, listener);
    return () => {
      if (this.sessionListeners.get(sessionId) === listener) this.sessionListeners.delete(sessionId);
    };
  }

  /** Calls `listener` once with the reason when the connection ends. */
  onClose(listener) {
    if (this.closed) {
      listener(this.closed, this.stopped);
      return () => {};
    }
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  request(method, params, timeoutMs) {
    if (this.closed) return Promise.reject(new Error(this.closed));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer =
        timeoutMs &&
        setTimeout(() => {
          this.pending.delete(id);
          reject(new Error(`${TITLE} did not answer ${method} in time`));
        }, timeoutMs);
      const settle = (done) => (value) => {
        clearTimeout(timer);
        done(value);
      };
      this.pending.set(id, { resolve: settle(resolve), reject: settle(reject) });
      this.write({ jsonrpc: "2.0", id, method, params });
    });
  }

  notify(method, params) {
    if (!this.closed) this.write({ jsonrpc: "2.0", method, params });
  }

  write(message) {
    this.process.write(`${JSON.stringify(message)}\n`).catch((error) => {
      this.close(`Could not write to ${TITLE}: ${errorText(error)}`);
    });
  }

  receive(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return; // Not a protocol message, such as a stray log line.
    }
    if (typeof message?.method === "string") {
      const params = message.params ?? {};
      if (message.method === "auth/status_update" && typeof params.state === "string") this.auth = params;
      if (message.method === "session/update" && params.update)
        this.sessionListeners.get(params.sessionId)?.(params.update);
      if (message.id !== undefined && message.id !== null)
        this.write({ jsonrpc: "2.0", id: message.id, ...this.answer(message.method, params) });
      return;
    }
    const waiter = this.pending.get(message?.id);
    if (!waiter) return;
    this.pending.delete(message.id);
    if (message.error) {
      const error = new Error(errorText(message.error));
      error.code = message.error.code;
      waiter.reject(error);
    } else waiter.resolve(message.result);
  }

  /** Answers a request the adapter makes of Buzz. */
  answer(method, params) {
    if (method === "session/request_permission")
      return { result: permissionAnswer(params, this.permissionMode(params.sessionId)) };
    // Status reports and extensions need no answer beyond receipt.
    if (method.startsWith("_") || method.startsWith("auth/")) return { result: {} };
    return { error: { code: -32601, message: `Buzz does not offer ${method}` } };
  }

  close(reason) {
    if (this.closed) return;
    this.closed = reason;
    for (const waiter of this.pending.values()) waiter.reject(new Error(reason));
    this.pending.clear();
    this.sessionListeners.clear();
    for (const listener of this.closeListeners) listener(reason, this.stopped);
    this.closeListeners.clear();
  }

  /** Ends the connection and stops the process and its children. */
  stop() {
    this.stopped = true;
    this.close(`${TITLE} was stopped`);
    return this.process?.kill().catch(() => {}) ?? Promise.resolve();
  }
}
