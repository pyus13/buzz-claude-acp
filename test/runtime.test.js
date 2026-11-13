import { afterEach, describe, expect, it, vi } from "vitest";
import { CLAUDE_SESSIONS, MAX_LIVE_SESSIONS } from "../src/constants.js";
import { Runtime } from "../src/runtime/runtime.js";
import { fakeAgents, fakeKit, fakeStorage, mention } from "./fake-buzz.js";
import { fakeClaude, fakeHostFor, tick } from "./fake-claude.js";

const TYPE = "local.claude-acp/claude-acp";
let runtimes = [];

function setup({ script = {}, storage = fakeStorage(), kit = fakeKit() } = {}) {
  const claude = fakeClaude(script);
  const host = fakeHostFor(claude);
  const agents = fakeAgents({ kit, storage });
  const runtime = new Runtime({ agents, host, typeKey: TYPE });
  runtimes.push(runtime);
  return { runtime, claude, host, agents, kit, storage, script };
}

const settle = async (message) => {
  await tick(20);
  return message.done();
};

afterEach(() => {
  for (const runtime of runtimes) runtime.dispose();
  runtimes = [];
  vi.useRealTimers();
});

describe("a mention", () => {
  it("runs one turn in a new session with the Buzz tools and Buzz's prompt", async () => {
    const { runtime, claude, host, kit } = setup();
    const message = mention("hello", { config: { instructions: "Review PRs" } });
    await runtime.run(message.delivery);
    expect(await settle(message)).toEqual({ ok: true });
    expect(message.seen.acknowledged).toBe(1);
    expect(message.seen.steps).toContain("send");
    const session = claude.state.sessions.get("s1");
    expect(session.mcp).toBe(host.servers[0].url);
    expect(session.system.claudeCode.options.systemPrompt).toEqual({
      type: "preset",
      preset: "claude_code",
      append: "system: Review PRs",
    });
    expect(session.options.find((option) => option.id === "mode").currentValue).toBe("bypassPermissions");
    expect(kit.tools).toHaveBeenCalled();
  });

  it("is ignored when the kit says it isn't this harness's", async () => {
    const { runtime, kit } = setup();
    kit.conversation.mockResolvedValueOnce(undefined);
    const message = mention("not for me");
    await runtime.run(message.delivery);
    expect(message.seen.ignored).toBe(1);
  });

  it("continues the thread's session, and saves it for both harnesses", async () => {
    const { runtime, claude, storage } = setup();
    const first = mention("one", { root: "t1" });
    await runtime.run(first.delivery);
    await settle(first);
    const second = mention("two", { root: "t1" });
    await runtime.run(second.delivery);
    await settle(second);
    expect(claude.state.sessions.size).toBe(1);
    expect(claude.state.sessions.get("s1").prompts).toHaveLength(2);
    await runtime.records.flush();
    const own = JSON.parse(storage.data.get(`${TYPE}/agent-1`));
    expect(own.conversations["c1/t1"]).toMatchObject({ sessionId: "s1", cursor: JSON.stringify({ seen: 2 }) });
    const mirror = JSON.parse(storage.data.get(`${CLAUDE_SESSIONS}:agent-1`));
    expect(mirror["c1/t1"]).toMatchObject({ id: "s1", seen: 2 });
  });

  it("applies the device default model and a per-message pick", async () => {
    const { runtime, claude } = setup();
    await runtime.defaults.save({ model: "sonnet", effort: "high" });
    const first = mention("one", { root: "t" });
    await runtime.run(first.delivery);
    await settle(first);
    const options = () => claude.state.sessions.get("s1").options;
    expect(options().find((o) => o.id === "model").currentValue).toBe("sonnet");
    expect(options().find((o) => o.id === "effort").currentValue).toBe("high");
    const picked = mention("two", { root: "t", model: "opus" });
    await runtime.run(picked.delivery);
    await settle(picked);
    expect(options().find((o) => o.id === "model").currentValue).toBe("opus");
  });

  it("refuses a synced model Claude doesn't offer instead of swapping it", async () => {
    const { runtime, kit } = setup();
    const message = mention("x", { config: { model: "gpt-9" }, synced: { model: "gpt-9" } });
    await runtime.run(message.delivery);
    const result = await settle(message);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/synced model "gpt-9" isn't offered/);
    expect(kit.replies[0]).toMatchObject({ options: { notifyOwner: true } });
  });

  it("starts a new session when instructions change", async () => {
    const { runtime, claude } = setup();
    const first = mention("one");
    await runtime.run(first.delivery);
    await settle(first);
    const second = mention("two", { config: { instructions: "New role" } });
    await runtime.run(second.delivery);
    await settle(second);
    expect(claude.state.sessions.size).toBe(2);
  });
});

