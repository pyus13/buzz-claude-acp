// Each agent's saved sessions: which Claude session each conversation
// continues, and what it has been shown. Kept in two places:
// - this harness's own record, the source of truth;
// - Buzz's Claude record, so Buzz's Claude Activity tab and usage list these
//   sessions, and so an agent moving between the two harnesses carries on.
import { CLAUDE_SESSIONS, SAVED_CONVERSATIONS } from "../constants.js";

const VERSION = 1;

/** A saved session: `{ sessionId, cursor?, shape?, at }`. `cursor` is the
 * harness kit's opaque cursor; `shape` what the session was created from. */
const valid = (record) => typeof record?.sessionId === "string" && record.sessionId.length > 0;

/** The kit's cursor is `{ seen, threads? }`, the same marks Buzz's Claude
 * saves. Only the mirror reads into it; anything else is "seen nothing". */
function marksOf(cursor) {
  try {
    const value = cursor ? JSON.parse(cursor) : {};
    return {
      seen: typeof value?.seen === "number" ? value.seen : 0,
      ...(value?.threads && typeof value.threads === "object" ? { threads: value.threads } : {}),
    };
  } catch {
    return { seen: 0 };
  }
}
const cursorOf = ({ seen, threads }) =>
  typeof seen === "number" ? JSON.stringify({ seen, ...(threads ? { threads } : {}) }) : undefined;

const newestFirst = (records) =>
  Object.entries(records)
    .sort(([, a], [, b]) => (b.at ?? 0) - (a.at ?? 0))
    .slice(0, SAVED_CONVERSATIONS);

export class SessionRecords {
  constructor(store, typeKey) {
    this.store = store;
    this.typeKey = typeKey;
    /** Per agent: the save running now, and whether another is owed. */
    this.writes = new Map();
  }

  ownKey(agentKey) {
    return `${this.typeKey}/${agentKey}`;
  }

  claudeKey(agentKey) {
    return `${CLAUDE_SESSIONS}:${agentKey}`;
  }

  async read(key) {
    try {
      const value = JSON.parse((await this.store.read(key)) ?? "null");
      return value && typeof value === "object" ? value : undefined;
    } catch {
      return undefined; // Unreadable: start over rather than fail the agent.
    }
  }

  /** The agent's saved sessions by conversation key. Sessions Buzz's Claude
   * saved for it fill in conversations this harness has none for. */
  async load(agentKey) {
    const own = await this.read(this.ownKey(agentKey));
    const records = {};
    if (own?.v === VERSION && own.conversations && typeof own.conversations === "object")
      for (const [key, record] of Object.entries(own.conversations)) if (valid(record)) records[key] = record;
    const claude = (await this.read(this.claudeKey(agentKey))) ?? {};
    for (const [key, saved] of Object.entries(claude)) {
      if (records[key] || typeof saved?.id !== "string" || !saved.id) continue;
      const cursor = cursorOf(saved);
      records[key] = { sessionId: saved.id, ...(cursor ? { cursor } : {}), at: Number(saved.at) || 0 };
    }
    return records;
  }

  /** Saves `records`, and drops `forgotten` conversation keys from Buzz's
   * Claude record too. Saves for one agent run one at a time; one asked for
   * while another runs is made once after it, with the latest records. */
  save(agentKey, records, forgotten = []) {
    let write = this.writes.get(agentKey);
    if (!write) {
      write = { running: undefined, owed: undefined };
      this.writes.set(agentKey, write);
    }
    const owed = write.owed ?? { forgotten: new Set() };
    owed.records = records;
    for (const key of forgotten) owed.forgotten.add(key);
    write.owed = owed;
    if (!write.running)
      write.running = (async () => {
        while (write.owed) {
          const next = write.owed;
          write.owed = undefined;
          await this.write(agentKey, next.records, next.forgotten).catch((error) =>
            console.warn("claude-acp: could not save sessions", error),
          );
        }
        write.running = undefined;
      })();
    return write.running;
  }

  async write(agentKey, records, forgotten) {
    const kept = newestFirst(Object.fromEntries(Object.entries(records).filter(([, record]) => valid(record))));
    await this.store.set(this.ownKey(agentKey), JSON.stringify({ v: VERSION, conversations: Object.fromEntries(kept) }));
    const claude = (await this.read(this.claudeKey(agentKey))) ?? {};
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
}
