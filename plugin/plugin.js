// Claude (ACP) for Buzz 1.0.1. Built from src/ by scripts/build.mjs; edit the sources, not this file.

// src/constants.js
var TYPE_ID = "claude-acp";
var TITLE = "Claude (ACP)";
var PLUGIN_ID = "local.claude-acp";
var PROCESS = "claude";
var INSTALL_COMMAND = "curl -fsSL https://raw.githubusercontent.com/pyus13/buzz-claude-acp/main/scripts/install-adapter.sh | sh";
var CLAUDE_TYPE = "buzz.claude-code/claude-code";
var CLAUDE_SESSIONS = "buzz.claude-code.sessions.v1";
var MODES = Object.freeze([
  ["bypassPermissions", "Bypass permissions", "Claude runs every tool without asking."],
  ["auto", "Auto", "Claude decides which actions need care; Buzz allows what it asks."],
  ["acceptEdits", "Accept edits", "Edits files without asking; Buzz allows other tools."],
  ["plan", "Plan", "Claude plans and posts the plan; it changes nothing."]
]);
var SCOPES = Object.freeze([
  ["thread", "One session per thread"],
  ["channel", "One session per channel"]
]);
var SCRUBBED_ENV = Object.freeze({
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
  CLAUDE_PID: null
});
var START_TIMEOUT_MS = 12e4;
var CLOSE_TIMEOUT_MS = 3e4;
var IDLE_MS = 15 * 6e4;
var MAX_LIVE_SESSIONS = 12;
var STDERR_LIMIT = 4e3;
var SAVED_CONVERSATIONS = 200;

// src/config.js
var DEFAULTS = Object.freeze({
  model: "",
  effort: "",
  mode: "bypassPermissions",
  instructions: "",
  workspace: "~/.buzz",
  scope: "thread"
});
var MODE_IDS = MODES.map(([id]) => id);
function readConfig(value) {
  const raw = value && typeof value === "object" ? value : {};
  const text = (key) => typeof raw[key] === "string" ? raw[key] : DEFAULTS[key];
  return {
    model: text("model").trim(),
    effort: text("effort").trim(),
    mode: MODE_IDS.includes(raw.mode) ? raw.mode : DEFAULTS.mode,
    instructions: text("instructions"),
    workspace: text("workspace").trim() || DEFAULTS.workspace,
    scope: raw.scope === "channel" ? "channel" : "thread"
  };
}
var SYNCED_SCHEMA = Object.freeze({
  model: "string",
  effort: "string",
  scope: ["thread", "channel"],
  mode: MODE_IDS
});
function withSyncedSettings(config, settings) {
  const synced = Object.fromEntries(
    Object.keys(SYNCED_SCHEMA).filter((name) => typeof settings?.[name] === "string").map((name) => [name, settings[name]])
  );
  return { ...config, ...synced };
}
var sessionShape = (settings) => JSON.stringify([settings.instructions, settings.workspace, settings.scope]);
function carry(saved) {
  const { instructions, workspace } = readConfig(saved);
  return {
    ...instructions.trim() && { instructions },
    ...workspace !== DEFAULTS.workspace && { workspace }
  };
}
var adopt = (carried, config) => ({
  ...config,
  instructions: carried.instructions ?? config.instructions,
  workspace: carried.workspace ?? config.workspace
});
function describeMigration(saved) {
  const { model, effort, scope, mode } = readConfig(saved);
  return [
    { id: "model", label: "Model", isOverride: Boolean(model) },
    { id: "thinking", label: "Thinking", isOverride: Boolean(effort) },
    { id: "sessions", label: "Sessions", isOverride: scope !== DEFAULTS.scope, unchangedKey: scope },
    { id: "permissions", label: "Permissions", isOverride: mode !== DEFAULTS.mode }
  ];
}

// src/acp/protocol.js
var EVENT = "buzz-event";
var STEER = "new-message-arrived-while-you-were-working";
var STEER_NOTE = "Note: A new message arrived while you were working. Continue your in-progress work and incorporate the new message if it's relevant; if it's unrelated, you may briefly acknowledge it and carry on.";
var STEP_TARGETS = ["description", "path", "file_path", "pattern", "url", "query", "command"];
var TARGET_LIMIT = 80;
function steerPrompt(turn) {
  const open = `
<${EVENT}>
`;
  const close = `
</${EVENT}>`;
  const once = (text) => turn.includes(text) && turn.indexOf(text) === turn.lastIndexOf(text);
  const steered = once(open) && once(close) ? turn.replace(open, `
<${STEER}>
`).replace(close, `
</${STEER}>`) : `<${STEER}>
${turn.trim()}
</${STEER}>`;
  return `${steered}

${STEER_NOTE}`;
}
function stepOf(update) {
  switch (update?.sessionUpdate) {
    case "tool_call": {
      const title = typeof update.title === "string" ? update.title : "";
      const tool = title.split(/__|: /).at(-1)?.split(" ")[0]?.trim() || "Tool";
      const input = update.rawInput && typeof update.rawInput === "object" ? update.rawInput : {};
      const target = STEP_TARGETS.map((key) => input[key]).find(
        (value) => typeof value === "string" && value
      );
      if (!target) return { tool };
      const short = target.startsWith("/") ? target.split("/").at(-1) || target : target;
      return {
        tool,
        target: short.length > TARGET_LIMIT ? `${short.slice(0, TARGET_LIMIT - 1)}\u2026` : short
      };
    }
    case "agent_thought_chunk":
      return { tool: "Thinking" };
    case "agent_message_chunk":
      return { tool: "Writing reply" };
    default:
      return void 0;
  }
}
var EXIT_PLAN = {
  bypassPermissions: "exit-plan-bypass",
  auto: "exit-plan-auto",
  acceptEdits: "exit-plan-accept-edits",
  default: "exit-plan-default"
};
function permissionAnswer(params, mode) {
  const options = (Array.isArray(params?.options) ? params.options : []).filter(
    (option) => typeof option?.optionId === "string"
  );
  const select = (option) => option ? { outcome: { outcome: "selected", optionId: option.optionId } } : { outcome: { outcome: "cancelled" } };
  const byId = (id) => options.find((option) => option.optionId === id);
  if (options.some((option) => option.optionId.startsWith("exit-plan-"))) {
    const reject = options.find((option) => String(option.kind).startsWith("reject"));
    if (mode === "plan" || !mode) return select(reject);
    return select(byId(EXIT_PLAN[mode]) ?? reject);
  }
  return select(options.find((option) => option.kind === "allow_once"));
}
var choicesOf = (options = []) => (Array.isArray(options) ? options : []).flatMap(
  (option) => Array.isArray(option?.options) ? choicesOf(option.options) : typeof option?.value === "string" ? [{ value: option.value, name: option.name || option.value, description: option.description }] : []
);
var optionById = (configOptions, id) => Array.isArray(configOptions) ? configOptions.find((option) => option?.id === id) : void 0;
function errorText(error) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const data = typeof error.data === "string" ? error.data : error.data?.message;
    return data ? `${error.message}: ${data}` : String(error.message);
  }
  return String(error);
}
var lastLines = (text, count = 6) => text.trim().split("\n").slice(-count).join("\n");
var effortLabel = (id) => id === "xhigh" ? "Extra high" : `${id.charAt(0).toUpperCase()}${id.slice(1)}`;