describe("mid-turn messages and Stop", () => {
  it("steers a message into the running turn and supersedes the earlier one", async () => {
    const { runtime, claude, script } = setup();
    const { prompt, turns } = claude.hanging();
    script.prompt = prompt;
    const first = mention("count", { root: "t" });
    await runtime.run(first.delivery);
    await tick(20);
    const second = mention("and banana", { root: "t" });
    await runtime.run(second.delivery);
    await tick(20);
    const session = claude.state.sessions.get("s1");
    expect(session.steered?.[0]).toMatch(/<new-message-arrived-while-you-were-working>\nand banana/);
    expect(first.seen.superseded).toBe(1);
    expect(second.seen.acknowledged).toBe(1);
    turns[0].finish();
    expect(await first.done()).toEqual({ ok: true });
    expect(await second.done()).toEqual({ ok: true });
    expect(session.prompts).toHaveLength(1);
  });

  it("queues a message that picks another model", async () => {
    const { runtime, claude, script } = setup();
    const { prompt, turns } = claude.hanging();
    script.prompt = prompt;
    const first = mention("one", { root: "t" });
    await runtime.run(first.delivery);
    await tick(20);
    const second = mention("two", { root: "t", model: "opus" });
    await runtime.run(second.delivery);
    await tick(20);
    expect(claude.state.sessions.get("s1").steered).toBeUndefined();
    turns[0].finish();
    await first.done();
    await tick(20);
    turns[1].finish();
    expect(await second.done()).toEqual({ ok: true });
  });

  it("stops the running turn", async () => {
    const { runtime, claude, script } = setup();
    script.prompt = claude.hanging().prompt;
    const message = mention("long");
    await runtime.run(message.delivery);
    await tick(20);
    await message.delivery.stop();
    expect(await message.done()).toEqual({ ok: true, stopped: true });
  });

  it("stops a turn while its session is still starting", async () => {
    let release;
    const script = { initialize: () => new Promise((resolve) => (release = resolve)) };
    const { runtime, claude } = setup({ script });
    const message = mention("hello");
    await runtime.run(message.delivery);
    await tick(10);
    await message.delivery.stop();
    release({ protocolVersion: 1, agentCapabilities: { sessionCapabilities: { resume: {}, close: {} } } });
    expect(await message.done()).toEqual({ ok: true, stopped: true });
    expect([...claude.state.sessions.values()].every((session) => !session.prompts)).toBe(true);
  });

  it("drops a queued message on Stop without running it", async () => {
    const { runtime, claude, script } = setup();
    const { prompt, turns } = claude.hanging();
    script.prompt = prompt;
    const first = mention("one", { root: "t" });
    await runtime.run(first.delivery);
    await tick(20);
    const queued = mention("two", { root: "t", model: "opus" });
    await runtime.run(queued.delivery);
    await queued.delivery.stop();
    expect(await queued.done()).toEqual({ ok: true, stopped: true });
    turns[0].finish();
    await first.done();
    expect(claude.state.sessions.get("s1").prompts).toHaveLength(1);
  });
});

