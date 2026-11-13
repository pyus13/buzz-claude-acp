// An agent's settings: how they are read, which of them sync, and which of
// them shape a session.
import { MODES } from "./constants.js";

export const DEFAULTS = Object.freeze({
  model: "",
  effort: "",
  mode: "bypassPermissions",
  instructions: "",
  workspace: "~/.buzz",
  scope: "thread",
});

const MODE_IDS = MODES.map(([id]) => id);

/** An agent's saved config with every field present and valid. */
export function readConfig(value) {
  const raw = value && typeof value === "object" ? value : {};
  const text = (key) => (typeof raw[key] === "string" ? raw[key] : DEFAULTS[key]);
  return {
    model: text("model").trim(),
    effort: text("effort").trim(),
    mode: MODE_IDS.includes(raw.mode) ? raw.mode : DEFAULTS.mode,
    instructions: text("instructions"),
    workspace: text("workspace").trim() || DEFAULTS.workspace,
    scope: raw.scope === "channel" ? "channel" : "thread",
  };
}

/** The settings that sync across devices (NIP-AP `buzz.agent.settings`), as
 * Buzz's Claude syncs them. Instructions have their own synced artifact; the
 * workspace is a path on this device. */
export const SYNCED_SCHEMA = Object.freeze({
  model: "string",
  effort: "string",
  scope: ["thread", "channel"],
  mode: MODE_IDS,
});

/** A config with its synced fields taken from `settings`. A field they leave
 * out keeps this device's value, so agents saved before this harness synced
 * its settings keep their choices until they are next saved. */
export function withSyncedSettings(config, settings) {
  const synced = Object.fromEntries(
    Object.keys(SYNCED_SCHEMA)
      .filter((name) => typeof settings?.[name] === "string")
      .map((name) => [name, settings[name]]),
  );
  return { ...config, ...synced };
}

/** What a Claude session is created from. When it changes, the conversation
 * starts a new session; model, thinking and permissions change in place. */
export const sessionShape = (settings) =>
  JSON.stringify([settings.instructions, settings.workspace, settings.scope]);

/** Instructions and workspace move with an agent that changes harness, as
 * between Buzz's own harnesses. */
export function carry(saved) {
  const { instructions, workspace } = readConfig(saved);
  return {
    ...(instructions.trim() && { instructions }),
    ...(workspace !== DEFAULTS.workspace && { workspace }),
  };
}

export const adopt = (carried, config) => ({
  ...config,
  instructions: carried.instructions ?? config.instructions,
  workspace: carried.workspace ?? config.workspace,
});

/** The rows a change of harness lists, with the same ids and keys as Buzz's
 * Claude so an unchanged choice is not listed. */
export function describeMigration(saved) {
  const { model, effort, scope, mode } = readConfig(saved);
  return [
    { id: "model", label: "Model", isOverride: Boolean(model) },
    { id: "thinking", label: "Thinking", isOverride: Boolean(effort) },
    { id: "sessions", label: "Sessions", isOverride: scope !== DEFAULTS.scope, unchangedKey: scope },
    { id: "permissions", label: "Permissions", isOverride: mode !== DEFAULTS.mode },
  ];
}
