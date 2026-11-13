// One agent on this device: its adapter process, its conversations and their
// saved sessions, and its standalone (watch and timer) turns.
import { AcpConnection } from "../acp/connection.js";
import { errorText, stepOf } from "../acp/protocol.js";
import { CLOSE_TIMEOUT_MS, START_TIMEOUT_MS, TITLE } from "../constants.js";
import { readConfig } from "../config.js";
import { applyOptions, Conversation, outcomeOf, sessionParams } from "./conversation.js";

const REMOVED = "This agent was removed";

export class AgentRuntime {
  constructor(runtime, key) {
    this.runtime = runtime;
    this.key = key;
    this.kit = runtime.kit;
    this.host = runtime.host;
    this.defaults = runtime.defaults;
    this.conversations = new Map();
    this.records = undefined;
    this.loaded = runtime.records.load(key).then((records) => {
      this.records = records;
      runtime.notify();
    });
    this.connection = undefined;
    this.connecting = undefined;
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
    // A DM or Solo chat is one conversation, whatever thread it is shown in.
    const whole = this.conversations.get(place.channelId);
    return whole?.whole ? whole : undefined;
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
      const connection = await AcpConnection.start(this.host, { cwd, agent: agentHandle });
      if (this.disposed) {
        void connection.stop();
        throw new Error(REMOVED);
      }
      connection.onClose((reason, stopped) => {
        if (this.connection === connection) this.connection = undefined;
        for (const conversation of this.conversations.values())
          if (conversation.connection === connection) conversation.lose();
        if (!stopped) console.warn(`claude-acp: ${reason}`);
        this.changed();
      });
      this.connection = connection;
      return connection;
    })().finally(() => {
      this.connecting = undefined;
    });
    return this.connecting;
  }

  workspace(settings) {
    return this.host.resolveDirectory(settings.workspace);
  }

  /** The conversation's Buzz tools, answered over MCP, for this turn. */
  tools(agentHandle, conversation, cwd) {
    const read = this.host.readFile && ((path) => this.host.readFile(path, { cwd }));
    return this.kit.tools(agentHandle, conversation, read ? { read } : undefined);
  }

  /** Stops the process once no conversation has a session open in it. */
  idle() {
    const open = [...this.conversations.values()].some((conversation) => conversation.live || conversation.busy);
    if (!open && !this.connecting) void this.connection?.stop();
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
    const keys = new Set([...Object.keys(this.records), ...this.conversations.keys()]);
    return [...keys]
      .map((key) => {
        const conversation = this.conversations.get(key);
        const record = conversation ? conversation.record : this.records[key];
        if (!record) return undefined;
        const [channelId, root] = key.split("/");
        return {
          channelId,
          ...(root ? { root } : {}),
          at: Math.max(record.at ?? 0, conversation?.used ?? 0),
          ...(conversation?.live || conversation?.busy ? { status: conversation.busy ? "Working" : "Idle" } : {}),
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.at - a.at);
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
    await this.kit
      .reply(item.delivery.agent, item.conversation, `${TITLE} could not finish: ${error}`, { notifyOwner: true })
      .catch((reason) => console.warn("claude-acp: could not report a failed turn", reason));
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
    try {
      connection = await this.connect(agentHandle, settings);
      const cwd = await this.workspace(settings);
      if (signal.aborted) return { ok: false, error: "The turn was stopped before it started" };
      mcp = await this.host.serveMcp(this.tools(agentHandle, undefined, cwd));
      const system = await this.kit.systemPrompt(delivery, { scope: settings.scope, cwd, instructions: settings.instructions });
      const created = await connection.request("session/new", sessionParams(cwd, mcp, system), START_TIMEOUT_MS);
      sessionId = created.sessionId;
      let last = "";
      unsubscribe = connection.onSession(sessionId, (update) => {
        const step = stepOf(update);
        const label = step && `${step.tool}\u0000${step.target ?? ""}`;
        if (!step || label === last) return;
        last = label;
        delivery.step?.(step.tool, step.target);
      });
      const synced = delivery.synced ?? {};
      const effective = this.defaults.effective(settings);
      await applyOptions(connection, sessionId, created.configOptions, [
        ["mode", settings.mode, "mode" in synced],
        ["model", effective.model, "model" in synced],
        ["effort", effective.effort, "effort" in synced],
      ]);
      const text = await prompt();
      if (text === undefined) return { ok: true };
      if (signal.aborted) return { ok: false, error: "The turn was stopped before it started" };
      const cancel = () => connection.notify("session/cancel", { sessionId });
      signal.addEventListener("abort", cancel, { once: true });
      try {
        const answer = await connection.request("session/prompt", {
          sessionId,
          prompt: [{ type: "text", text: this.kit.standalonePrompt(agentHandle, text) }],
        });
        const outcome = outcomeOf(answer?.stopReason);
        return outcome.stopped ? { ok: false, error: "The turn was stopped" } : { ok: outcome.ok, ...(outcome.error && { error: outcome.error }) };
      } finally {
        signal.removeEventListener("abort", cancel);
      }
    } catch (error) {
      return { ok: false, error: errorText(error) };
    } finally {
      unsubscribe?.();
      if (sessionId && connection && !connection.closed && connection.sessionCapabilities.close)
        void connection.request("session/close", { sessionId }, CLOSE_TIMEOUT_MS).catch(() => {});
      void mcp?.close().catch(() => {});
      this.idle();
    }
  }

  /** The agent was removed here, or the plugin is unloading. */
  dispose() {
    this.disposed = true;
    for (const conversation of this.conversations.values()) conversation.dispose();
    void this.connection?.stop();
    this.connection = undefined;
  }
}