describe("failures", () => {
  it("reports a failed turn to the owner and keeps the session", async () => {
    const script = {
      prompt: () => {
        throw new Error("rate limited");
      },
    };
    const { runtime, kit, claude } = setup({ script });
    const message = mention("x");
    await runtime.run(message.delivery);
    const result = await settle(message);
    expect(result).toEqual({ ok: false, error: "rate limited" });
    expect(kit.replies[0].text).toBe("Claude (ACP) could not finish: rate limited");
    expect(claude.state.sessions.size).toBe(1);
  });

  it("explains a missing adapter", async () => {
    const { runtime, host, kit } = setup();
    host.spawn = async () => {
      throw new Error("program not found");
    };
    const message = mention("x");
    await runtime.run(message.delivery);
    const result = await settle(message);
    expect(result.error).toMatch(/needs its adapter on this computer.*install-adapter\.sh \| sh/);
    expect(kit.replies).toHaveLength(1);
  });

  it("recovers a turn whose process died before Claude began, by resuming", async () => {
    let crash = true;
    const script = {
      prompt: (params, { state }) => {
        if (crash) {
          crash = false;
          state.processes.at(-1).crash(1);
          return new Promise(() => {});
        }
        return { stopReason: "end_turn" };
      },
    };
    const { runtime, claude } = setup({ script });
    const first = mention("one");
    await runtime.run(first.delivery);
    await settle(first);
    const second = mention("two");
    await runtime.run(second.delivery);
    expect(await settle(second)).toEqual({ ok: true });
    expect(claude.state.processes).toHaveLength(2);
    expect(claude.state.calls.some((call) => call.method === "session/resume")).toBe(true);
  });

  it("reopens with a fresh MCP server once Buzz stopped the old one", async () => {
    const { runtime, host } = setup();
    const first = mention("one");
    await runtime.run(first.delivery);
    await settle(first);
    host.servers[0].stopByHost();
    await tick();
    const second = mention("two");
    await runtime.run(second.delivery);
    await settle(second);
    expect(host.servers).toHaveLength(2);
    expect(host.servers[1].open).toBe(true);
  });

  it("starts a new session when the saved one can't be resumed", async () => {
    const storage = fakeStorage();
    storage.data.set(`${TYPE}/agent-1`, JSON.stringify({ v: 1, conversations: { c1: { sessionId: "gone", at: 1 } } }));
    const { runtime, claude } = setup({ storage });
    const message = mention("x");
    await runtime.run(message.delivery);
    expect(await settle(message)).toEqual({ ok: true });
    expect(claude.state.sessions.has("s1")).toBe(true);
  });

  it("stops quietly, without a failure reply, when the agent is removed mid-turn", async () => {
    const { runtime, claude, script, agents, kit } = setup();
    script.prompt = claude.hanging().prompt;
    const message = mention("long");
    await runtime.run(message.delivery);
    await tick(20);
    agents.running.length = 0;
    runtime.sync();
    expect(await message.done()).toEqual({ ok: true, stopped: true });
    await tick();
    expect(kit.replies).toHaveLength(0);
    expect(claude.state.processes[0].killed).toBe(true);
  });
});

describe("session controls", () => {
  it("New session forgets the session in both records", async () => {
    const { runtime, storage } = setup();
    const message = mention("x", { root: "t" });
    await runtime.run(message.delivery);
    await settle(message);
    const agent = { key: "agent-1", config: message.delivery.config };
    await runtime.control(agent, { channelId: "c1", root: "t" }, "new");
    await runtime.records.flush();
    expect(JSON.parse(storage.data.get(`${TYPE}/agent-1`)).conversations["c1/t"]).toBeUndefined();
    expect(storage.data.get(`${CLAUDE_SESSIONS}:agent-1`)).toBeUndefined();
    const again = mention("y", { root: "t" });
    await runtime.run(again.delivery);
    await settle(again);
    expect(runtime.agents.get("agent-1").records["c1/t"].sessionId).toBe("s2");
  });

  it("reports state and refuses to compact while busy", async () => {
    const { runtime, claude, script } = setup();
    const { prompt, turns } = claude.hanging();
    script.prompt = prompt;
    const message = mention("x", { root: "t" });
    await runtime.run(message.delivery);
    await tick(20);
    const agent = { key: "agent-1", config: message.delivery.config };
    const place = { channelId: "c1", root: "t" };
    expect(runtime.sessionState(agent, place)).toBe("active");
    await expect(runtime.control(agent, place, "compact")).rejects.toThrow(/Wait for the active turn/);
    turns[0].finish();
    await message.done();
    await tick();
    expect(runtime.sessionState(agent, place)).toBe("idle");
    expect(runtime.sessionState(agent, { channelId: "c1", root: "other" })).toBe("idle");
  });
});

