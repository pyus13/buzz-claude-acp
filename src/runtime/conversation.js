// One Buzz conversation (a thread, or a whole channel) and the Claude session
// that continues it: its turns run one at a time, a message that arrives
// mid-turn is steered into it, and an idle session closes until it is needed.
import { choicesOf, errorText, optionById, steerPrompt, stepOf } from "../acp/protocol.js";
import { CLOSE_TIMEOUT_MS, IDLE_MS, START_TIMEOUT_MS, TITLE } from "../constants.js";
import { sessionShape } from "../config.js";

export const STOPPED = Object.freeze({ ok: true, stopped: true });
/** How long a reset waits for a cancelled turn to end before closing. */
const SETTLE_MS = 5_000;

/** The `session/new`, `session/resume` parameters for a session in `cwd`
 * whose Buzz tools `mcp` serves, with Buzz's system prompt after Claude
 * Code's own. */
export function sessionParams(cwd, mcp, system) {
  return {
    cwd,
    mcpServers: [{ type: "http", name: "buzz", url: mcp.url, headers: mcp.headers.map((header) => ({ ...header })) }],
    _meta: { claudeCode: { options: { systemPrompt: { type: "preset", preset: "claude_code", append: system } } } },
  };
}

/** Sets a session's options where they differ from `wanted`
 * (`[configId, value, synced]`). An option the session lacks, or a value it
 * does not offer, is left alone, except a synced one, which stops the turn
 * (NIP-AP: never replace a synced setting with a default). Returns the
 * session's options after. */
export async function applyOptions(connection, sessionId, configOptions, wanted) {
  let options = configOptions;
  for (const [configId, value, synced] of wanted) {
    const option = optionById(options, configId);
    if (!option || !value || option.currentValue === value) continue;
    if (!choicesOf(option.options).some((choice) => choice.value === value)) {
      if (synced)
        throw new Error(
          `This agent's synced ${configId === "effort" ? "thinking" : configId} "${value}" isn't offered by ${TITLE}. Change it in Settings.`,
        );
      continue;
    }
    const changed = await connection.request(
      "session/set_config_option",
      { sessionId, configId, value },
      START_TIMEOUT_MS,
    );
    options = Array.isArray(changed?.configOptions)
      ? changed.configOptions
      : options.map((item) => (item.id === configId ? { ...item, currentValue: value } : item));
  }
  return options;
}

/** What a turn's `stopReason` means for Buzz. */
export function outcomeOf(stopReason) {
  if (stopReason === "cancelled") return STOPPED;
  if (stopReason === "refusal") return { ok: false, error: "Claude declined to continue this turn." };
  return { ok: true };
}

/** Whether a failed prompt left the session unusable, so the next turn should
 * open it again (the adapter rebuilds it from its transcript). */
const sessionLost = (error, connection) =>
  Boolean(connection?.closed) || /session has ended|exited unexpectedly|not found|unknown session/i.test(errorText(error));

