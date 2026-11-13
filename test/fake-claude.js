// A scripted stand-in for the Claude ACP adapter, speaking the protocol as
// the real one does, with hooks to make turns hang, fail or crash.

const options = (model = "default", effort = "default", mode = "auto") => [
  {
    id: "mode",
    currentValue: mode,
    options: ["default", "acceptEdits", "plan", "auto", "bypassPermissions"].map((value) => ({ value, name: value })),
  },
  {
    id: "model",
    currentValue: model,
    options: [
      { value: "default", name: "Default (recommended)", description: "Opus 5.5" },
      { value: "opus", name: "Opus 5.5" },
      { value: "sonnet", name: "Sonnet 5.5" },
    ],
  },
  {
    id: "effort",
    currentValue: effort,
    options: ["default", "low", "high", "max"].map((value) => ({ value, name: value })),
  },
];

/** `script.prompt(params, session)` decides each turn; by default a turn
 * reports a step and ends. Returns the adapter and what it was sent. */
export function fakeClaude(script = {}) {
  const state = { sessions: new Map(), next: 0, processes: [], calls: [] };
  const spawn = async (id, spawnOptions) => {
    let exit;
    const exited = new Promise((resolve) => {
      exit = resolve;
    });
    const process = {
      exited,
      killed: false,
      options: spawnOptions,
      kill: async () => {
        process.killed = true;
        exit(null);
      },
      crash: (code = 1) => exit(code),
      write: async (line) => {
        const message = JSON.parse(line);
        state.calls.push(message);
        if (message.method === "session/cancel") {
          state.sessions.get(message.params.sessionId)?.cancel?.();
          return;
        }
        if (!message.method) return;
        const reply = (result) => emit({ jsonrpc: "2.0", id: message.id, result });
        const fail = (code, text) => emit({ jsonrpc: "2.0", id: message.id, error: { code, message: text } });
        try {
          const result = await handle(message.method, message.params ?? {}, { emit, process });
          if (result !== undefined) reply(result);
        } catch (error) {
          fail(error.code ?? -32000, error.message);
        }
      },
    };
    const emit = (message) => setTimeout(() => spawnOptions.onStdout?.(`${JSON.stringify(message)}\n`), 0);
    state.processes.push(process);
    return process;
  };

  const update = (emit, sessionId, update) => emit({ jsonrpc: "2.0", method: "session/update", params: { sessionId, update } });

  async function handle(method, params, { emit }) {
    if (script[method]) {
      const answer = await script[method](params, { emit, state });
      if (answer !== undefined) return answer;
    }
    switch (method) {
      case "initialize":
        return {
          protocolVersion: 1,
          agentCapabilities: { sessionCapabilities: { resume: {}, close: {} }, auth: { status: {} } },
          _meta: { steering: { supported: true } },
        };
      case "auth/status":
        return { state: "authenticated", accounts: [{ label: "Claude Max", active: true }] };
      case "session/new": {
        const sessionId = `s${++state.next}`;
        state.sessions.set(sessionId, { id: sessionId, options: options(), mcp: params.mcpServers?.[0]?.url, system: params._meta });
        return { sessionId, configOptions: state.sessions.get(sessionId).options };
      }
      case "session/resume": {
        const session = state.sessions.get(params.sessionId);
        if (!session) throw Object.assign(new Error(`Session ${params.sessionId} not found`), { code: -32002 });
        session.mcp = params.mcpServers?.[0]?.url;
        return { configOptions: session.options };
      }
      case "session/close":
        return {};
      case "session/set_config_option": {
        const session = state.sessions.get(params.sessionId);
        const option = session.options.find((item) => item.id === params.configId);
        option.currentValue = params.value;
        return { configOptions: session.options };
      }
      case "_session/steering": {
        const session = state.sessions.get(params.sessionId);
        if (!session?.running) throw Object.assign(new Error("No turn is running"), { code: -32602 });
        session.steered = [...(session.steered ?? []), params.prompt[0].text];
        return { outcome: "injected" };
      }
      case "session/prompt": {
        const session = state.sessions.get(params.sessionId);
        session.prompts = [...(session.prompts ?? []), params.prompt[0].text];
        if (script.prompt) return script.prompt(params, { session, emit, update: (u) => update(emit, params.sessionId, u), state });
        update(emit, params.sessionId, { sessionUpdate: "tool_call", title: "mcp__buzz__send", rawInput: {} });
        return { stopReason: "end_turn" };
      }
      default:
        return {};
    }
  }

  /** A turn that runs until cancelled or `finish()`ed. */
  const hanging = () => {
    const turns = [];
    const prompt = (params, { session, update }) =>
      new Promise((resolve) => {
        session.running = true;
        update({ sessionUpdate: "tool_call", title: "Bash", rawInput: { command: "sleep 60" } });
        const end = (stopReason) => {
          session.running = false;
          resolve({ stopReason });
        };
        session.cancel = () => end("cancelled");
        turns.push({ session, finish: () => end("end_turn") });
      });
    return { prompt, turns };
  };

  return { spawn, state, hanging };
}

export function fakeHostFor(claude) {
  const servers = [];
  return {
    servers,
    spawn: claude.spawn,
    resolveDirectory: async (path) => path.replace(/^~/, "/home/test"),
    readFile: async () => new Uint8Array(),
    serveMcp: async (handler) => {
      let close;
      const server = {
        url: `http://127.0.0.1/mcp/${servers.length + 1}`,
        headers: [{ name: "Authorization", value: "Bearer t" }],
        open: true,
        handler,
        closed: new Promise((resolve) => {
          close = resolve;
        }),
        close: async () => {
          server.open = false;
          close();
        },
        /** As Buzz does when another program used the token. */
        stopByHost: () => {
          server.open = false;
          close();
        },
      };
      servers.push(server);
      return server;
    },
  };
}

export const tick = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));