describe("resources", () => {
  it("closes an idle session and its MCP server, then resumes it", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { runtime, host, claude } = setup();
    const message = mention("x", { root: "t" });
    await runtime.run(message.delivery);
    await vi.advanceTimersByTimeAsync(50);
    await message.done();
    await vi.advanceTimersByTimeAsync(15 * 60_000 + 10);
    expect(host.servers[0].open).toBe(false);
    expect(claude.state.processes[0].killed).toBe(true);
    const again = mention("y", { root: "t" });
    await runtime.run(again.delivery);
    await vi.advanceTimersByTimeAsync(50);
    expect(await again.done()).toEqual({ ok: true });
    expect(claude.state.calls.some((call) => call.method === "session/resume")).toBe(true);
  });

  it(`keeps at most ${MAX_LIVE_SESSIONS} sessions open, closing the least recently used`, async () => {
    const { runtime, host } = setup();
    for (let index = 0; index <= MAX_LIVE_SESSIONS; index += 1) {
      const message = mention(`m${index}`, { root: `t${index}` });
      await runtime.run(message.delivery);
      await settle(message);
    }
    expect(runtime.live.size).toBe(MAX_LIVE_SESSIONS);
    expect(host.servers[0].open).toBe(false);
    expect(host.servers.filter((server) => server.open)).toHaveLength(MAX_LIVE_SESSIONS);
  });
});

describe("standalone turns", () => {
  it("runs a timer in a one-off session and closes it", async () => {
    const { runtime, claude, host } = setup();
    const { delivery } = mention("unused");
    const result = await runtime.runOnce({ delivery, key: "timer", signal: new AbortController().signal, prompt: async () => "tick" });
    expect(result).toEqual({ ok: true });
    expect(claude.state.sessions.get("s1").prompts[0]).toBe("<timer>tick</timer>");
    expect(claude.state.calls.some((call) => call.method === "session/close")).toBe(true);
    expect(host.servers[0].open).toBe(false);
  });

  it("doesn't run once its deadline passed while the prompt was read", async () => {
    const { runtime, claude } = setup();
    const { delivery } = mention("unused");
    const abort = new AbortController();
    const result = await runtime.runOnce({
      delivery,
      key: "timer",
      signal: abort.signal,
      prompt: async () => {
        abort.abort();
        return "late";
      },
    });
    expect(result.ok).toBe(false);
    expect(claude.state.sessions.get("s1").prompts).toBeUndefined();
  });
});

describe("views", () => {
  it("lists sessions stably until something changes", async () => {
    const { runtime } = setup();
    const message = mention("x", { root: "t" });
    await runtime.run(message.delivery);
    await settle(message);
    const list = runtime.sessionList("agent-1");
    expect(list).toBe(runtime.sessionList("agent-1"));
    expect(list[0]).toMatchObject({ channelId: "c1", root: "t", status: "Idle" });
  });

  it("offers models with the device default as current, without max effort", async () => {
    const { runtime } = setup();
    await runtime.defaults.save({ model: "sonnet", effort: "" });
    const models = await runtime.models({ config: {} });
    expect(models.current).toBe("sonnet");
    expect(models.models.find((model) => model.id === "opus").efforts.map((e) => e.id)).toEqual(["low", "high"]);
  });

  it("reports readiness from Claude's sign-in", async () => {
    const script = { "auth/status": () => ({ state: "unauthenticated", accounts: [] }) };
    const { runtime } = setup({ script });
    await runtime.catalog.check();
    expect(runtime.catalog.snapshot()).toMatchObject({ readiness: "attention", attentionLabel: "Sign in to Claude" });
  });
});