// src/acp/connection.js
var CLIENT_INFO = { name: "buzz-claude-acp", version: true ? "1.0.1" : "dev" };
var AcpConnection = class _AcpConnection {
  /** Starts the adapter in `cwd` and completes the ACP handshake. With an
   * `agent`, the process carries a Buzz credential that acts as that agent,
   * so `buzz` commands Claude runs reach the community as it (newer Buzz). */
  static async start(host, { cwd, agent, permissionMode }) {
    const connection = new _AcpConnection(permissionMode);
    try {
      await connection.spawn(host, cwd, agent);
      if (agent && typeof connection.process.actAs === "function")
        await connection.process.actAs({ pubkey: agent.pubkey, relay: agent.relay }).catch((error) => {
          console.warn("claude-acp: could not bind the agent's credential", error);
        });
      connection.info = await connection.request(
        "initialize",
        {
          protocolVersion: 1,
          // Claude Code reads and writes files and runs commands itself.
          clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
          clientInfo: CLIENT_INFO
        },
        START_TIMEOUT_MS
      );
      return connection;
    } catch (error) {
      void connection.stop();
      throw error;
    }
  }
  /** `permissionMode(sessionId)`: the mode a session runs in, which decides
   * how its permission prompts are answered. */
  constructor(permissionMode = () => void 0) {
    this.permissionMode = permissionMode;
    this.process = void 0;
    this.info = void 0;
    this.auth = void 0;
    this.closed = void 0;
    this.stopped = false;
    this.stderr = "";
    this.nextId = 0;
    this.pending = /* @__PURE__ */ new Map();
    this.sessionListeners = /* @__PURE__ */ new Map();
    this.closeListeners = /* @__PURE__ */ new Set();
  }
  async spawn(host, cwd, agent) {
    let buffer = "";
    try {
      this.process = await host.spawn(PROCESS, {
        cwd,
        env: SCRUBBED_ENV,
        ...agent ? { agentCredential: true } : {},
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
        }
      });
    } catch (error) {
      const reason = errorText(error);
      throw new Error(
        /no such file|not found|os error 2|enoent/i.test(reason) ? `${TITLE} needs its adapter on this computer. In Terminal, run: ${INSTALL_COMMAND}` : `Could not start buzz-claude-acp (${reason}). Reinstall it: ${INSTALL_COMMAND}`
      );
    }
    void this.process.exited.then(
      (code) => {
        const status = code === null || code === void 0 ? "" : ` with exit code ${code}`;
        const said = this.stderr.trim() ? `:
${lastLines(this.stderr)}` : "";
        this.close(`${TITLE} stopped${status}${said}`);
      },
      (error) => this.close(`${TITLE} stopped: ${errorText(error)}`)
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
      return () => {
      };
    }
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }
  request(method, params, timeoutMs) {
    if (this.closed) return Promise.reject(new Error(this.closed));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = timeoutMs && setTimeout(() => {
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
    this.process.write(`${JSON.stringify(message)}
`).catch((error) => {
      this.close(`Could not write to ${TITLE}: ${errorText(error)}`);
    });
  }
  receive(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (typeof message?.method === "string") {
      const params = message.params ?? {};
      if (message.method === "auth/status_update" && typeof params.state === "string") this.auth = params;
      if (message.method === "session/update" && params.update)
        this.sessionListeners.get(params.sessionId)?.(params.update);
      if (message.id !== void 0 && message.id !== null)
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
    return this.process?.kill().catch(() => {
    }) ?? Promise.resolve();
  }
};

// src/runtime/conversation.js
var STOPPED = Object.freeze({ ok: true, stopped: true });
var SETTLE_MS = 5e3;
function sessionParams(cwd, mcp, system) {
  return {
    cwd,
    mcpServers: [{ type: "http", name: "buzz", url: mcp.url, headers: mcp.headers.map((header) => ({ ...header })) }],
    _meta: { claudeCode: { options: { systemPrompt: { type: "preset", preset: "claude_code", append: system } } } }
  };
}
async function applyOptions(connection, sessionId, configOptions, wanted) {
  let options = configOptions;
  for (const [configId, value, synced] of wanted) {
    const option = optionById(options, configId);
    if (!option || !value || option.currentValue === value) continue;
    if (!choicesOf(option.options).some((choice) => choice.value === value)) {
      if (synced)
        throw new Error(
          `This agent's synced ${configId === "effort" ? "thinking" : configId} "${value}" isn't offered by ${TITLE}. Change it in Settings.`
        );
      continue;
    }
    const changed = await connection.request(
      "session/set_config_option",
      { sessionId, configId, value },
      START_TIMEOUT_MS
    );
    options = Array.isArray(changed?.configOptions) ? changed.configOptions : options.map((item) => item.id === configId ? { ...item, currentValue: value } : item);
  }
  return options;
}
function wantedOptions(delivery, settings, defaults) {
  const synced = delivery.synced ?? {};
  const effective = defaults.effective(settings);
  return [
    ["mode", settings.mode, "mode" in synced],
    ["model", delivery.model || effective.model, !delivery.model && Boolean(settings.model) && "model" in synced],
    [
      "effort",
      delivery.effort || (delivery.model ? "default" : effective.effort),
      !delivery.effort && Boolean(settings.effort) && "effort" in synced
    ]
  ];
}
function outcomeOf(stopReason) {
  if (stopReason === "cancelled") return STOPPED;
  if (stopReason === "refusal") return { ok: false, error: "Claude declined to continue this turn." };
  return { ok: true };
}
var sessionLost = (error, connection) => Boolean(connection?.closed) || /session has ended|exited unexpectedly|not found|unknown session/i.test(errorText(error));
var Turn = class {
  constructor(delivery, { compacting = false } = {}) {
    this.receipts = delivery ? [delivery] : [];
    this.compacting = compacting;
    this.updated = false;
    this.named = false;
    this.step = "";
    this.done = new Promise((resolve) => {
      this.finish = resolve;
    });
  }
  get latest() {
    return this.receipts.at(-1);
  }
};
var Conversation = class {
  constructor(agent, key, record) {
    this.agent = agent;
    this.key = key;
    this.record = record;
    this.connection = void 0;
    this.live = false;
    this.options = void 0;
    this.mcp = void 0;
    this.handler = void 0;
    this.unsubscribe = void 0;
    this.turn = void 0;
    this.starting = void 0;
    this.queue = [];
    this.pumping = false;
    this.steering = Promise.resolve();
    this.idleTimer = void 0;
    this.mode = void 0;
    this.used = record?.at ?? 0;
  }
  get busy() {
    return Boolean(this.turn || this.starting || this.queue.length);
  }
  /** As Buzz's session controls show it. */
  get state() {
    if (this.turn?.compacting) return "compacting";
    return this.busy ? "active" : "idle";
  }
  /** A DM, Solo chat or channel-scoped conversation: one per channel. */
  get whole() {
    return Boolean(this.record?.whole ?? this.wholeNow);
  }
  // --- deliveries
  /** Runs a mention or wake in this conversation: steered into the running
   * turn when Claude can take it there, else queued as the next turn. */
  async deliver(delivery, conversation, settings) {
    this.used = Date.now();
    this.wholeNow = conversation.key === conversation.channel;
    if (await this.trySteer(delivery, conversation)) return;
    const item = { delivery, conversation, settings, stopped: false };
    item.done = new Promise((resolve) => {
      item.resolve = resolve;
    });
    this.queue.push(item);
    delivery.workingUntil(item.done);
    delivery.interruptible?.(async () => this.stop(item));
    this.agent.changed();
    void this.pump();
  }
  /** Steers one message at a time, so each sees the last one's cursor. */
  trySteer(delivery, conversation) {
    const attempt = this.steering.then(() => this.steer(delivery, conversation));
    this.steering = attempt.catch(() => false);
    return attempt;
  }
  async steer(delivery, conversation) {
    const turn = this.turn;
    if (!turn || turn.compacting || !this.live || !this.connection.canSteer || delivery.model || delivery.effort)
      return false;
    let prompt;
    try {
      prompt = await this.agent.kit.turnPrompt(delivery, conversation, this.cursorOption());
    } catch (error) {
      console.warn("claude-acp: could not build a steered prompt", error);
      return false;
    }
    const still = () => this.turn === turn && this.live;
    let answer;
    if (still())
      answer = await this.connection.request(
        "_session/steering",
        {
          sessionId: this.record.sessionId,
          prompt: [{ type: "text", text: steerPrompt(prompt.text) }],
          // Never start a turn of its own: the plugin would not track it.
          _meta: { steering: { idleBehavior: "promptRequired" } }
        },
        START_TIMEOUT_MS
      ).catch(() => void 0);
    if (answer?.outcome !== "injected") {
      prompt.restore();
      return false;
    }
    this.record.cursor = prompt.cursor;
    this.save();
    turn.latest?.superseded?.();
    turn.receipts.push(delivery);
    turn.step = "";
    delivery.acknowledged?.();
    delivery.workingUntil(turn.done);
    delivery.interruptible?.(async () => this.stop());
    return true;
  }
  async pump() {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (!this.turn && this.queue.length && !this.agent.disposed) {
        const item = this.queue.shift();
        if (item.stopped) {
          item.resolve(STOPPED);
          continue;
        }
        if (item.delivery.current && !item.delivery.current()) {
          item.delivery.ignored?.();
          item.resolve({ ok: true });
          continue;
        }
        this.starting = item;
        this.agent.changed();
        const result = await this.runTurn(item).catch(
          (error) => this.agent.disposed ? STOPPED : { ok: false, error: errorText(error) }
        );
        this.starting = void 0;
        item.resolve(result);
        if (!result.ok && result.error) await this.agent.report(item, result.error);
      }
    } finally {
      this.pumping = false;
      this.starting = void 0;
      this.scheduleIdle();
      this.agent.changed();
    }
  }
  async runTurn(item, retried = false) {
    const { delivery, conversation, settings } = item;
    await this.open(delivery, conversation, settings);
    if (item.stopped) return STOPPED;
    this.options = await applyOptions(this.connection, this.record.sessionId, this.options, wantedOptions(delivery, settings, this.agent.defaults));
    this.mode = settings.mode;
    if (item.stopped) return STOPPED;
    const before = this.record.cursor;
    const prompt = await this.agent.kit.turnPrompt(delivery, conversation, this.cursorOption());
    if (item.stopped) {
      prompt.restore();
      return STOPPED;
    }
    const turn = new Turn(delivery);
    const { connection } = this;
    this.turn = turn;
    this.starting = void 0;
    this.agent.changed();
    let result;
    try {
      const sent = connection.request("session/prompt", {
        sessionId: this.record.sessionId,
        prompt: [{ type: "text", text: prompt.text }]
      });
      this.record.cursor = prompt.cursor;
      this.save();
      delivery.acknowledged?.();
      result = outcomeOf((await sent)?.stopReason);
    } catch (error) {
      if (!turn.updated) {
        prompt.restore();
        this.record.cursor = before;
      }
      if (sessionLost(error, connection)) this.lose();
      if (this.agent.disposed || connection.stopped) result = STOPPED;
      else if (!turn.updated && !retried && turn.receipts.length === 1 && sessionLost(error, connection)) {
        this.turn = void 0;
        this.starting = item;
        turn.finish({ ok: true });
        return this.runTurn(item, true);
      } else result = { ok: false, error: errorText(error) };
    } finally {
      if (this.turn === turn) this.turn = void 0;
      if (this.record) this.record.at = Date.now();
      this.save();
      this.agent.changed();
    }
    turn.finish(result);
    return result;
  }
  cursorOption() {
    return this.record?.cursor ? { cursor: this.record.cursor } : void 0;
  }
  // --- the Claude session
  /** Makes the session live for this turn: reuses it, resumes it, or starts
   * a new one, each with a fresh MCP server (a server takes one MCP
   * session, so every new or resumed Claude session needs its own). */
  async open(delivery, conversation, settings) {
    const agentHandle = delivery.agent;
    const connection = await this.agent.connect(agentHandle, settings);
    const cwd = await this.agent.workspace(settings);
    this.handler = this.agent.tools(agentHandle, conversation, cwd);
    const shape = sessionShape(settings);
    if (this.live && this.connection === connection && this.record?.shape === shape) {
      this.agent.opened(this);
      return;
    }
    await this.close();
    if (this.record?.shape !== void 0 && this.record.shape !== shape) this.forget();
    await this.agent.makeRoom(this);
    this.agent.opened(this);
    try {
      await this.start(delivery, settings, connection, cwd, shape);
    } catch (error) {
      this.lose();
      throw error;
    }
  }
  async start(delivery, settings, connection, cwd, shape) {
    const mcp = await this.agent.host.serveMcp((message) => this.answerMcp(message));
    this.mcp = mcp;
    void mcp.closed?.then(() => {
      if (this.mcp === mcp) this.lose();
    });
    const system = await this.agent.kit.systemPrompt(delivery, {
      scope: settings.scope,
      cwd,
      instructions: settings.instructions
    });
    const params = sessionParams(cwd, mcp, system);
    let opened;
    if (this.record?.sessionId && connection.sessionCapabilities.resume)
      opened = await connection.request("session/resume", { sessionId: this.record.sessionId, ...params }, START_TIMEOUT_MS).catch((error) => {
        if (connection.closed || !(error?.code === -32002 || /not found/i.test(errorText(error)))) throw error;
        console.warn("claude-acp: the saved session is gone; starting a new one", error);
        return void 0;
      });
    if (!opened) {
      if (this.record) this.forget();
      opened = await connection.request("session/new", params, START_TIMEOUT_MS);
      this.record = { sessionId: opened.sessionId, at: Date.now() };
    }
    this.record.shape = shape;
    this.record.whole = this.whole;
    this.connection = connection;
    this.options = opened.configOptions;
    this.unsubscribe = connection.onSession(this.record.sessionId, (update) => this.update(update));
    this.live = true;
    this.save();
  }
  answerMcp(message) {
    if (this.handler) return this.handler(message);
    return Promise.resolve(
      message?.id === void 0 ? void 0 : { jsonrpc: "2.0", id: message.id, error: { code: -32603, message: "No Buzz turn is running" } }
    );
  }
  update(update) {
    if (update.sessionUpdate === "config_option_update" && Array.isArray(update.configOptions)) {
      this.options = update.configOptions;
      return;
    }
    const turn = this.turn;
    if (!turn) return;
    turn.updated = true;
    if (update.sessionUpdate === "session_info_update") {
      if (typeof update.title === "string" && update.title && !turn.named) {
        turn.named = true;
        for (const receipt of turn.receipts) receipt.named?.(update.title);
      }
      return;
    }
    const step = stepOf(update);
    if (!step) return;
    const label = `${step.tool}\0${step.target ?? ""}`;
    if (label === turn.step) return;
    turn.step = label;
    turn.latest?.step?.(step.tool, step.target);
  }
  /** The session can't be used as it is: the next turn opens it again. */
  lose() {
    this.live = false;
    this.unsubscribe?.();
    this.unsubscribe = void 0;
    const mcp = this.mcp;
    this.mcp = void 0;
    void mcp?.close().catch(() => {
    });
    this.agent.closed(this);
    if (!this.busy) this.agent.idle();
  }
  /** Closes the session and its MCP server, keeping the record so the next
   * turn resumes it. */
  async close() {
    clearTimeout(this.idleTimer);
    const { connection, live } = this;
    const sessionId = this.record?.sessionId;
    this.lose();
    if (live && sessionId && connection && !connection.closed && connection.sessionCapabilities.close)
      await connection.request("session/close", { sessionId }, CLOSE_TIMEOUT_MS).catch(() => {
      });
  }
  /** Forgets the session: the next turn starts a new one. */
  forget() {
    this.record = void 0;
    this.agent.forget(this.key);
  }
  save() {
    this.agent.save(this);
  }
  scheduleIdle() {
    clearTimeout(this.idleTimer);
    if (!this.live || this.busy) return;
    this.idleTimer = setTimeout(() => {
      if (!this.busy) void this.close().then(() => this.agent.idle());
    }, IDLE_MS);
  }
  // --- controls
  /** Stops `item` if it is still queued or starting, else the running turn. */
  stop(item) {
    if (item) {
      const queued = this.queue.indexOf(item);
      if (queued >= 0) {
        this.queue.splice(queued, 1);
        item.resolve(STOPPED);
        this.agent.changed();
        return;
      }
    }
    if (this.starting && (!item || this.starting === item)) this.starting.stopped = true;
    if (this.turn && this.record && this.connection && !this.connection.closed)
      this.connection.notify("session/cancel", { sessionId: this.record.sessionId });
  }
  /** Stops everything: the running turn and every queued message. */
  interrupt() {
    for (const item of this.queue.splice(0)) item.resolve(STOPPED);
    this.stop();
    this.agent.changed();
  }
  /** Ends the session for good; the next message starts a new one. */
  async reset() {
    const pending = [this.turn?.done, this.starting?.done].filter(Boolean);
    this.interrupt();
    if (pending.length)
      await Promise.race([Promise.all(pending), new Promise((resolve) => setTimeout(resolve, SETTLE_MS))]);
    await this.close();
    this.forget();
    this.agent.changed();
    this.agent.idle();
  }
  /** Compacts the session's history to free context. */
  async compact() {
    if (this.busy) throw new Error("Wait for the active turn to finish first.");
    if (!this.record) throw new Error("This conversation has no Claude session yet.");
    if (!this.live)
      throw new Error("This conversation's Claude session is closed. It opens again with the next message.");
    const turn = new Turn(void 0, { compacting: true });
    this.turn = turn;
    this.agent.changed();
    try {
      const answer = await this.connection.request("session/prompt", {
        sessionId: this.record.sessionId,
        prompt: [{ type: "text", text: "/compact" }]
      });
      turn.finish(outcomeOf(answer?.stopReason));
    } catch (error) {
      turn.finish({ ok: false, error: errorText(error) });
      throw error;
    } finally {
      if (this.turn === turn) this.turn = void 0;
      this.agent.changed();
      void this.pump();
    }
  }
  /** The agent is gone: stop quietly; its process is being stopped too. */
  dispose() {
    clearTimeout(this.idleTimer);
    for (const item of this.queue.splice(0)) item.resolve(STOPPED);
    if (this.starting) this.starting.stopped = true;
    this.lose();
  }
};

// src/runtime/agent.js
var REMOVED = "This agent was removed";
var AgentRuntime = class {
  constructor(runtime, key) {
    this.runtime = runtime;
    this.key = key;
    this.kit = runtime.kit;
    this.host = runtime.host;
    this.defaults = runtime.defaults;
    this.conversations = /* @__PURE__ */ new Map();
    this.records = void 0;
    this.loaded = runtime.records.load(key).then((records) => {
      this.records = records;
      runtime.notify();
    });
    this.connection = void 0;
    this.connecting = void 0;
    this.standalone = /* @__PURE__ */ new Map();
    this.starting = 0;
    this.disposed = false;
  }
  /** The conversation for `key`, with the session it saved, if any. */
  async conversation(key) {
    await this.loaded;
    let conversation = this.conversations.get(key);
    if (!conversation) {
      conversation = new Conversation(this, key, this.records[key]);
      this.conversations.set(key, conversation);
    }
    return conversation;
  }
  /** The conversation already in memory for a place, for session controls. */
  conversationAt(place, scope) {
    const own = scope === "thread" && place.root ? `${place.channelId}/${place.root}` : place.channelId;
    const found = this.conversations.get(own);
    if (found || own === place.channelId) return found;
    const whole = this.conversations.get(place.channelId);
    return whole?.whole ? whole : void 0;
  }
  /** The key a place's saved session is under, for controls on a
   * conversation not yet in memory. */
  savedKeyAt(place, scope) {
    const own = scope === "thread" && place.root ? `${place.channelId}/${place.root}` : place.channelId;
    if (this.records?.[own] || own === place.channelId) return own;
    return this.records?.[place.channelId]?.whole ? place.channelId : own;
  }
  // --- the adapter process
  /** The agent's adapter process, started on first use. */
  async connect(agentHandle, settings) {
    if (this.disposed) throw new Error(REMOVED);
    if (this.connection && !this.connection.closed) return this.connection;
    this.connecting ??= (async () => {
      const cwd = await this.workspace(settings);
      const connection = await AcpConnection.start(this.host, {
        cwd,
        agent: agentHandle,
        permissionMode: (sessionId) => this.modeOf(sessionId)
      });
      if (this.disposed) {
        void connection.stop();
        throw new Error(REMOVED);
      }
      connection.onClose((reason, stopped) => {
        if (this.connection === connection) this.connection = void 0;
        for (const conversation of this.conversations.values())
          if (conversation.connection === connection) conversation.lose();
        if (!stopped) console.warn(`claude-acp: ${reason}`);
        this.changed();
      });
      this.connection = connection;
      return connection;
    })().finally(() => {
      this.connecting = void 0;
    });
    return this.connecting;
  }
  workspace(settings) {
    return this.host.resolveDirectory(settings.workspace);
  }
  /** The conversation's Buzz tools, answered over MCP, for this turn. */
  tools(agentHandle, conversation, cwd) {
    const read = this.host.readFile && ((path) => this.host.readFile(path, { cwd }));
    return this.kit.tools(agentHandle, conversation, read ? { read } : void 0);
  }
  /** The permission mode of the session `sessionId` runs in, if known. */
  modeOf(sessionId) {
    if (this.standalone.has(sessionId)) return this.standalone.get(sessionId);
    for (const conversation of this.conversations.values())
      if (conversation.record?.sessionId === sessionId) return conversation.mode;
    return void 0;
  }
  /** Stops the process once nothing has a session open in it. */
  idle() {
    const open = [...this.conversations.values()].some((conversation) => conversation.live || conversation.busy);
    if (!open && !this.standalone.size && !this.starting && !this.connecting) void this.connection?.stop();
  }
  // --- saved sessions
  save(conversation) {
    if (!this.records || this.disposed) return;
    if (conversation.record) this.records[conversation.key] = conversation.record;
    else delete this.records[conversation.key];
    void this.runtime.records.save(this.key, this.records);
  }
  forget(key) {
    if (!this.records) return;
    delete this.records[key];
    void this.runtime.records.save(this.key, this.records, [key]);
  }
  /** The agent's sessions for views across agents, newest first. */
  sessions() {
    if (!this.records) return [];
    const keys = /* @__PURE__ */ new Set([...Object.keys(this.records), ...this.conversations.keys()]);
    return [...keys].map((key) => {
      const conversation = this.conversations.get(key);
      const record = conversation ? conversation.record : this.records[key];
      if (!record) return void 0;
      const [channelId, root] = key.split("/");
      return {
        channelId,
        ...root ? { root } : {},
        at: Math.max(record.at ?? 0, conversation?.used ?? 0),
        ...conversation?.live || conversation?.busy ? { status: conversation.busy ? "Working" : "Idle" } : {}
      };
    }).filter(Boolean).sort((a, b) => b.at - a.at);
  }
  // --- shared with conversations
  opened(conversation) {
    this.runtime.opened(conversation);
  }
  closed(conversation) {
    this.runtime.closed(conversation);
  }
  makeRoom(conversation) {
    return this.runtime.makeRoom(conversation);
  }
  changed() {
    this.runtime.notify();
  }
  /** Tells the owner a turn failed, where the message was. */
  async report(item, error) {
    if (this.disposed) return;
    await this.kit.reply(item.delivery.agent, item.conversation, `${TITLE} could not finish: ${error}`, { notifyOwner: true }).catch((reason) => console.warn("claude-acp: could not report a failed turn", reason));
  }
  // --- standalone turns
  /** A watch's or timer's turn, in a one-off session that joins no
   * conversation and is closed after. */
  async runOnce({ delivery, signal, prompt }) {
    const settings = readConfig(delivery.config);
    const agentHandle = delivery.agent;
    let connection;
    let mcp;
    let sessionId;
    let unsubscribe;
    this.starting += 1;
    try {
      connection = await this.connect(agentHandle, settings);
      const cwd = await this.workspace(settings);
      if (signal.aborted) return { ok: false, error: "The turn was stopped before it started" };
      mcp = await this.host.serveMcp(this.tools(agentHandle, void 0, cwd));
      const system = await this.kit.systemPrompt(delivery, { scope: settings.scope, cwd, instructions: settings.instructions });
      const created = await connection.request("session/new", sessionParams(cwd, mcp, system), START_TIMEOUT_MS);
      sessionId = created.sessionId;
      this.standalone.set(sessionId, settings.mode);
      this.starting -= 1;
      let last = "";
      unsubscribe = connection.onSession(sessionId, (update) => {
        const step = stepOf(update);
        const label = step && `${step.tool}\0${step.target ?? ""}`;
        if (!step || label === last) return;
        last = label;
        delivery.step?.(step.tool, step.target);
      });
      await applyOptions(connection, sessionId, created.configOptions, wantedOptions(delivery, settings, this.defaults));
      const text = await prompt();
      if (text === void 0) return { ok: true };
      if (signal.aborted) return { ok: false, error: "The turn was stopped before it started" };
      const cancel = () => connection.notify("session/cancel", { sessionId });
      signal.addEventListener("abort", cancel, { once: true });
      try {
        const answer = await connection.request("session/prompt", {
          sessionId,
          prompt: [{ type: "text", text: this.kit.standalonePrompt(agentHandle, text) }]
        });
        const outcome = outcomeOf(answer?.stopReason);
        return outcome.stopped ? { ok: false, error: "The turn was stopped" } : { ok: outcome.ok, ...outcome.error && { error: outcome.error } };
      } finally {
        signal.removeEventListener("abort", cancel);
      }
    } catch (error) {
      return { ok: false, error: errorText(error) };
    } finally {
      if (!this.standalone.delete(sessionId)) this.starting -= 1;
      unsubscribe?.();
      if (sessionId && connection && !connection.closed && connection.sessionCapabilities.close)
        void connection.request("session/close", { sessionId }, CLOSE_TIMEOUT_MS).catch(() => {
        });
      void mcp?.close().catch(() => {
      });
      this.idle();
    }
  }
  /** The agent was removed here, or the plugin is unloading. */
  dispose() {
    this.disposed = true;
    for (const conversation of this.conversations.values()) conversation.dispose();
    void this.connection?.stop();
    this.connection = void 0;
  }
};

// src/runtime/catalog.js
var CHECKING = Object.freeze({ readiness: "checking", models: [], loading: true });
var OFFERED = (level) => level.value !== "default" && level.value !== "max";
var Catalog = class {
  constructor(host, notify) {
    this.host = host;
    this.notify = notify;
    this.state = CHECKING;
    this.reading = void 0;
    this.started = false;
  }
  snapshot = () => this.state;
  /** Reads the catalog the first time anyone asks for it. */
  ensure() {
    if (!this.started) void this.check();
    return this.reading ?? Promise.resolve(this.state);
  }
  /** Reads it again; one read runs at a time. */
  check() {
    this.started = true;
    if (this.reading) return this.reading;
    if (!this.state.loading) {
      this.state = Object.freeze({ ...this.state, readiness: "checking", loading: true });
      this.notify();
    }
    this.reading = this.read().then(
      (found) => found,
      (error) => ({
        readiness: "attention",
        attentionLabel: `Set up ${TITLE}`,
        attentionDescription: errorText(error),
        error: errorText(error),
        models: []
      })
    ).then((state) => {
      this.state = Object.freeze({ ...state, loading: false });
      this.reading = void 0;
      this.notify();
      return this.state;
    });
    return this.reading;
  }
  /** The models, waiting for a read only when there are none yet. */
  async models() {
    const state = this.state.models.length ? this.state : await this.ensure();
    if (!state.models.length) throw new Error(state.error ?? `${TITLE} offered no models`);
    return state.models;
  }
  async read() {
    const cwd = await this.host.resolveDirectory(DEFAULTS.workspace);
    const connection = await AcpConnection.start(this.host, { cwd });
    try {
      const auth = await this.account(connection);
      const created = await connection.request("session/new", { cwd, mcpServers: [] }, START_TIMEOUT_MS);
      const models = await this.modelsOf(connection, created);
      if (connection.sessionCapabilities.close)
        await connection.request("session/close", { sessionId: created.sessionId }, CLOSE_TIMEOUT_MS).catch(() => {
        });
      const signedOut = auth.state === "unauthenticated";
      return signedOut ? {
        readiness: "attention",
        attentionLabel: "Sign in to Claude",
        attentionDescription: "Run claude auth login in a terminal, then check again.",
        models
      } : { readiness: "ready", account: auth.account, models };
    } finally {
      void connection.stop();
    }
  }
  /** The sign-in state, from `auth/status` where the adapter offers it. */
  async account(connection) {
    const status = connection.capabilities.auth?.status ? await connection.request("auth/status", {}, START_TIMEOUT_MS).catch(() => void 0) : connection.auth;
    const accounts = Array.isArray(status?.accounts) ? status.accounts : [];
    const account = (accounts.find((item) => item?.active) ?? accounts[0])?.label;
    return { state: typeof status?.state === "string" ? status.state : "unknown", account };
  }
  /** Each model with the thinking levels it takes, read by switching the
   * session to it. */
  async modelsOf(connection, created) {
    const { sessionId } = created;
    let options = created.configOptions ?? [];
    const models = [];
    for (const choice of choicesOf(optionById(options, "model")?.options)) {
      if (optionById(options, "model")?.currentValue !== choice.value) {
        const changed = await connection.request("session/set_config_option", { sessionId, configId: "model", value: choice.value }, START_TIMEOUT_MS).catch(() => void 0);
        if (Array.isArray(changed?.configOptions)) options = changed.configOptions;
      }
      const effort = optionById(options, "effort");
      models.push({
        id: choice.value,
        label: choice.name,
        description: choice.description,
        efforts: choicesOf(effort?.options).filter(OFFERED).map((level) => ({ id: level.value, label: level.name })),
        ...effort?.currentValue && effort.currentValue !== "default" ? { effort: effort.currentValue } : {}
      });
    }
    return models;
  }
};

// src/runtime/defaults.js
var VERSION = 1;
var NONE = Object.freeze({ model: "", effort: "" });
var DeviceDefaults = class {
  constructor(store, key, notify) {
    this.store = store;
    this.key = key;
    this.notify = notify;
    this.current = NONE;
    this.loaded = this.load();
  }
  async load() {
    try {
      const value = JSON.parse(await this.store.read(this.key) ?? "null");
      if (value?.version === VERSION && typeof value.model === "string") {
        this.current = Object.freeze({ model: value.model, effort: typeof value.effort === "string" ? value.effort : "" });
        this.notify();
      }
    } catch {
    }
  }
  snapshot = () => this.current;
  /** Settles once saved; only then are the new defaults used. */
  async save({ model = "", effort = "" }) {
    await this.store.set(this.key, JSON.stringify({ version: VERSION, model, effort }));
    this.current = Object.freeze({ model, effort });
    this.notify();
  }
  /** The model and effort a turn runs with: the agent's own, else this
   * device's default, else Claude's. A default effort follows only the
   * default model it was chosen for. */
  effective(settings) {
    const { model, effort } = this.current;
    return {
      model: settings.model || model || "default",
      effort: settings.effort || (!settings.model || settings.model === model ? effort : "") || "default"
    };
  }
};

// src/runtime/records.js
var VERSION2 = 1;
var valid = (record) => typeof record?.sessionId === "string" && record.sessionId.length > 0;
function marksOf(cursor) {
  try {
    const value = cursor ? JSON.parse(cursor) : {};
    return {
      seen: typeof value?.seen === "number" ? value.seen : 0,
      ...value?.threads && typeof value.threads === "object" ? { threads: value.threads } : {}
    };
  } catch {
    return { seen: 0 };
  }
}
var cursorOf = ({ seen, threads }) => typeof seen === "number" ? JSON.stringify({ seen, ...threads ? { threads } : {} }) : void 0;
var newestFirst = (records) => Object.entries(records).sort(([, a], [, b]) => (b.at ?? 0) - (a.at ?? 0)).slice(0, SAVED_CONVERSATIONS);
var SessionRecords = class {
  constructor(store, typeKey) {
    this.store = store;
    this.typeKey = typeKey;
    this.writes = /* @__PURE__ */ new Map();
  }
  ownKey(agentKey) {
    return `${this.typeKey}/${agentKey}`;
  }
  claudeKey(agentKey) {
    return `${CLAUDE_SESSIONS}:${agentKey}`;
  }
  async read(key) {
    try {
      const value = JSON.parse(await this.store.read(key) ?? "null");
      return value && typeof value === "object" ? value : void 0;
    } catch {
      return void 0;
    }
  }
  /** The agent's saved sessions by conversation key. Sessions Buzz's Claude
   * saved for it fill in conversations this harness has none for. */
  async load(agentKey) {
    const own = await this.read(this.ownKey(agentKey));
    const records = {};
    if (own?.v === VERSION2 && own.conversations && typeof own.conversations === "object") {
      for (const [key, record] of Object.entries(own.conversations)) if (valid(record)) records[key] = record;
    }
    const claude = await this.read(this.claudeKey(agentKey)) ?? {};
    for (const [key, saved] of Object.entries(claude)) {
      if (records[key] || typeof saved?.id !== "string" || !saved.id) continue;
      const cursor = cursorOf(saved);
      records[key] = { sessionId: saved.id, ...cursor ? { cursor } : {}, at: Number(saved.at) || 0 };
    }
    return records;
  }
  /** Saves `records`, and drops `forgotten` conversation keys from Buzz's
   * Claude record too. Saves for one agent run one at a time; one asked for
   * while another runs is made once after it, with the latest records. */
  save(agentKey, records, forgotten = []) {
    let write = this.writes.get(agentKey);
    if (!write) {
      write = { running: void 0, owed: void 0 };
      this.writes.set(agentKey, write);
    }
    const owed = write.owed ?? { forgotten: /* @__PURE__ */ new Set() };
    owed.records = records;
    for (const key of forgotten) owed.forgotten.add(key);
    write.owed = owed;
    if (!write.running)
      write.running = (async () => {
        while (write.owed) {
          const next = write.owed;
          write.owed = void 0;
          await this.write(agentKey, next.records, next.forgotten).catch(
            (error) => console.warn("claude-acp: could not save sessions", error)
          );
        }
        write.running = void 0;
      })();
    return write.running;
  }
  async write(agentKey, records, forgotten) {
    const kept = newestFirst(Object.fromEntries(Object.entries(records).filter(([, record]) => valid(record))));
    await this.store.set(this.ownKey(agentKey), JSON.stringify({ v: VERSION2, conversations: Object.fromEntries(kept) }));
    const claude = await this.read(this.claudeKey(agentKey)) ?? {};
    for (const key of forgotten) delete claude[key];
    for (const [key, record] of kept) {
      const prior = claude[key]?.id === record.sessionId ? claude[key] : {};
      claude[key] = { ...prior, id: record.sessionId, ...marksOf(record.cursor), at: record.at ?? Date.now() };
    }
    const mirrored = Object.fromEntries(newestFirst(claude).filter(([, saved]) => typeof saved?.id === "string"));
    await this.store.set(this.claudeKey(agentKey), Object.keys(mirrored).length ? JSON.stringify(mirrored) : null);
  }
  /** Resolves once every save asked for so far has been written. */
  async flush() {
    await Promise.all([...this.writes.values()].map((write) => write.running));
  }
};

// src/runtime/runtime.js
var Runtime = class {
  constructor({ agents, host, typeKey }) {
    this.agentsService = agents;
    this.kit = agents.harness;
    this.host = host;
    this.typeKey = typeKey;
    this.listeners = /* @__PURE__ */ new Set();
    this.agents = /* @__PURE__ */ new Map();
    this.live = /* @__PURE__ */ new Set();
    this.sessionLists = /* @__PURE__ */ new Map();
    this.records = new SessionRecords(agents.storage, typeKey);
    this.defaults = new DeviceDefaults(agents.storage, `${typeKey}.provider-defaults.v1`, () => this.notify());
    this.catalog = new Catalog(host, () => this.notify());
  }
  agent(key) {
    let agent = this.agents.get(key);
    if (!agent || agent.disposed) {
      agent = new AgentRuntime(this, key);
      this.agents.set(key, agent);
    }
    return agent;
  }
  // --- turns
  async run(delivery) {
    const settings = readConfig(delivery.config);
    const conversation = await this.kit.conversation(delivery, settings.scope);
    if (!conversation) return delivery.ignored?.();
    const agent = this.agent(delivery.agent.key);
    const target = await agent.conversation(conversation.key);
    await target.deliver(delivery, conversation, settings);
  }
  runOnce(turn) {
    return this.agent(turn.delivery.agent.key).runOnce(turn);
  }
  // --- session controls
  scope = (agent) => readConfig(agent.config).scope;
  sessionState(agent, place) {
    return this.agents.get(agent.key)?.conversationAt(place, this.scope(agent))?.state ?? "idle";
  }
  async control(agent, place, action, reset) {
    const owner = this.agent(agent.key);
    await owner.loaded;
    const scope = this.scope(agent);
    const conversation = owner.conversationAt(place, scope) ?? await owner.conversation(owner.savedKeyAt(place, scope));
    if (action === "interrupt") return conversation.interrupt();
    if (action === "compact") return conversation.compact();
    if (action === "new") return reset ? reset(() => conversation.reset()) : conversation.reset();
  }
  // --- open sessions
  opened(conversation) {
    this.live.delete(conversation);
    this.live.add(conversation);
  }
  closed(conversation) {
    this.live.delete(conversation);
  }
  /** Closes least recently used idle sessions until one more may open. */
  async makeRoom(opening) {
    while (this.live.size >= MAX_LIVE_SESSIONS) {
      const idle = [...this.live].find((conversation) => conversation !== opening && !conversation.busy);
      if (!idle) return;
      void idle.close();
    }
  }
  // --- views
  /** Stable until something changes, as Buzz's views read it. */
  sessionList(key) {
    let list = this.sessionLists.get(key);
    if (!list) {
      list = this.agent(key).sessions();
      this.sessionLists.set(key, list);
    }
    return list;
  }
  async models(agent) {
    const models = await this.catalog.models();
    return {
      current: this.defaults.effective(readConfig(agent.config)).model,
      models: models.map(({ id, label, efforts, effort }) => ({ id, label, efforts, ...effort && { effort } }))
    };
  }
  subscribe = (listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  notify() {
    this.sessionLists.clear();
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (error) {
        console.warn("claude-acp: a listener failed", error);
      }
    }
  }
  // --- lifecycle
  /** Stops agents of this type that no longer run here. */
  sync() {
    const running = new Set(
      this.agentsService.snapshot().running.filter((agent) => agent.type === this.typeKey).map((agent) => agent.key)
    );
    for (const [key, agent] of this.agents) {
      if (running.has(key)) continue;
      this.agents.delete(key);
      agent.dispose();
    }
  }
  dispose() {
    for (const agent of this.agents.values()) agent.dispose();
    this.agents.clear();
    this.live.clear();
  }
};

// src/ui/react.js
var React;
function bindReact(react) {
  React = react;
}
var h = (...args) => React.createElement(...args);
function Fragment(props) {
  return React.createElement(React.Fragment, null, props.children);
}
var useEffect = (...args) => React.useEffect(...args);
var useId = () => React.useId();
var useLayoutEffect = (...args) => React.useLayoutEffect(...args);
var useRef = (initial) => React.useRef(initial);
var useState = (initial) => React.useState(initial);
var useSyncExternalStore = (subscribe2, snapshot) => React.useSyncExternalStore(subscribe2, snapshot, snapshot);

// src/ui/services.js
var services = { runtime: void 0, agents: void 0, openSetup: void 0 };
function bindServices(next) {
  Object.assign(services, next);
}

// src/ui/activity.jsx
var claudeActivity = () => services.agents.types().find((type) => type.key === CLAUDE_TYPE)?.tabs?.find((tab) => tab.role === "activity")?.component;
function ActivityTab(props) {
  const Claude = useSyncExternalStore(services.agents.subscribe, claudeActivity);
  if (Claude) return /* @__PURE__ */ h(Claude, { ...props });
  return /* @__PURE__ */ h("p", { className: "text-body-sm text-subtle", style: { margin: 0 } }, "Turn on Buzz's Claude plugin in Settings \u2192 Plugins to see this agent's conversations and transcripts here.");
}

// src/assets/claude-logo.png
var claude_logo_default = "data:image/png;base64,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";

// src/assets/harness-mark.svg
var harness_mark_default = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">%0A  <defs><mask id="g2-cut"><rect width="32" height="32" fill="%23fff"/><circle cx="25.3" cy="25.3" r="7.15" fill="%23000"/></mask></defs>%0A  <g mask="url(%23g2-cut)">%0A    <path d="M13.483 14.019 L13.02 1.42 A1.35 1.35 0 0 1 15.719 1.372 L15.696 13.981 Z M14.049 13.628 L18.649 4.535 A1.15 1.15 0 0 1 20.68 5.615 L15.714 14.513 Z M14.364 13.289 L24.571 5.271 A1.45 1.45 0 0 1 26.317 7.587 L15.795 15.188 Z M15.039 13.534 L25.343 11.684 A1.2 1.2 0 0 1 25.718 14.054 L15.347 15.478 Z M15.485 13.756 L27.342 17.136 A1.3 1.3 0 0 1 26.582 19.623 L14.862 15.795 Z M15.654 14.35 L22.764 20.709 A1.1 1.1 0 0 1 21.264 22.318 L14.424 15.669 Z M15.884 14.771 L20.464 26.618 A1.4 1.4 0 0 1 17.833 27.576 L13.726 15.556 Z M15.504 15.315 L14.465 25.546 A1.2 1.2 0 0 1 12.083 25.254 L13.55 15.076 Z M15.163 15.726 L8.238 26.04 A1.35 1.35 0 0 1 6.026 24.491 L13.349 14.457 Z M14.513 15.714 L5.943 20.505 A1.15 1.15 0 0 1 4.863 18.475 L13.628 14.049 Z M14 15.748 L1.208 16 A1.4 1.4 0 0 1 1.208 13.2 L14 13.452 Z M13.608 15.187 L4.347 10.508 A1.2 1.2 0 0 1 5.474 8.388 L14.532 13.449 Z M13.379 14.677 L6.722 4.857 A1.3 1.3 0 0 1 8.903 3.44 L15.167 13.516 Z" fill="%23D97757"/>%0A    <circle cx="14.6" cy="14.6" r="2.3" fill="%23D97757"/>%0A  </g>%0A  <circle cx="25.3" cy="25.3" r="5.9" fill="%23C9623F"/>%0A  <g transform="translate(25.3 25.3)"><path d="M0 -2.85 V2.85 M-2.85 0 H2.85" stroke="%23FFF6F0" stroke-width="1.6" stroke-linecap="round"/></g>%0A</svg>';

// src/ui/icons.jsx
var rem = (size) => typeof size === "number" ? `${size / 16}rem` : size;
function Tabler({ size = 16, className, paths }) {
  return /* @__PURE__ */ h(
    "svg",
    {
      xmlns: "http://www.w3.org/2000/svg",
      width: rem(size),
      height: rem(size),
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 2,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      className: ["tabler-icon", className].filter(Boolean).join(" "),
      "aria-hidden": "true"
    },
    /* @__PURE__ */ h("path", { stroke: "none", d: "M0 0h24v24H0z", fill: "none" }),
    paths.map((d) => /* @__PURE__ */ h("path", { key: d, d }))
  );
}
var CaretDownIcon = (props) => /* @__PURE__ */ h(Tabler, { ...props, paths: ["M6 9l6 6l6 -6"] });
var CheckIcon = (props) => /* @__PURE__ */ h(Tabler, { ...props, paths: ["M5 12l5 5l10 -10"] });
var SpinnerIcon = (props) => /* @__PURE__ */ h(Tabler, { ...props, paths: ["M12 3a9 9 0 1 0 9 9"] });
function picture(href) {
  return function Picture({ size = 20, className }) {
    return /* @__PURE__ */ h("svg", { width: rem(size), height: rem(size), viewBox: "0 0 32 32", xmlns: "http://www.w3.org/2000/svg", className, "aria-hidden": "true" }, /* @__PURE__ */ h("image", { href, width: "32", height: "32" }));
  };
}
var ClaudeLogoIcon = picture(claude_logo_default);
var HarnessIcon = picture(harness_mark_default);

// src/ui/controls.jsx
function Button({
  variant = "subtle",
  size = "md",
  shape = "capsule",
  type = "button",
  loading = false,
  disabled = false,
  onClick,
  children,
  ...props
}) {
  const inert = disabled || loading;
  return /* @__PURE__ */ h(
    "button",
    {
      ...props,
      type,
      disabled: disabled && !loading,
      "aria-disabled": inert || void 0,
      "aria-busy": loading || void 0,
      "data-disabled": inert ? "" : void 0,
      "data-buzz-ui": "",
      className: "buzz-button",
      "data-variant": variant,
      "data-size": size,
      "data-button-shape": shape,
      "data-loading": loading || void 0,
      onClick: (event) => {
        if (inert) {
          event.preventDefault();
          return;
        }
        onClick?.(event);
      }
    },
    /* @__PURE__ */ h("span", { className: "buzz-button-label" }, children),
    loading && /* @__PURE__ */ h(SpinnerIcon, { size: 18, className: "buzz-button-spinner" })
  );
}
var SettingsGroup = ({ children }) => /* @__PURE__ */ h("div", { "data-buzz-ui": "", className: "buzz-settings-group", "data-layout": "rows" }, children);
function PreferenceRow({ title, subtitle, trailing }) {
  return /* @__PURE__ */ h("div", { "data-buzz-ui": "", className: "buzz-preference-row", "data-variant": "default" }, /* @__PURE__ */ h("div", { className: "buzz-preference-row-content" }, /* @__PURE__ */ h("div", { className: "buzz-preference-row-label" }, title), subtitle && /* @__PURE__ */ h("span", { className: "buzz-preference-row-description" }, subtitle)), trailing != null && /* @__PURE__ */ h("div", { className: "buzz-preference-row-trailing" }, trailing));
}
function Field({ label, description, optional = false, children }) {
  const id = useId();
  const describedBy = description ? `${id}-description` : void 0;
  return /* @__PURE__ */ h("div", { "data-buzz-ui": "", className: "buzz-field" }, /* @__PURE__ */ h("label", { className: "buzz-field-label", htmlFor: id }, label, optional && /* @__PURE__ */ h(Fragment, null, " ", /* @__PURE__ */ h("span", { className: "buzz-field-optional" }, "Optional"))), children({ id, "aria-describedby": describedBy }), description && /* @__PURE__ */ h("p", { id: describedBy, className: "buzz-field-description" }, description));
}
function Input({ value, onValueChange, ...props }) {
  return /* @__PURE__ */ h(
    "input",
    {
      ...props,
      "data-buzz-ui": "",
      "data-size": "md",
      className: "buzz-input",
      value,
      onChange: (event) => onValueChange(event.target.value)
    }
  );
}
var EXAMPLE = "Help me plan my week and prioritize tasks.";
function AgentInstructions({ value, disabled, onChange, creation = false }) {
  return /* @__PURE__ */ h(Field, { label: "Instructions", optional: creation }, (control) => /* @__PURE__ */ h(
    "textarea",
    {
      ...control,
      "data-buzz-ui": "",
      className: "buzz-textarea",
      "data-variant": "text",
      "data-surface": "inset",
      "data-appearance": "outlined",
      rows: creation ? 4 : 8,
      value,
      disabled,
      placeholder: EXAMPLE,
      onChange: (event) => onChange(event.target.value)
    }
  ));
}
function SaveButton({ form, saving, visible, disabled = false }) {
  if (!visible && !saving) return null;
  return /* @__PURE__ */ h("div", null, /* @__PURE__ */ h(Button, { type: "submit", form, variant: "prominent", loading: saving, disabled }, saving ? "Saving\u2026" : "Save"));
}
var stack = (gap = "var(--space-4)") => ({ display: "grid", gap, minWidth: 0 });
var row = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "var(--space-2)", maxWidth: "100%" };

