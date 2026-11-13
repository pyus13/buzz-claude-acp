import { describe, expect, it } from "vitest";
import {
  adopt,
  carry,
  DEFAULTS,
  describeMigration,
  readConfig,
  sessionShape,
  SYNCED_SCHEMA,
  withSyncedSettings,
} from "../src/config.js";

describe("readConfig", () => {
  it("fills every field from the defaults", () => {
    expect(readConfig(undefined)).toEqual(DEFAULTS);
    expect(readConfig("nonsense")).toEqual(DEFAULTS);
  });

  it("keeps valid values and replaces invalid ones", () => {
    expect(
      readConfig({ model: " sonnet ", effort: "high", mode: "auto", workspace: "  ", scope: "channel", instructions: "x" }),
    ).toEqual({ model: "sonnet", effort: "high", mode: "auto", instructions: "x", workspace: "~/.buzz", scope: "channel" });
    expect(readConfig({ mode: "yolo", scope: "everything", model: 3 })).toMatchObject({
      mode: "bypassPermissions",
      scope: "thread",
      model: "",
    });
  });
});

describe("synced settings", () => {
  it("lists only the settings that may sync", () => {
    expect(Object.keys(SYNCED_SCHEMA)).toEqual(["model", "effort", "scope", "mode"]);
    expect(SYNCED_SCHEMA.mode).toContain("bypassPermissions");
  });

  it("takes synced values and keeps this device's for the rest", () => {
    const local = { ...DEFAULTS, effort: "high", workspace: "~/w", instructions: "local" };
    expect(withSyncedSettings(local, {})).toEqual(local);
    expect(withSyncedSettings(local, { model: "opus", effort: "", workspace: "/elsewhere" })).toEqual({
      ...local,
      model: "opus",
      effort: "",
    });
  });
});

describe("sessionShape", () => {
  it("changes with instructions, workspace or scope, not model or mode", () => {
    const base = readConfig({});
    expect(sessionShape({ ...base, model: "opus", mode: "plan" })).toBe(sessionShape(base));
    expect(sessionShape({ ...base, instructions: "new" })).not.toBe(sessionShape(base));
    expect(sessionShape({ ...base, workspace: "~/w" })).not.toBe(sessionShape(base));
    expect(sessionShape({ ...base, scope: "channel" })).not.toBe(sessionShape(base));
  });
});

describe("changing harness", () => {
  it("carries instructions and a chosen workspace, and adopts them", () => {
    expect(carry({})).toEqual({});
    const carried = carry({ instructions: "Review PRs", workspace: "~/code" });
    expect(carried).toEqual({ instructions: "Review PRs", workspace: "~/code" });
    expect(adopt(carried, { ...DEFAULTS })).toEqual({ ...DEFAULTS, instructions: "Review PRs", workspace: "~/code" });
    expect(carry(adopt(carried, { ...DEFAULTS }))).toEqual(carried);
  });

  it("describes migrations with Buzz's Claude ids", () => {
    expect(describeMigration({ model: "opus", scope: "channel" })).toEqual([
      { id: "model", label: "Model", isOverride: true },
      { id: "thinking", label: "Thinking", isOverride: false },
      { id: "sessions", label: "Sessions", isOverride: true, unchangedKey: "channel" },
      { id: "permissions", label: "Permissions", isOverride: false },
    ]);
  });
});