describe("second review", () => {
  it("runs two standalone turns at once without one stopping the other", async () => {
    const script = { prompt: async () => (await tick(15), { stopReason: "end_turn" }) };
    const { runtime } = setup({ script });
    const { delivery } = mention("unused");
    const turn = (key) => runtime.runOnce({ delivery, key, signal: new AbortController().signal, prompt: async () => key });
    const [first, second] = await Promise.all([turn("a"), turn("b")]);
    expect(first).toEqual({ ok: true });
    expect(second).toEqual({ ok: true });
  });

  it("reports a failure to open after an idle close, instead of stopping quietly", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let refuse = false;
    const script = {
      "session/resume": () => {
        if (refuse) throw Object.assign(new Error("Workspace is not trusted"), { code: -32000 });
        return undefined;
      },
    };
    const { runtime, kit } = setup({ script });
    const first = mention("one", { root: "t" });
    await runtime.run(first.delivery);
    await vi.advanceTimersByTimeAsync(50);
    await vi.advanceTimersByTimeAsync(15 * 60_000 + 10);
    refuse = true;
    const second = mention("two", { root: "t" });
    await runtime.run(second.delivery);
    await vi.advanceTimersByTimeAsync(50);
    expect(await second.done()).toEqual({ ok: false, error: "Workspace is not trusted" });
    expect(kit.replies.at(-1).text).toMatch(/could not finish: Workspace is not trusted/);
  });

  it("keeps the saved session when resuming fails for another reason than its loss", async () => {
    const storage = fakeStorage();
    storage.data.set(`${TYPE}/agent-1`, JSON.stringify({ v: 1, conversations: { c1: { sessionId: "kept", at: 1 } } }));
    const script = { "session/resume": () => Promise.reject(Object.assign(new Error("timed out"), { code: -32603 })) };
    const { runtime } = setup({ script, storage });
    const message = mention("x", { config: { scope: "channel" } });
    await runtime.run(message.delivery);
    expect(await settle(message)).toEqual({ ok: false, error: "timed out" });
    await runtime.records.flush();
    expect(JSON.parse(storage.data.get(`${TYPE}/agent-1`)).conversations.c1.sessionId).toBe("kept");
  });

  it("closes the MCP server of a session that failed to open", async () => {
    const script = { "session/new": () => Promise.reject(new Error("refused")) };
    const { runtime, host } = setup({ script });
    const message = mention("x", { root: "t" });
    await runtime.run(message.delivery);
    await settle(message);
    expect(host.servers.length).toBeGreaterThan(0);
    expect(host.servers.every((server) => !server.open)).toBe(true);
    expect(runtime.live.size).toBe(0);
  });

  it("starts a new session cleanly while a turn is still opening", async () => {
    let release;
    const script = { "session/new": (params, { state }) => (release ? undefined : new Promise((resolve) => (release = () => resolve(undefined)))) };
    const { runtime, claude } = setup({ script });
    const message = mention("x", { root: "t" });
    await runtime.run(message.delivery);
    await tick(20);
    const agent = { key: "agent-1", config: message.delivery.config };
    const resetting = runtime.control(agent, { channelId: "c1", root: "t" }, "new");
    await tick(5);
    script["session/new"] = undefined;
    release();
    await resetting;
    expect(await message.done()).toEqual({ ok: true, stopped: true });
    const again = mention("y", { root: "t" });
    await runtime.run(again.delivery);
    expect(await settle(again)).toEqual({ ok: true });
    void claude;
  });

  it("still stops a turn after Buzz stopped its MCP server", async () => {
    const { runtime, claude, script, host } = setup();
    script.prompt = claude.hanging().prompt;
    const message = mention("long");
    await runtime.run(message.delivery);
    await tick(20);
    host.servers[0].stopByHost();
    await tick();
    await message.delivery.stop();
    expect(await message.done()).toEqual({ ok: true, stopped: true });
  });
});