// src/ui/select.jsx
var GAP = 4;
var EDGE = 8;
var CLOSE_MS = 120;
var TYPEAHEAD_MS = 700;
var LAYER = {
  position: "fixed",
  inset: 0,
  width: "100vw",
  height: "100vh",
  maxWidth: "none",
  maxHeight: "none",
  margin: 0,
  padding: 0,
  border: "none",
  background: "transparent",
  overflow: "visible"
};
function placement(anchor, list, align) {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const below = height - anchor.bottom - EDGE;
  const above = anchor.top - EDGE;
  const side = below < 220 && above > below ? "top" : "bottom";
  const listWidth = list?.offsetWidth || anchor.width;
  const start = align === "end" ? anchor.right - listWidth : anchor.left;
  const left = Math.min(Math.max(EDGE, start), Math.max(EDGE, width - EDGE - listWidth));
  return {
    side,
    style: {
      position: "absolute",
      left: `${left}px`,
      ...side === "bottom" ? { top: `${anchor.bottom + GAP}px` } : { bottom: `${height - anchor.top + GAP}px` },
      "--anchor-width": `${anchor.width}px`,
      "--available-height": `${Math.max(120, (side === "bottom" ? below : above) - GAP)}px`,
      "--available-width": `${width - 2 * EDGE}px`,
      "--transform-origin": side === "bottom" ? "top" : "bottom"
    }
  };
}
function Select({
  label,
  value,
  options,
  onValueChange,
  variant = "compact",
  appearance = "outlined",
  size,
  valueLabel,
  valueSuffix,
  valueTitle,
  leading,
  align = "start",
  disabled = false,
  description
}) {
  const id = useId();
  const trigger = useRef(null);
  const layer = useRef(null);
  const list = useRef(null);
  const closing = useRef(void 0);
  const typed = useRef({ text: "", at: 0 });
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState("closed");
  const [place, setPlace] = useState({ side: "bottom", style: {} });
  const [highlight, setHighlight] = useState(-1);
  const selectedIndex = options.findIndex((option) => option.value === value);
  const selected = options[selectedIndex];
  const enabled = (index) => index >= 0 && index < options.length && !options[index].disabled;
  const step = (from, by) => {
    for (let index = from + by; index >= 0 && index < options.length; index += by) if (enabled(index)) return index;
    return from;
  };
  const optionId = (index) => `${id}-option-${index}`;
  const position = () => {
    const anchor = trigger.current?.getBoundingClientRect();
    if (anchor) setPlace(placement(anchor, list.current?.parentElement, align));
  };
  const show = () => {
    if (disabled || open) return;
    clearTimeout(closing.current);
    position();
    try {
      layer.current?.showPopover?.();
    } catch {
    }
    setOpen(true);
    setPhase("starting");
    setHighlight(enabled(selectedIndex) ? selectedIndex : step(-1, 1));
    requestAnimationFrame(() => {
      list.current?.focus({ preventScroll: true });
      requestAnimationFrame(() => setPhase("open"));
    });
  };
  const hide = (returnFocus = true) => {
    if (!open) return;
    setOpen(false);
    setPhase("ending");
    clearTimeout(closing.current);
    closing.current = setTimeout(() => {
      try {
        layer.current?.hidePopover?.();
      } catch {
      }
      setPhase("closed");
    }, CLOSE_MS);
    if (returnFocus) trigger.current?.focus({ preventScroll: true });
  };
  const choose = (index) => {
    if (!open || !enabled(index)) return;
    hide();
    if (options[index].value !== value) onValueChange(options[index].value);
  };
  useEffect(() => () => clearTimeout(closing.current), []);
  useEffect(() => {
    if (disabled) hide(false);
  }, [disabled]);
  useLayoutEffect(() => {
    if (open) position();
  }, [open, options.length]);
  useEffect(() => {
    if (!open) return;
    const move = (event) => {
      if (event.type === "scroll" && list.current?.contains(event.target)) return;
      position();
    };
    window.addEventListener("resize", move);
    window.addEventListener("scroll", move, true);
    return () => {
      window.removeEventListener("resize", move);
      window.removeEventListener("scroll", move, true);
    };
  }, [open]);
  useEffect(() => {
    if (open && highlight >= 0) document.getElementById(optionId(highlight))?.scrollIntoView?.({ block: "nearest" });
  }, [open, highlight]);
  const onTriggerKey = (event) => {
    if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
      event.preventDefault();
      show();
    }
  };
  const onListKey = (event) => {
    const { key } = event;
    const handled = () => {
      event.preventDefault();
      event.stopPropagation();
    };
    if (key === "Escape") {
      handled();
      hide();
    } else if (key === "Tab") hide();
    else if (key === "ArrowDown") {
      handled();
      setHighlight((index) => step(index, 1));
    } else if (key === "ArrowUp") {
      handled();
      setHighlight((index) => step(index, -1));
    } else if (key === "Home") {
      handled();
      setHighlight(step(-1, 1));
    } else if (key === "End") {
      handled();
      setHighlight(step(options.length, -1));
    } else if (key === "Enter" || key === " " && !typed.current.text) {
      handled();
      choose(highlight);
    } else if (key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      const now = Date.now();
      const text = (now - typed.current.at < TYPEAHEAD_MS ? typed.current.text : "") + key.toLowerCase();
      typed.current = { text, at: now };
      setTimeout(() => {
        if (Date.now() - typed.current.at >= TYPEAHEAD_MS) typed.current = { text: "", at: 0 };
      }, TYPEAHEAD_MS);
      const match = options.findIndex((option, index) => enabled(index) && option.label.toLowerCase().startsWith(text));
      if (match >= 0) setHighlight(match);
    }
  };
  const preference = variant === "preference";
  const control = /* @__PURE__ */ h("div", { "data-buzz-ui": "", className: "buzz-select text-body", "data-variant": "compact", "data-appearance": appearance }, /* @__PURE__ */ h("div", { className: "sr-only", id: `${id}-label` }, label), /* @__PURE__ */ h(
    Button,
    {
      ref: trigger,
      shape: preference ? "control" : "capsule",
      variant: appearance === "outlined" ? "outline" : appearance,
      size: size ?? "sm",
      disabled,
      role: "combobox",
      "aria-label": label,
      "aria-haspopup": "listbox",
      "aria-expanded": open,
      "aria-controls": `${id}-list`,
      "data-popup-open": open ? "" : void 0,
      onClick: () => open ? hide() : show(),
      onKeyDown: onTriggerKey
    },
    /* @__PURE__ */ h("span", { className: "buzz-select-value-content" }, leading && /* @__PURE__ */ h("span", { className: "buzz-select-leading", "aria-hidden": "true" }, leading), /* @__PURE__ */ h("span", { className: "buzz-select-value-text" }, /* @__PURE__ */ h("span", { className: "buzz-select-value", title: valueTitle ?? selected?.label }, valueLabel ?? selected?.label ?? ""), valueSuffix && /* @__PURE__ */ h("span", { className: "buzz-select-value-suffix" }, valueSuffix))),
    /* @__PURE__ */ h("span", { "aria-hidden": "true" }, /* @__PURE__ */ h(CaretDownIcon, { size: 14, className: "buzz-dropdown-chevron" }))
  ), /* @__PURE__ */ h(
    "div",
    {
      ref: layer,
      popover: "manual",
      style: { ...LAYER, ...phase === "closed" ? { display: "none" } : {}, pointerEvents: open ? "auto" : "none" },
      onPointerDown: (event) => {
        if (event.target === layer.current) {
          event.preventDefault();
          hide(false);
        }
      }
    },
    /* @__PURE__ */ h(
      "div",
      {
        "data-buzz-ui": "",
        className: "buzz-select-popup text-body",
        "data-variant": "compact",
        "data-side": place.side,
        "data-starting-style": phase === "starting" ? "" : void 0,
        "data-ending-style": phase === "ending" ? "" : void 0,
        style: place.style,
        onKeyDown: onListKey
      },
      /* @__PURE__ */ h(
        "div",
        {
          ref: list,
          role: "listbox",
          id: `${id}-list`,
          tabIndex: -1,
          "aria-labelledby": `${id}-label`,
          "aria-activedescendant": open && highlight >= 0 ? optionId(highlight) : void 0,
          style: { outline: "none" }
        },
        options.map((option, index) => {
          const isSelected = index === selectedIndex;
          const describedBy = option.description ? `${optionId(index)}-description` : void 0;
          return /* @__PURE__ */ h(
            "div",
            {
              key: option.value || "\0default",
              id: optionId(index),
              role: "option",
              "aria-selected": isSelected,
              "aria-disabled": option.disabled || void 0,
              "aria-label": option.label,
              "aria-describedby": describedBy,
              className: "buzz-select-option",
              "data-highlighted": open && index === highlight ? "" : void 0,
              "data-selected": isSelected ? "" : void 0,
              "data-disabled": option.disabled ? "" : void 0,
              onPointerMove: () => enabled(index) && index !== highlight && setHighlight(index),
              onClick: () => choose(index)
            },
            /* @__PURE__ */ h("span", { className: "buzz-select-option-main" }, option.leading && /* @__PURE__ */ h("span", { className: "buzz-select-leading", "aria-hidden": "true" }, option.leading), /* @__PURE__ */ h("span", { className: "buzz-select-option-content" }, /* @__PURE__ */ h("span", null, option.label), option.description && /* @__PURE__ */ h("span", { id: describedBy, className: "buzz-select-option-description text-body-sm text-subtle" }, option.description))),
            /* @__PURE__ */ h("span", { className: "buzz-select-indicator", "data-selected": isSelected ? "" : void 0, "aria-hidden": "true" }, /* @__PURE__ */ h(CheckIcon, { size: 14 }))
          );
        })
      )
    )
  ));
  return preference ? /* @__PURE__ */ h(PreferenceRow, { title: label, subtitle: description, trailing: control }) : control;
}

