// End-to-end check of the built plugin/plugin.js outside Buzz: a stand-in
// host (real processes, real loopback MCP over HTTP, Buzz's one-initialize
// rule) and a stand-in harness kit, against the real buzz-claude-acp adapter
// on PATH and your real Claude login. Uses Claude; costs a few turns.
//
//   npm run test:e2e              every scenario
//   npm run test:e2e -- turn      one: models, carry, turn, steer, stop,
//                                 resume, control, once, failure
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const pluginPath = fileURLToPath(new URL("../../plugin/plugin.js", import.meta.url));
const scenario = process.argv[2] ?? "all";
const plugin = await import(`file://${pluginPath}`);

const log = (...args) => console.log(new Date().toISOString().slice(11, 19), ...args);
const expand = (path) => (path.startsWith("~/") ? join(homedir(), path.slice(2)) : path);

// The adapter as Buzz starts it: the manifest's process, npx and its args.
const manifest = JSON.parse(readFileSync(fileURLToPath(new URL("../../plugin/manifest.json", import.meta.url)), "utf8"));
const declared = manifest.host.processes.find((process) => process.id === "claude");
const adapter = (() => {
  try {
    return execFileSync("sh", ["-c", `command -v ${declared.program}`]).toString().trim();
  } catch {
    console.error(`${declared.program} was not found: install Node.js 22 or later`);
    process.exit(1);
  }
})();

