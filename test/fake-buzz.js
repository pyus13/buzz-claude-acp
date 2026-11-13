// A stand-in for the Buzz side of a turn: the agents service, its harness
// kit and its storage, recording what the plugin asked of them.
import { vi } from "vitest";

export function fakeStorage() {
  const data = new Map();
  return {
    data,
    read: async (key) => data.get(key) ?? null,
    get: (key) => data.get(key) ?? null,
    set: async (key, value) => {
      if (value === null) data.delete(key);
      else data.set(key, value);
    },
  };
}

export function fakeKit() {
  const replies = [];
  let prompts = 0;
  return {
    replies,
    conversation: vi.fn(async (delivery, scope) => {
      const event = delivery.trigger.event;
      if (!event) return undefined;
      const root = event.root ?? event.id;
      return scope === "thread" && !event.dm
        ? { key: `c1/${root}`, channel: "c1", root, topLevel: false, where: "#general" }
        : { key: "c1", channel: "c1", topLevel: true, where: event.dm ? "DM" : "#general" };
    }),
    systemPrompt: vi.fn(async (delivery, { instructions }) => `system${instructions ? `: ${instructions}` : ""}`),
    turnPrompt: vi.fn(async (delivery, conversation, options) => {
      const seen = options?.cursor ? JSON.parse(options.cursor).seen : 0;
      prompts += 1;
      return {
        text: `context\n<buzz-event>\n${delivery.trigger.event.content}\n</buzz-event>`,
        cursor: JSON.stringify({ seen: seen + 1 }),
        restore: vi.fn(),
        n: prompts,
      };
    }),
    standalonePrompt: (agent, text) => `<timer>${text}</timer>`,
    tools: vi.fn(() => async (message) => ({ jsonrpc: "2.0", id: message.id, result: {} })),
    reply: vi.fn(async (agent, conversation, text, options) => {
      replies.push({ key: conversation.key, text, options });
    }),
  };
}

export function fakeAgents({ kit = fakeKit(), storage = fakeStorage(), running = ["agent-1"] } = {}) {
  const listeners = new Set();
  return {
    harness: kit,
    storage,
    running,
    register: vi.fn(),
    types: () => [],
    snapshot: () => ({ running: running.map((key) => ({ key, type: "local.claude-acp/claude-acp" })) }),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit: () => listeners.forEach((listener) => listener()),
  };
}

let events = 0;
/** A mention delivery, recording what the plugin reported back. */
export function mention(content, { key = "agent-1", root, dm, config = {}, synced, model } = {}) {
  const id = `e${++events}`;
  const seen = { steps: [], acknowledged: 0, superseded: 0, ignored: 0, named: [] };
  let working;
  const delivery = {
    trigger: { type: "mention", event: { id, content, root, dm } },
    agent: { key, pubkey: "a".repeat(64), relay: "wss://example.org", owner: "b".repeat(64), name: "Tester" },
    config: { model: "", effort: "", mode: "bypassPermissions", instructions: "", workspace: "~/.buzz", scope: "thread", ...config },
    ...(synced ? { synced } : {}),
    ...(model ? { model } : {}),
    signal: new AbortController().signal,
    workingUntil: (promise) => {
      working = promise;
    },
    step: (tool, target) => seen.steps.push(target ? `${tool}:${target}` : tool),
    acknowledged: () => (seen.acknowledged += 1),
    superseded: () => (seen.superseded += 1),
    ignored: () => (seen.ignored += 1),
    named: (title) => seen.named.push(title),
    interruptible: (stop) => {
      delivery.stop = stop;
    },
    current: () => true,
  };
  return { delivery, seen, done: () => working };
}