// src/ui/models.jsx
var subscribe = (listener) => services.runtime.subscribe(listener);
var catalogNow = () => services.runtime.catalog.snapshot();
var defaultsNow = () => services.runtime.defaults.snapshot();
function useCatalog() {
  const state = useSyncExternalStore(subscribe, catalogNow);
  useEffect(() => {
    void services.runtime.catalog.ensure();
  }, []);
  return { ...state, retry: () => void services.runtime.catalog.check() };
}
var useDefaults = () => useSyncExternalStore(subscribe, defaultsNow);
var logo = () => /* @__PURE__ */ h(ClaudeLogoIcon, { size: 20 });
function modelChoices(catalog, defaults, value, { claudeDefaultOnly = false } = {}) {
  const fallback = catalog.models.find((model) => model.id === "default");
  const claudeDefault = fallback?.description || "Claude default";
  const preferred = !claudeDefaultOnly && defaults.model && catalog.models.find((model) => model.id === defaults.model);
  const defaultName = preferred?.label || (defaults.model && !claudeDefaultOnly ? defaults.model : claudeDefault);
  const listed = catalog.models.filter(
    (model) => model.id !== "default" && (claudeDefaultOnly || model.id !== defaults.model || model.id === value)
  );
  const options = [
    {
      value: "",
      label: claudeDefaultOnly ? claudeDefault : `${defaultName} \xB7 Default`,
      description: claudeDefaultOnly ? "Use Claude default" : "Following the provider's model default",
      leading: logo()
    },
    ...listed.map((model) => ({ value: model.id, label: model.label, description: model.description, leading: logo() }))
  ];
  if (value && !catalog.loading && !listed.some((model) => model.id === value) && !(preferred && value === defaults.model))
    options.push({ value, label: value, description: "Unavailable model", leading: logo() });
  const chosen = options.find((option) => option.value === value) ?? options[0];
  return {
    options,
    valueLabel: catalog.loading && !catalog.models.length ? "Loading models\u2026" : value ? chosen.label : claudeDefaultOnly ? claudeDefault : defaultName,
    valueSuffix: !value && !claudeDefaultOnly && !catalog.loading ? " \xB7 Default" : void 0,
    valueTitle: chosen.label
  };
}
var effortsOf = (catalog, defaults, model) => catalog.models.find((entry) => entry.id === (model || defaults.model || "default"))?.efforts ?? [];
function thinkingChoices(catalog, defaults, current) {
  const efforts = effortsOf(catalog, defaults, current.model);
  return [
    { value: "", label: "Automatic \xB7 Default" },
    ...current.effort && !efforts.some((level) => level.id === current.effort) ? [{ value: current.effort, label: catalog.models.length ? `${effortLabel(current.effort)} (unavailable)` : effortLabel(current.effort) }] : [],
    ...efforts.map((level) => ({ value: level.id, label: effortLabel(level.id) }))
  ];
}
var withModel = (catalog, defaults, current, model) => ({
  ...current,
  model,
  effort: !catalog.models.length || effortsOf(catalog, defaults, model).some((level) => level.id === current.effort) ? current.effort : ""
});
function ModelSelect({ catalog, current, onChange, disabled, variant, appearance = "outlined", align }) {
  const defaults = useDefaults();
  const choice = modelChoices(catalog, defaults, current.model);
  return /* @__PURE__ */ h(
    Select,
    {
      label: "Model",
      value: current.model,
      options: choice.options,
      valueLabel: choice.valueLabel,
      valueSuffix: choice.valueSuffix,
      valueTitle: choice.valueTitle,
      leading: logo(),
      variant,
      appearance,
      size: appearance === "glass-ghost" ? "xs" : void 0,
      align,
      disabled: disabled || catalog.loading && !catalog.models.length,
      onValueChange: (model) => onChange(withModel(catalog, defaults, current, model))
    }
  );
}
function ThinkingSelect({ catalog, current, onChange, disabled, variant }) {
  const defaults = useDefaults();
  return /* @__PURE__ */ h(
    Select,
    {
      label: "Thinking",
      value: current.effort,
      options: thinkingChoices(catalog, defaults, current),
      valueLabel: current.effort ? void 0 : "Automatic",
      valueSuffix: current.effort ? void 0 : " \xB7 Default",
      variant,
      disabled: disabled || !catalog.models.length,
      onValueChange: (effort) => onChange({ ...current, effort })
    }
  );
}

