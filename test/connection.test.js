import { describe, expect, it, vi } from "vitest";
import { AcpConnection } from "../src/acp/connection.js";
import { fakeAdapter, fakeHost, NO_REPLY } from "./fake-host.js";

const initialized = { protocolVersion: 1, agentCapabilities: { sessionCapabilities: { close: {} } }, _meta: { steering: { supported: true } } };

describe("AcpConnection", () => {
  it("starts with a scrubbed environment and completes the handshake", async () => {
    const adapter = fakeAdapter({ initialize: () => initialized });
    const host = fakeHost(adapter);
    const connection = await AcpConnection.start(host, { cwd: "/w" });
    expect(host.spawned[0].id).toBe("claude");
    expect(host.spawned[0].options.env.ANTHROPIC_API_KEY).toBeNull();
    expect(host.spawned[0].options.env.npm_config_update_notifier).toBe("false");
    expect(host.spawned[0].options.agentCredential).toBeUndefined();
    expect(connection.canSteer).toBe(true);
    expect(connection.sessionCapabilities.close).toEqual({});
  });

  it("binds the agent's credential when the host offers it", async () => {
    const adapter = fakeAdapter({ initialize: () => initialized });
    const actAs = vi.fn(async () => {});
    const host = fakeHost(adapter);
    const spawn = host.spawn;
    host.spawn = async (...args) => Object.assign(await spawn(...args), { actAs });
    await AcpConnection.start(host, { cwd: "/w", agent: { pubkey: "p", relay: "wss://r" } });
    expect(host.spawned[0].options.agentCredential).toBe(true);
    expect(actAs).toHaveBeenCalledWith({ pubkey: "p", relay: "wss://r" });
  });

  it("stops a process whose handshake fails", async () => {
    const adapter = fakeAdapter({
      initialize: () => {
        throw new Error("unsupported version");
      },
    });
    await expect(AcpConnection.start(fakeHost(adapter), { cwd: "/w" })).rejects.toThrow("unsupported version");
    expect(adapter.process.killed).toBe(true);
  });

  it("explains a missing adapter", async () => {
    const host = { spawn: async () => Promise.reject(new Error("program not found")) };
    await expect(AcpConnection.start(host, { cwd: "/w" })).rejects.toThrow(
      /needs Node\.js 22 or later on this computer\. Install it from https:\/\/nodejs\.org/,
    );
  });

  it("routes updates to their session and answers the adapter's requests", async () => {
    const adapter = fakeAdapter({ initialize: () => initialized });
    const connection = await AcpConnection.start(fakeHost(adapter), { cwd: "/w" });
    const updates = [];
    connection.onSession("s1", (update) => updates.push(update));
    adapter.emit({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "s1", update: { sessionUpdate: "x" } } });
    adapter.emit({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "s2", update: { sessionUpdate: "y" } } });
    adapter.emit({ jsonrpc: "2.0", id: 7, method: "session/request_permission", params: { options: [{ kind: "allow_once", optionId: "ok" }] } });
    adapter.emit({ jsonrpc: "2.0", id: 8, method: "fs/read_text_file", params: {} });
    adapter.emit({ jsonrpc: "2.0", method: "auth/status_update", params: { state: "authenticated" } });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(updates).toEqual([{ sessionUpdate: "x" }]);
    expect(adapter.sent.find((m) => m.id === 7).result).toEqual({ outcome: { outcome: "selected", optionId: "ok" } });
    expect(adapter.sent.find((m) => m.id === 8).error.code).toBe(-32601);
    expect(connection.auth).toEqual({ state: "authenticated" });
  });

  it("fails pending requests when the process exits, and says so", async () => {
    const adapter = fakeAdapter({ initialize: () => initialized, "session/prompt": () => NO_REPLY });
    const connection = await AcpConnection.start(fakeHost(adapter), { cwd: "/w" });
    const closes = [];
    connection.onClose((reason, stopped) => closes.push({ reason, stopped }));
    const prompt = connection.request("session/prompt", {});
    connection.stderr = "fatal: out of memory\n";
    adapter.process.exit(1);
    await expect(prompt).rejects.toThrow(/stopped with exit code 1:\nfatal: out of memory/);
    expect(closes).toEqual([{ reason: expect.stringContaining("exit code 1"), stopped: false }]);
    await expect(connection.request("session/new", {})).rejects.toThrow(/stopped/);
  });

  it("reports its own stop as stopped", async () => {
    const adapter = fakeAdapter({ initialize: () => initialized });
    const connection = await AcpConnection.start(fakeHost(adapter), { cwd: "/w" });
    const closes = [];
    connection.onClose((reason, stopped) => closes.push(stopped));
    await connection.stop();
    expect(closes).toEqual([true]);
    expect(adapter.process.killed).toBe(true);
  });

  it("times out a request the adapter never answers", async () => {
    vi.useFakeTimers();
    try {
      const adapter = fakeAdapter({ initialize: () => initialized, "session/new": () => NO_REPLY });
      const starting = AcpConnection.start(fakeHost(adapter), { cwd: "/w" });
      await vi.advanceTimersByTimeAsync(1);
      const connection = await starting;
      const request = connection.request("session/new", {}, 1000);
      const settled = expect(request).rejects.toThrow(/did not answer session\/new in time/);
      await vi.advanceTimersByTimeAsync(1001);
      await settled;
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("starting through npx", () => {
  /** A host whose first `failures` starts print `stderr` and exit, as npx
   * does when npm can't fetch the adapter. */
  function npxHost(failures, stderr) {
    const starts = [];
    return {
      starts,
      spawn: async (id, options) => {
        starts.push(options.env);
        if (starts.length <= failures) {
          let exit;
          const exited = new Promise((resolve) => (exit = resolve));
          setTimeout(() => {
            options.onStderr(stderr);
            exit(1);
          }, 1);
          return { exited, write: async () => {}, kill: async () => exit(null) };
        }
        return fakeAdapter({ initialize: () => initialized }).attach(options);
      },
    };
  }

  it("starts from npm's cache", async () => {
    const host = npxHost(0, "");
    await AcpConnection.start(host, { cwd: "/w" });
    expect(host.starts).toHaveLength(1);
    expect(host.starts[0].npm_config_prefer_offline).toBe("true");
  });

  it("asks the registry once when the cache predates the pinned version", async () => {
    const host = npxHost(1, "npm error code ETARGET\nnpm error notarget No matching version found for @agentclientprotocol/claude-agent-acp@0.106.0.\n");
    await AcpConnection.start(host, { cwd: "/w" });
    expect(host.starts.map((env) => env.npm_config_prefer_offline)).toEqual(["true", "false"]);
  });

  it("says so plainly when it can't reach the registry", async () => {
    const host = npxHost(2, "npm error code ENOTFOUND\nnpm error network request to https://registry.npmjs.org failed\n");
    await expect(AcpConnection.start(host, { cwd: "/w" })).rejects.toThrow(/can't reach the npm registry\. Connect once; after that it starts offline/);
    expect(host.starts).toHaveLength(1);
  });
});