// ---- stand-in host
const processes = [];
const host = {
  async spawn(id, options = {}) {
    if (id !== "claude") throw new Error(`undeclared process ${id}`);
    const env = { ...process.env };
    for (const [key, value] of Object.entries(options.env ?? {})) {
      if (value === null) delete env[key];
      else env[key] = value;
    }
    const child = spawn(adapter, [...declared.args, ...(options.args ?? [])], {
      cwd: options.cwd ? expand(options.cwd) : undefined,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stdout.setEncoding("utf8").on("data", (d) => options.onStdout?.(d));
    child.stderr.setEncoding("utf8").on("data", (d) => options.onStderr?.(d));
    const exited = new Promise((resolve) => child.on("exit", (code) => resolve(code)));
    processes.push(child);
    return {
      write: (data) => new Promise((resolve, reject) => child.stdin.write(data, (e) => (e ? reject(e) : resolve()))),
      end: async (data) => child.stdin.end(data),
      kill: async () => {
        child.kill("SIGTERM");
      },
      exited,
      actAs: async (agent) => log("actAs", agent.pubkey.slice(0, 8)),
    };
  },
  async serveMcp(handler) {
    const token = randomUUID();
    let initialized = false;
    const server = createServer(async (req, res) => {
      if (req.headers.authorization !== `Bearer ${token}`) {
        res.writeHead(401).end();
        return;
      }
      if (req.method === "POST") {
        // As Buzz's host does: one MCP session per server; a second
        // `initialize` stops the server.
        const peek = await new Promise((resolve) => {
          let raw = "";
          req.on("data", (c) => (raw += c));
          req.on("end", () => resolve(raw));
        });
        req.body = peek;
        if (JSON.parse(peek).method === "initialize") {
          if (initialized) {
            log("MCP: second initialize, stopping server");
            res.writeHead(404).end();
            server.close();
            server.closeAllConnections?.();
            return;
          }
          initialized = true;
        }
      }
      if (req.method !== "POST") {
        res.writeHead(405).end();
        return;
      }
      const message = JSON.parse(req.body);
      const response = await handler(message);
      if (response === undefined) {
        res.writeHead(202).end();
        return;
      }
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(response));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();
    let closed;
    return {
      url: `http://127.0.0.1:${port}/mcp`,
      headers: [{ name: "Authorization", value: `Bearer ${token}` }],
      close: async () => {
        server.close();
        server.closeAllConnections?.();
      },
      closed: new Promise((resolve) => (closed = resolve)),
    };
  },
  async resolveDirectory(path) {
    const full = expand(path);
    mkdirSync(full, { recursive: true });
    return realpathSync(full);
  },
  async readFile() {
    throw new Error("No such file");
  },
};

// ---- stand-in harness kit
const sent = [];
const replies = [];
const kit = {
  async conversation(delivery, scope) {
    const event = delivery.trigger.event;
    if (!event) return undefined;
    const root = event.root ?? event.id;
    return scope === "thread"
      ? { key: `chan1/${root}`, channel: "chan1", root, topLevel: false, where: "#general" }
      : { key: "chan1", channel: "chan1", topLevel: false, where: "#general" };
  },
  async systemPrompt(delivery, { cwd, instructions }) {
    return [
      "You are a Buzz agent. People talk to you in Buzz chat.",
      "Reply ONLY by calling the `send` tool from the buzz MCP server, with your whole answer in `text`.",
      `Your working folder is ${cwd}.`,
      instructions ? `Instructions: ${instructions}` : "",
    ].join("\n");
  },
  async turnPrompt(delivery, conversation, options) {
    const seen = options?.cursor ? Number(options.cursor) : 0;
    const event = delivery.trigger.event;
    const text = `<buzz-event>\nFrom owner in ${conversation.where} (seen=${seen}):\n${event.content}\n</buzz-event>`;
    return { text, cursor: String(seen + 1), restore: () => log("restore()") };
  },
  standalonePrompt(agent, text) {
    return `<buzz-timer>\n${text}\n</buzz-timer>`;
  },
  tools(agent, conversation) {
    return async (message) => {
      const { id, method, params } = message;
      if (id === undefined) return undefined;
      const ok = (result) => ({ jsonrpc: "2.0", id, result });
      if (method === "initialize")
        return ok({ protocolVersion: params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "buzz", version: "test" } });
      if (method === "tools/list")
        return ok({
          tools: [
            {
              name: "send",
              description: "Post a message in the current Buzz conversation.",
              inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
            },
          ],
        });
      if (method === "tools/call" && params?.name === "send") {
        sent.push({ conversation: conversation?.key ?? "(standalone)", text: params.arguments?.text });
        log("SEND", conversation?.key ?? "(standalone)", JSON.stringify(params.arguments?.text).slice(0, 200));
        return ok({ content: [{ type: "text", text: "Sent." }] });
      }
      if (method === "ping") return ok({});
      return { jsonrpc: "2.0", id, error: { code: -32601, message: `no ${method}` } };
    };
  },
  async reply(agent, conversation, text, options) {
    replies.push({ conversation: conversation.key, text, options });
    log("REPLY", conversation.key, text.slice(0, 300));
  },
};

// ---- stand-in ctx
const storage = new Map();
let registered;
const effects = [];
const agentsService = {
  harness: kit,
  storage: {
    read: async (key) => storage.get(key) ?? null,
    set: async (key, value) => (value === null ? storage.delete(key) : storage.set(key, value)),
  },
  register: (type) => (registered = type),
  types: () => [],
  snapshot: () => ({ running: [{ key: "agent-1", type: "local.claude-acp/claude-acp" }] }),
  subscribe: () => () => {},
};
const ctx = {
  react: { createElement: () => null, Fragment: "f", useState: () => [], useEffect: () => {}, useId: () => "id", cloneElement: (x) => x },
  agents: agentsService,
  host,
  pluginOwner: { id: "local.claude-acp" },
  effect: (fn) => effects.push(fn()),
};
plugin.apply(ctx);
log("registered", registered.id, registered.title, Object.keys(registered).join(","));

const agent = { key: "agent-1", pubkey: "a".repeat(64), relay: "wss://example.org", name: "Tester", owner: "b".repeat(64) };
let n = 0;
function delivery(content, extra = {}) {
  const id = `ev${++n}`;
  const receipts = [];
  let working;
  const d = {
    trigger: { type: "mention", event: { id, content, root: extra.root } },
    agent,
    config: { ...registered.defaults().config, model: "haiku", ...extra.config },
    signal: new AbortController().signal,
    workingUntil: (p) => (working = p),
    step: (tool, target) => receipts.push(`${tool}${target ? `:${target}` : ""}`),
    acknowledged: () => log("acknowledged", id),
    ignored: () => log("ignored", id),
    interruptible: (stop) => (d.stop = stop),
    named: (title) => log("named", title),
    current: () => true,
    ...extra.delivery,
  };
  return { d, receipts, working: () => working };
}
const settle = async (entry) => {
  await registered.run(entry.d);
  const result = await entry.working();
  log("settled", entry.d.trigger.event.id, JSON.stringify(result), "steps:", [...new Set(entry.receipts)].slice(0, 8).join(" | "));
  return result;
};
const expect = (cond, what) => {
  if (!cond) {
    console.error("FAIL:", what);
    process.exitCode = 1;
  } else log("PASS:", what);
};

try {
  if (scenario === "all" || scenario === "models") {
    const models = await registered.models({ config: {} });
    log("models", models.current, models.models.map((m) => `${m.id}[${m.efforts.map((e) => e.id).join("/")}]`).join(" "));
    expect(models.models.length > 0, "models are discovered");
  }
  if (scenario === "all" || scenario === "carry") {
    // An agent that was Buzz's Claude carries on in its saved session.
    storage.set("buzz.claude-code.sessions.v1:agent-1", JSON.stringify({ "chan1/old": { id: "11111111-1111-4111-8111-111111111111", seen: 5, at: 1 } }));
    for (const dispose of effects.splice(0)) dispose?.();
    plugin.apply(ctx);
    const list = registered.sessions.list("agent-1");
    await new Promise((r) => setTimeout(r, 50));
    const again = registered.sessions.list("agent-1");
    expect(again.some((s) => s.root === "old"), "sessions Buzz's Claude saved for the agent are picked up");
    storage.delete("buzz.claude-code.sessions.v1:agent-1");
    storage.delete("local.claude-acp/claude-acp/agent-1");
    for (const dispose of effects.splice(0)) dispose?.();
    plugin.apply(ctx);
  }
  if (scenario === "all" || scenario === "turn") {
    const first = delivery("Say the word 'alpha' to me.");
    const r1 = await settle(first);
    expect(r1.ok && sent.some((s) => /alpha/i.test(s.text ?? "")), "a mention is answered through the Buzz send tool");
    const second = delivery("What word did you say last time? Answer with just that word.", { root: "ev1" });
    const r2 = await settle(second);
    expect(r2.ok && sent.at(-1)?.conversation === "chan1/ev1" && /alpha/i.test(sent.at(-1)?.text ?? ""), "the same thread keeps its Claude session");
    const saved = JSON.parse([...storage.values()][0]);
    expect(saved.conversations["chan1/ev1"]?.sessionId && saved.conversations["chan1/ev1"].cursor === "2", "session and cursor are saved");
    const claude = JSON.parse(storage.get("buzz.claude-code.sessions.v1:agent-1") ?? "{}");
    expect(claude["chan1/ev1"]?.id === saved.conversations["chan1/ev1"].sessionId, "the session is recorded where Buzz's Claude Activity lists it");
    const list = registered.sessions.list("agent-1");
    expect(list.some((s) => s.channelId === "chan1" && s.root === "ev1"), "the session list shows the conversation");
  }
  if (scenario === "all" || scenario === "steer") {
    const long = delivery("Count slowly from 1 to 5 using the Bash tool: run `for i in 1 2 3 4 5; do echo $i; sleep 2; done`, then send me the output.", { root: "ev-steer" });
    await registered.run(long.d);
    await new Promise((r) => setTimeout(r, 6000));
    const mid = delivery("Also add the word 'banana' to your reply.", { root: "ev-steer" });
    await registered.run(mid.d);
    const [a, b] = await Promise.all([long.working(), mid.working()]);
    log("steer results", JSON.stringify(a), JSON.stringify(b));
    const steered = sent.filter((s) => s.conversation === "chan1/ev-steer");
    expect(a.ok && b.ok && steered.some((s) => /banana/i.test(s.text ?? "")), "a mid-turn message is steered into the running turn");
  }
  if (scenario === "all" || scenario === "stop") {
    const long = delivery("Run `sleep 60` with the Bash tool, then send me 'done'.", { root: "ev-stop" });
    await registered.run(long.d);
    await new Promise((r) => setTimeout(r, 8000));
    await long.d.stop();
    const result = await long.working();
    expect(result.ok && result.stopped, "Stop cancels the running turn");
  }
  if (scenario === "all" || scenario === "resume") {
    // A fresh runtime (as after an app restart) resumes the saved session.
    for (const dispose of effects.splice(0)) dispose?.();
    plugin.apply(ctx);
    const again = delivery("What word did you say in your first message of this thread? Just the word.", { root: "ev1" });
    const r = await settle(again);
    expect(r.ok && /alpha/i.test(sent.at(-1)?.text ?? ""), "after a restart the thread resumes its Claude session");
  }
  if (scenario === "all" || scenario === "control") {
    await registered.sessionControls.run({ key: "agent-1", config: {} }, { channelId: "chan1", root: "ev1" }, "new");
    const fresh = delivery("Did you say any word to me before in this conversation? Answer yes or no only.", { root: "ev1" });
    const r = await settle(fresh);
    expect(r.ok && /no/i.test(sent.at(-1)?.text ?? ""), "Start a new session forgets the old Claude session");
  }
  if (scenario === "all" || scenario === "once") {
    const result = await registered.runOnce({
      delivery: delivery("unused").d,
      key: "timer-1",
      signal: new AbortController().signal,
      prompt: async () => "Timer fired: send the owner the word 'tick'.",
    });
    expect(result.ok && sent.some((s) => s.conversation === "(standalone)" && /tick/i.test(s.text ?? "")), "a timer runs as a standalone turn with Buzz tools");
  }
  if (scenario === "all" || scenario === "failure") {
    const broken = delivery("hello", { root: "ev-broken", config: { workspace: "/dev/null/nope" } });
    const r = await settle(broken);
    expect(!r.ok && replies.some((x) => x.conversation === "chan1/ev-broken" && x.options?.notifyOwner), "a failed turn is reported to the owner");
  }
} finally {
  for (const dispose of effects.splice(0)) dispose?.();
  setTimeout(() => {
    for (const child of processes) child.kill("SIGKILL");
    process.exit();
  }, 1500);
}