// src/ui/create.jsx
function CreateModel({ config, onChange, onReadyChange, disabled, modelAppearance }) {
  const current = readConfig(config);
  const catalog = useCatalog();
  const ready = !catalog.loading && !catalog.error;
  useEffect(() => onReadyChange?.(ready), [onReadyChange, ready]);
  return /* @__PURE__ */ h(Fragment, null, /* @__PURE__ */ h("div", { style: { ...row, justifyContent: "flex-end" } }, /* @__PURE__ */ h(
    ModelSelect,
    {
      catalog,
      current,
      disabled,
      variant: "compact",
      appearance: modelAppearance ?? "outlined",
      align: "end",
      onChange: (next) => onChange({ ...config, ...next })
    }
  ), catalog.error && /* @__PURE__ */ h(Button, { size: "sm", disabled, loading: catalog.loading, onClick: catalog.retry }, "Try again")), catalog.error && /* @__PURE__ */ h("span", { role: "alert", className: "text-body-sm text-danger" }, catalog.error));
}
function CreateThinking({ config, onChange, disabled }) {
  const catalog = useCatalog();
  return /* @__PURE__ */ h(
    ThinkingSelect,
    {
      catalog,
      current: readConfig(config),
      disabled,
      variant: "compact",
      onChange: (next) => onChange({ ...config, ...next })
    }
  );
}
function CreateConfiguration({ harnessControl, onReadyChange, ...props }) {
  return /* @__PURE__ */ h(SettingsGroup, null, harnessControl, /* @__PURE__ */ h(PreferenceRow, { title: "Model", trailing: /* @__PURE__ */ h(CreateModel, { ...props, onReadyChange }) }), /* @__PURE__ */ h(PreferenceRow, { title: "Thinking", trailing: /* @__PURE__ */ h(CreateThinking, { ...props }) }));
}
function Create({ config, onChange, disabled }) {
  const current = readConfig(config);
  return /* @__PURE__ */ h(
    AgentInstructions,
    {
      creation: true,
      value: current.instructions,
      disabled,
      onChange: (instructions) => onChange({ ...config, instructions })
    }
  );
}
function CreateAction({ disabled }) {
  const catalog = useCatalog();
  if (catalog.readiness !== "attention" || !services.openSetup) return null;
  return /* @__PURE__ */ h(
    Button,
    {
      size: "sm",
      variant: "subtle",
      shape: "capsule",
      disabled,
      "aria-label": catalog.attentionLabel,
      onClick: services.openSetup
    },
    "Set up"
  );
}

