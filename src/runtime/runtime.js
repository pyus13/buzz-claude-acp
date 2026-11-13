// Every agent of this type that runs on this device, and what Buzz asks of
// them: turns, session controls, session lists and models.
import { MAX_LIVE_SESSIONS } from "../constants.js";
import { readConfig } from "../config.js";
import { AgentRuntime } from "./agent.js";
import { Catalog } from "./catalog.js";
import { DeviceDefaults } from "./defaults.js";
import { SessionRecords } from "./records.js";

export class Runtime {
  constructor({ agents, host, typeKey }) {
    this.agentsService = agents;
    this.kit = agents.harness;
    this.host = host;
    this.typeKey = typeKey;
    this.listeners = new Set();
    this.agents = new Map();
    /** Conversations with a Claude session open, least recently used first. */
    this.live = new Set();
    this.sessionLists = new Map();
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
    const conversation =
      owner.conversationAt(place, scope) ?? (await owner.conversation(owner.savedKeyAt(place, scope)));
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
      if (!idle) return; // Every open session is working; let this one open too.
      await idle.close();
      idle.agent.idle();
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
      models: models.map(({ id, label, efforts, effort }) => ({ id, label, efforts, ...(effort && { effort }) })),
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
      this.agentsService
        .snapshot()
        .running.filter((agent) => agent.type === this.typeKey)
        .map((agent) => agent.key),
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
}