class Turn {
  constructor(delivery, { compacting = false } = {}) {
    this.receipts = delivery ? [delivery] : [];
    this.compacting = compacting;
    /** Whether the session reported anything, so the turn began in Claude. */
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
}

export class Conversation {
  constructor(agent, key, record) {
    this.agent = agent;
    this.key = key;
    /** `{ sessionId, cursor?, shape?, whole?, at }`, or undefined: no session. */
    this.record = record;
    this.connection = undefined;
    this.live = false;
    this.options = undefined;
    this.mcp = undefined;
    this.handler = undefined;
    this.unsubscribe = undefined;
    /** The turn Claude is running, or a compaction. */
    this.turn = undefined;
    /** The queued item being prepared to run, until its turn starts. */
    this.starting = undefined;
    this.queue = [];
    this.pumping = false;
    this.steering = Promise.resolve();
    this.idleTimer = undefined;
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
    // A message that picks another model or level runs as its own turn.
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
      answer = await this.connection
        .request(
          "_session/steering",
          {
            sessionId: this.record.sessionId,
            prompt: [{ type: "text", text: steerPrompt(prompt.text) }],
            // Never start a turn of its own: the plugin would not track it.
            _meta: { steering: { idleBehavior: "promptRequired" } },
          },
          START_TIMEOUT_MS,
        )
        .catch(() => undefined);
    // Taken into the turn, even one that has just ended, it is answered there.
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
        const result = await this.runTurn(item).catch((error) =>
          this.agent.disposed || this.connection?.stopped ? STOPPED : { ok: false, error: errorText(error) },
        );
        this.starting = undefined;
        item.resolve(result);
        if (!result.ok && result.error) await this.agent.report(item, result.error);
      }
    } finally {
      this.pumping = false;
      this.starting = undefined;
      this.scheduleIdle();
      this.agent.changed();
    }
  }

  async runTurn(item, retried = false) {
    const { delivery, conversation, settings } = item;
    await this.open(delivery, conversation, settings);
    if (item.stopped) return STOPPED;
    const synced = delivery.synced ?? {};
    const effective = this.agent.defaults.effective(settings);
    this.options = await applyOptions(this.connection, this.record.sessionId, this.options, [
      ["mode", settings.mode, "mode" in synced],
      ["model", delivery.model || effective.model, !delivery.model && "model" in synced],
      ["effort", delivery.effort || (delivery.model ? "default" : effective.effort), !delivery.effort && "effort" in synced],
    ]);
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
    this.starting = undefined;
    this.agent.changed();
    let result;
    try {
      const sent = connection.request("session/prompt", {
        sessionId: this.record.sessionId,
        prompt: [{ type: "text", text: prompt.text }],
      });
      // Saved once sent: the session has been shown it.
      this.record.cursor = prompt.cursor;
      this.save();
      delivery.acknowledged?.();
      result = outcomeOf((await sent)?.stopReason);
    } catch (error) {
      if (!turn.updated) {
        // Claude never began: the next prompt shows the same messages.
        prompt.restore();
        this.record.cursor = before;
      }
      if (sessionLost(error, connection)) this.lose();
      if (this.agent.disposed || connection.stopped) result = STOPPED;
      else if (!turn.updated && !retried && sessionLost(error, connection)) {
        this.turn = undefined;
        turn.finish({ ok: true });
        return this.runTurn(item, true);
      } else result = { ok: false, error: errorText(error) };
    } finally {
      if (this.turn === turn) this.turn = undefined;
      if (this.record) this.record.at = Date.now();
      this.save();
      this.agent.changed();
    }
    turn.finish(result);
    return result;
  }

  cursorOption() {
    return this.record?.cursor ? { cursor: this.record.cursor } : undefined;
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
    if (this.live && this.connection === connection && this.record?.shape === shape) return;
    await this.close();
    // Other instructions or another workspace shape a new session. One
    // carried over from Buzz's Claude has no shape yet and is kept.
    if (this.record?.shape !== undefined && this.record.shape !== shape) this.forget();
    await this.agent.makeRoom(this);
    const mcp = await this.agent.host.serveMcp((message) => this.answerMcp(message));
    this.mcp = mcp;
    // Buzz stops a server whose token another program used: reopen next turn.
    void mcp.closed?.then(() => {
      if (this.mcp === mcp) this.lose();
    });
    const system = await this.agent.kit.systemPrompt(delivery, {
      scope: settings.scope,
      cwd,
      instructions: settings.instructions,
    });
    const params = sessionParams(cwd, mcp, system);
    let opened;
    if (this.record?.sessionId && connection.sessionCapabilities.resume)
      opened = await connection
        .request("session/resume", { sessionId: this.record.sessionId, ...params }, START_TIMEOUT_MS)
        .catch((error) => {
          console.warn("claude-acp: could not resume the session; starting a new one", error);
          return undefined;
        });
    if (!opened) {
      if (this.record) this.forget();
      opened = await connection.request("session/new", params, START_TIMEOUT_MS);
      // A new session has been shown nothing yet.
      this.record = { sessionId: opened.sessionId, at: Date.now() };
    }
    this.record.shape = shape;
    this.record.whole = this.whole;
    this.connection = connection;
    this.options = opened.configOptions;
    this.unsubscribe = connection.onSession(this.record.sessionId, (update) => this.update(update));
    this.live = true;
    this.agent.opened(this);
    this.save();
  }

  answerMcp(message) {
    if (this.handler) return this.handler(message);
    return Promise.resolve(
      message?.id === undefined
        ? undefined
        : { jsonrpc: "2.0", id: message.id, error: { code: -32603, message: "No Buzz turn is running" } },
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
    const label = `${step.tool}\u0000${step.target ?? ""}`;
    if (label === turn.step) return;
    turn.step = label;
    turn.latest?.step?.(step.tool, step.target);
  }

  /** The session can't be used as it is: the next turn opens it again. */
  lose() {
    this.live = false;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    const mcp = this.mcp;
    this.mcp = undefined;
    void mcp?.close().catch(() => {});
    this.agent.closed(this);
  }

  /** Closes the session and its MCP server, keeping the record so the next
   * turn resumes it. */
  async close() {
    clearTimeout(this.idleTimer);
    const { connection, live } = this;
    const sessionId = this.record?.sessionId;
    this.lose();
    if (live && sessionId && connection && !connection.closed && connection.sessionCapabilities.close)
      await connection.request("session/close", { sessionId }, CLOSE_TIMEOUT_MS).catch(() => {});
  }

  /** Forgets the session: the next turn starts a new one. */
  forget() {
    this.record = undefined;
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
    if (this.turn && this.live) this.connection.notify("session/cancel", { sessionId: this.record.sessionId });
  }

  /** Stops everything: the running turn and every queued message. */
  interrupt() {
    for (const item of this.queue.splice(0)) item.resolve(STOPPED);
    this.stop();
    this.agent.changed();
  }

  /** Ends the session for good; the next message starts a new one. */
  async reset() {
    const turn = this.turn;
    this.interrupt();
    if (turn) await Promise.race([turn.done, new Promise((resolve) => setTimeout(resolve, SETTLE_MS))]);
    await this.close();
    this.forget();
    this.agent.changed();
  }

  /** Compacts the session's history to free context. */
  async compact() {
    if (this.busy) throw new Error("Wait for the active turn to finish first.");
    if (!this.record) throw new Error("This conversation has no Claude session yet.");
    if (!this.live)
      throw new Error("This conversation's Claude session is closed. It opens again with the next message.");
    const turn = new Turn(undefined, { compacting: true });
    this.turn = turn;
    this.agent.changed();
    try {
      const answer = await this.connection.request("session/prompt", {
        sessionId: this.record.sessionId,
        prompt: [{ type: "text", text: "/compact" }],
      });
      turn.finish(outcomeOf(answer?.stopReason));
    } catch (error) {
      turn.finish({ ok: false, error: errorText(error) });
      throw error;
    } finally {
      if (this.turn === turn) this.turn = undefined;
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
}