// src/ui/provider.jsx
function DefaultControl({ onConfigure }) {
  const catalog = useCatalog();
  const defaults = useDefaults();
  const [error, setError] = useState("");
  const save = (next) => services.runtime.defaults.save({ ...defaults, ...next }).then(
    () => setError(""),
    (reason) => setError(errorText(reason))
  );
  const models = modelChoices(catalog, defaults, defaults.model, { claudeDefaultOnly: true });
  const efforts = effortsOf(catalog, defaults, defaults.model);
  const busy = catalog.loading && !catalog.models.length;
  return /* @__PURE__ */ h(Fragment, null, /* @__PURE__ */ h("div", { style: row }, /* @__PURE__ */ h(
    Select,
    {
      label: `${TITLE} default model`,
      value: defaults.model,
      options: models.options,
      valueLabel: models.valueLabel,
      valueTitle: models.valueTitle,
      leading: /* @__PURE__ */ h(ClaudeLogoIcon, { size: 20 }),
      align: "end",
      disabled: busy,
      onValueChange: (model) => save({ model, effort: effortsOf(catalog, defaults, model).some((level) => level.id === defaults.effort) ? defaults.effort : "" })
    }
  ), efforts.length > 0 && /* @__PURE__ */ h(
    Select,
    {
      label: "Default thinking",
      value: defaults.effort,
      options: [{ value: "", label: "Automatic" }, ...efforts.map((level) => ({ value: level.id, label: effortLabel(level.id) }))],
      valueLabel: defaults.effort ? effortLabel(defaults.effort) : "Automatic",
      align: "end",
      disabled: busy,
      onValueChange: (effort) => save({ effort })
    }
  ), onConfigure && /* @__PURE__ */ h(Button, { size: "sm", variant: "ghost", onClick: onConfigure }, "Edit configuration")), error && /* @__PURE__ */ h("span", { role: "alert" }, error));
}
function ProviderDialogBody({ onClose }) {
  const catalog = useCatalog();
  const ready = catalog.readiness === "ready";
  const checking = catalog.readiness === "checking";
  const line = checking ? "Checking Claude\u2026" : ready ? `Signed in with your Claude account${catalog.account ? ` (${catalog.account})` : ""}.` : catalog.attentionDescription;
  return /* @__PURE__ */ h("div", { style: stack("var(--space-6)") }, /* @__PURE__ */ h("div", { style: stack("var(--space-2)") }, /* @__PURE__ */ h("p", { role: catalog.readiness === "attention" ? "alert" : "status", className: "text-body-sm text-primary", style: { margin: 0 } }, /* @__PURE__ */ h("strong", null, line)), /* @__PURE__ */ h("p", { className: "text-body-sm text-subtle", style: { margin: 0 } }, TITLE, " runs Claude Code through buzz-claude-acp with the claude login on this computer. Change accounts with claude auth login in a terminal.")), ready && /* @__PURE__ */ h(SettingsGroup, null, /* @__PURE__ */ h(PreferenceRow, { title: "Default model", trailing: /* @__PURE__ */ h(DefaultControl, null) })), /* @__PURE__ */ h("div", { style: { ...row, justifyContent: "flex-end" } }, /* @__PURE__ */ h(Button, { onClick: onClose }, ready ? "Done" : "Cancel"), !ready && /* @__PURE__ */ h(Button, { variant: "prominent", loading: checking, onClick: catalog.retry }, "Check again")));
}
var providerOf = () => ({
  // Stable until the catalog changes: it is replaced, never changed.
  snapshot: () => services.runtime.catalog.snapshot(),
  // Buzz subscribes when it shows the row: the first read starts there,
  // never inside a snapshot.
  subscribe: (listener) => {
    const unsubscribe = services.runtime.subscribe(listener);
    void services.runtime.catalog.ensure();
    return unsubscribe;
  },
  check: () => services.runtime.catalog.check(),
  DialogBody: ProviderDialogBody,
  DefaultControl
});

