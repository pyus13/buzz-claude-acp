// This device's default model and thinking for agents that leave theirs
// blank, as Buzz's Claude keeps its provider defaults (Settings → Agent setup).

const VERSION = 1;
const NONE = Object.freeze({ model: "", effort: "" });

export class DeviceDefaults {
  constructor(store, key, notify) {
    this.store = store;
    this.key = key;
    this.notify = notify;
    /** Replaced, never changed, so it can be a snapshot. */
    this.current = NONE;
    this.loaded = this.load();
  }

  async load() {
    try {
      const value = JSON.parse((await this.store.read(this.key)) ?? "null");
      if (value?.version === VERSION && typeof value.model === "string") {
        this.current = Object.freeze({ model: value.model, effort: typeof value.effort === "string" ? value.effort : "" });
        this.notify();
      }
    } catch {
      // Unreadable defaults are no defaults.
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
      effort: settings.effort || (!settings.model || settings.model === model ? effort : "") || "default",
    };
  }
}
