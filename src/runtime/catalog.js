// What Claude offers on this computer and whether it is signed in: the models
// with their thinking levels, the account, and the readiness Buzz shows in
// Settings → Agent setup. Read with a short-lived adapter process that opens
// one session and runs no turn.
import { AcpConnection } from "../acp/connection.js";
import { choicesOf, errorText, optionById } from "../acp/protocol.js";
import { CLOSE_TIMEOUT_MS, START_TIMEOUT_MS, TITLE } from "../constants.js";
import { DEFAULTS } from "../config.js";

const CHECKING = Object.freeze({ readiness: "checking", models: [], loading: true });
/** Buzz's Claude offers every level but `max`, which Claude reserves for
 * occasional use. */
const OFFERED = (level) => level.value !== "default" && level.value !== "max";

export class Catalog {
  constructor(host, notify) {
    this.host = host;
    this.notify = notify;
    /** Replaced, never changed, so it can be a snapshot. */
    this.state = CHECKING;
    this.reading = undefined;
    this.started = false;
  }

  snapshot = () => this.state;

  /** Reads the catalog the first time anyone asks for it. */
  ensure() {
    if (!this.started) void this.check();
    return this.reading ?? Promise.resolve(this.state);
  }

  /** Reads it again; one read runs at a time. */
  check() {
    this.started = true;
    if (this.reading) return this.reading;
    if (!this.state.loading) {
      this.state = Object.freeze({ ...this.state, readiness: "checking", loading: true });
      this.notify();
    }
    this.reading = this.read()
      .then(
        (found) => found,
        (error) => ({
          readiness: "attention",
          attentionLabel: `Set up ${TITLE}`,
          attentionDescription: errorText(error),
          error: errorText(error),
          models: [],
        }),
      )
      .then((state) => {
        this.state = Object.freeze({ ...state, loading: false });
        this.reading = undefined;
        this.notify();
        return this.state;
      });
    return this.reading;
  }

  /** The models, waiting for a read only when there are none yet. */
  async models() {
    const state = this.state.models.length ? this.state : await this.ensure();
    if (!state.models.length) throw new Error(state.error ?? `${TITLE} offered no models`);
    return state.models;
  }

  async read() {
    const cwd = await this.host.resolveDirectory(DEFAULTS.workspace);
    const connection = await AcpConnection.start(this.host, { cwd });
    try {
      const auth = await this.account(connection);
      const created = await connection.request("session/new", { cwd, mcpServers: [] }, START_TIMEOUT_MS);
      const models = await this.modelsOf(connection, created);
      if (connection.sessionCapabilities.close)
        await connection.request("session/close", { sessionId: created.sessionId }, CLOSE_TIMEOUT_MS).catch(() => {});
      const signedOut = auth.state === "unauthenticated";
      return signedOut
        ? {
            readiness: "attention",
            attentionLabel: "Sign in to Claude",
            attentionDescription: "Run claude auth login in a terminal, then check again.",
            models,
          }
        : { readiness: "ready", account: auth.account, models };
    } finally {
      void connection.stop();
    }
  }

  /** The sign-in state, from `auth/status` where the adapter offers it. */
  async account(connection) {
    const status = connection.capabilities.auth?.status
      ? await connection.request("auth/status", {}, START_TIMEOUT_MS).catch(() => undefined)
      : connection.auth;
    const accounts = Array.isArray(status?.accounts) ? status.accounts : [];
    const account = (accounts.find((item) => item?.active) ?? accounts[0])?.label;
    return { state: typeof status?.state === "string" ? status.state : "unknown", account };
  }

  /** Each model with the thinking levels it takes, read by switching the
   * session to it. */
  async modelsOf(connection, created) {
    const { sessionId } = created;
    let options = created.configOptions ?? [];
    const models = [];
    for (const choice of choicesOf(optionById(options, "model")?.options)) {
      if (optionById(options, "model")?.currentValue !== choice.value) {
        const changed = await connection
          .request("session/set_config_option", { sessionId, configId: "model", value: choice.value }, START_TIMEOUT_MS)
          .catch(() => undefined);
        if (Array.isArray(changed?.configOptions)) options = changed.configOptions;
      }
      const effort = optionById(options, "effort");
      models.push({
        id: choice.value,
        label: choice.name,
        description: choice.description,
        efforts: choicesOf(effort?.options)
          .filter(OFFERED)
          .map((level) => ({ id: level.value, label: level.name })),
        ...(effort?.currentValue && effort.currentValue !== "default" ? { effort: effort.currentValue } : {}),
      });
    }
    return models;
  }
}