// src/ui/settings.jsx
var same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
var LABELS = {
  model: "Model",
  effort: "Thinking",
  instructions: "Instructions",
  workspace: "Workspace",
  scope: "Sessions",
  mode: "Permissions"
};
var shown = (key, value) => key === "scope" ? SCOPES.find(([id]) => id === value)?.[1] : key === "mode" ? MODES.find(([id]) => id === value)?.[1] : value || (key === "instructions" ? "No instructions" : "Default");
function useDraft(saved) {
  const [state, setState] = useState({ draft: saved, latest: saved, conflicts: [] });
  const opened = useRef(saved);
  useEffect(() => {
    const prior = opened.current;
    if (same(prior, saved)) return;
    opened.current = saved;
    setState(({ draft, conflicts }) => {
      const found = new Set(conflicts);
      const next = {};
      for (const key of Object.keys(saved)) {
        if (same(draft[key], prior[key])) next[key] = saved[key];
        else {
          next[key] = draft[key];
          if (!same(saved[key], prior[key]) && !same(draft[key], saved[key])) found.add(key);
        }
      }
      return { draft: next, latest: saved, conflicts: [...found] };
    });
  }, [JSON.stringify(saved)]);
  return {
    ...state,
    setDraft: (draft) => setState((current) => ({ ...current, draft })),
    resolve: (key, useLatest) => setState((current) => ({
      ...current,
      draft: useLatest ? { ...current.draft, [key]: current.latest[key] } : current.draft,
      conflicts: current.conflicts.filter((item) => item !== key)
    }))
  };
}
function Conflict({ field, latest, draft, resolve, disabled }) {
  return /* @__PURE__ */ h("fieldset", { "aria-label": `${LABELS[field]} conflict`, style: { ...stack("var(--space-2)"), margin: 0, padding: "var(--space-3) 0", border: 0 } }, /* @__PURE__ */ h("p", { role: "alert", className: "text-body-sm text-warning", style: { margin: 0 } }, LABELS[field], " changed elsewhere. Choose which changes to keep."), /* @__PURE__ */ h("div", { className: "text-body-sm", style: { overflowWrap: "anywhere" } }, /* @__PURE__ */ h("p", { style: { margin: 0, whiteSpace: "pre-wrap" } }, "Latest: ", shown(field, latest[field])), /* @__PURE__ */ h("p", { style: { margin: 0, whiteSpace: "pre-wrap" } }, "Yours: ", shown(field, draft[field]))), /* @__PURE__ */ h("div", { style: row }, /* @__PURE__ */ h(Button, { disabled, onClick: () => resolve(field, true) }, "Use latest"), /* @__PURE__ */ h(Button, { disabled, onClick: () => resolve(field, false) }, "Keep mine")));
}
function SettingsTab({ agent, save, settingsHost, settingsSection, settingsContent }) {
  const form = useId();
  const saved = readConfig(agent.config);
  const { draft, latest, conflicts, setDraft, resolve } = useDraft(saved);
  const unavailable = Boolean(agent.configProblem) && !settingsHost?.pendingSave;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const errorRef = useRef(null);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);
  const catalog = useCatalog();
  const configChanged = !same(draft, saved);
  const changed = configChanged || Boolean(settingsHost?.pendingSave);
  const submit = async () => {
    if (saving || !changed || conflicts.length || unavailable) return;
    const next = readConfig(draft);
    setDraft(next);
    setSaving(true);
    setError("");
    try {
      await save({ ...agent.config, ...next }, { base: agent.configBase ?? {} });
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setSaving(false);
    }
  };
  return /* @__PURE__ */ h(
    "form",
    {
      id: form,
      style: { ...stack(), containerType: "inline-size" },
      onSubmit: (event) => {
        event.preventDefault();
        void submit();
      }
    },
    error && /* @__PURE__ */ h("p", { ref: errorRef, tabIndex: -1, role: "alert", className: "buzz-field-error" }, error),
    unavailable && /* @__PURE__ */ h("p", { className: "text-body-sm text-muted", style: { margin: 0 } }, "Your edits stay in this form. You can save them when configuration is available again."),
    settingsSection !== "runtime" && /* @__PURE__ */ h(Fragment, null, ["model", "effort"].filter((field) => conflicts.includes(field)).map((field) => /* @__PURE__ */ h(Conflict, { key: field, field, latest, draft, resolve, disabled: saving })), /* @__PURE__ */ h(SettingsGroup, null, settingsHost?.typeControl?.(configChanged) ?? null, /* @__PURE__ */ h(ModelSelect, { catalog, current: draft, onChange: setDraft, variant: "preference", align: "start" }), /* @__PURE__ */ h(ThinkingSelect, { catalog, current: draft, onChange: setDraft, variant: "preference" })), catalog.error && /* @__PURE__ */ h("div", { style: row }, /* @__PURE__ */ h("span", { role: "alert", className: "text-body-sm text-danger" }, catalog.error), /* @__PURE__ */ h(Button, { size: "sm", loading: catalog.loading, onClick: catalog.retry }, "Try again")), /* @__PURE__ */ h("div", { style: stack("var(--space-2)") }, conflicts.includes("instructions") && /* @__PURE__ */ h(Conflict, { field: "instructions", latest, draft, resolve, disabled: saving }), /* @__PURE__ */ h(
      AgentInstructions,
      {
        value: draft.instructions,
        disabled: false,
        onChange: (instructions) => setDraft({ ...draft, instructions })
      }
    ))),
    settingsSection !== "identity" && /* @__PURE__ */ h(Fragment, null, ["workspace", "scope", "mode"].filter((field) => conflicts.includes(field)).map((field) => /* @__PURE__ */ h(Conflict, { key: field, field, latest, draft, resolve, disabled: saving })), /* @__PURE__ */ h("div", { style: stack("var(--space-2)") }, /* @__PURE__ */ h(Field, { label: "Workspace", description: "The folder Claude works in. Use ~/ for your home folder." }, (control) => /* @__PURE__ */ h(
      Input,
      {
        ...control,
        value: draft.workspace,
        spellCheck: false,
        autoCorrect: "off",
        autoCapitalize: "none",
        onValueChange: (workspace) => setDraft({ ...draft, workspace })
      }
    ))), /* @__PURE__ */ h(
      Select,
      {
        label: "Sessions",
        variant: "preference",
        value: draft.scope,
        options: SCOPES.map(([value, label]) => ({ value, label })),
        onValueChange: (scope) => setDraft({ ...draft, scope: scope === "channel" ? "channel" : "thread" })
      }
    ), /* @__PURE__ */ h(
      Select,
      {
        label: "Permissions",
        variant: "preference",
        value: draft.mode,
        options: MODES.map(([value, label, description]) => ({ value, label, description })),
        onValueChange: (mode) => setDraft({ ...draft, mode })
      }
    )),
    /* @__PURE__ */ h(SaveButton, { form, saving, visible: changed, disabled: conflicts.length > 0 || unavailable }),
    settingsSection !== "identity" ? settingsContent ?? null : null
  );
}

