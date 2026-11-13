// A stand-in for Buzz's host and an ACP adapter, for tests that exercise the
// plugin without Buzz or Claude. `adapter` answers requests by method name.

export function fakeAdapter(handlers = {}) {
  const sent = [];
  let onStdout;
  let exit;
  const exited = new Promise((resolve) => {
    exit = resolve;
  });
  const emit = (message) => setTimeout(() => onStdout?.(`${JSON.stringify(message)}\n`), 0);
  const process = {
    exited,
    killed: false,
    write: async (line) => {
      const message = JSON.parse(line);
      sent.push(message);
      const handler = message.method && handlers[message.method];
      if (message.id === undefined || !message.method) return;
      if (!handler) return emit({ jsonrpc: "2.0", id: message.id, result: {} });
      Promise.resolve(handler(message.params, { emit })).then(
        (result) => result !== NO_REPLY && emit({ jsonrpc: "2.0", id: message.id, result }),
        (error) => emit({ jsonrpc: "2.0", id: message.id, error: { code: error.code ?? -32000, message: error.message } }),
      );
    },
    kill: async () => {
      process.killed = true;
      exit(null);
    },
    exit: (code) => exit(code),
  };
  return {
    sent,
    process,
    emit,
    attach: (options) => {
      onStdout = options.onStdout;
      return process;
    },
  };
}

/** Returned by a handler that answers later, through `emit`, or never. */
export const NO_REPLY = Symbol("no reply");

export function fakeHost(adapters) {
  const spawned = [];
  return {
    spawned,
    spawn: async (id, options) => {
      const adapter = typeof adapters === "function" ? adapters() : adapters;
      spawned.push({ id, options });
      return adapter.attach(options);
    },
    resolveDirectory: async (path) => path.replace(/^~/, "/home/test"),
    readFile: async () => new Uint8Array(),
    serveMcp: async () => ({ url: "http://127.0.0.1:1/mcp", headers: [{ name: "Authorization", value: "Bearer t" }], close: async () => {} }),
  };
}