// src/index.js
var inject = ["react", "agents", "host"];
function apply(ctx) {
  const { agents, host } = ctx;
  if (!host.spawn || !host.serveMcp || !host.resolveDirectory) return;
  if (!agents.harness || !agents.storage)
    throw new Error(`${TITLE} needs a newer Buzz: this one does not let plugins run agent harnesses.`);
  const typeKey = `${ctx.pluginOwner?.id ?? PLUGIN_ID}/${TYPE_ID}`;
  const runtime = new Runtime({ agents, host, typeKey });
  const navigation = ctx.reflect?.get?.("navigation");
  bindReact(ctx.react);
  bindServices({
    runtime,
    agents,
    openSetup: navigation && (() => void navigation.open({ version: 1, kind: "settings", section: "agents", provider: typeKey }))
  });
  ctx.effect(() => {
    runtime.sync();
    const unsubscribe = agents.subscribe(() => runtime.sync());
    return () => {
      unsubscribe();
      runtime.dispose();
    };
  });
  agents.register({
    id: TYPE_ID,
    title: TITLE,
    icon: HarnessIcon,
    description: "Claude on this computer, signed in with your own Claude account. Each thread it is mentioned in is one continuing session.",
    defaults: () => ({ config: { ...DEFAULTS } }),
    summary: (agent) => readConfig(agent.config).model || TITLE,
    // New agent
    Create,
    CreateAction,
    CreateConfiguration,
    CreateModel,
    createModelReportsReadiness: true,
    CreateThinking,
    // Changing harness, sharing, syncing
    adopt,
    carry,
    describeMigration,
    exportShared: (saved) => ({ runtime: "claude", model: readConfig(saved).model }),
    syncedSettings: { schema: SYNCED_SCHEMA, withSynced: withSyncedSettings },
    // Settings and views
    tabs: [
      { id: "settings", title: "Settings", role: "settings", splitSettings: true, reconcilesConfig: true, component: SettingsTab },
      { id: "activity", title: "Activity", role: "activity", component: ActivityTab }
    ],
    provider: providerOf(),
    sessions: { list: (key) => runtime.sessionList(key), subscribe: runtime.subscribe },
    // Buzz's Claude reads usage from the same Claude Code session files.
    usage: async (agent, options) => {
      const claude = agents.types().find((type) => type.key === CLAUDE_TYPE);
      if (!claude?.usage) throw new Error("Usage needs Buzz's Claude plugin turned on in Settings \u2192 Plugins.");
      return claude.usage(agent, options);
    },
    models: (agent) => runtime.models(agent),
    // Running
    resumes: true,
    sessionControls: {
      scope: runtime.scope,
      state: (agent, place) => runtime.sessionState(agent, place),
      run: (agent, place, action, reset) => runtime.control(agent, place, action, reset),
      subscribe: runtime.subscribe
    },
    run: (delivery) => runtime.run(delivery),
    runOnce: (turn) => runtime.runOnce(turn),
    readFile: (agent, path) => host.readFile(path, { cwd: readConfig(agent.config).workspace })
  });
}
export {
  apply,
  inject
};
