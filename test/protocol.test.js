import { describe, expect, it } from "vitest";
import { choicesOf, effortLabel, errorText, optionById, permissionAnswer, steerPrompt, stepOf } from "../src/acp/protocol.js";

describe("steerPrompt", () => {
  it("renames the event section and adds the note", () => {
    const steered = steerPrompt("context\n<buzz-event>\nhello\n</buzz-event>");
    expect(steered).toContain("<new-message-arrived-while-you-were-working>\nhello\n</new-message-arrived-while-you-were-working>");
    expect(steered).not.toContain("<buzz-event>");
    expect(steered).toMatch(/A new message arrived while you were working/);
  });

  it("wraps a prompt without exactly one event section", () => {
    expect(steerPrompt("plain")).toMatch(/^<new-message-arrived-while-you-were-working>\nplain\n<\/new-/);
  });
});

describe("stepOf", () => {
  it("names a tool call and what it acts on", () => {
    expect(stepOf({ sessionUpdate: "tool_call", title: "mcp__buzz__send", rawInput: {} })).toEqual({ tool: "send" });
    expect(stepOf({ sessionUpdate: "tool_call", title: "Read", rawInput: { file_path: "/a/b/c.ts" } })).toEqual({
      tool: "Read",
      target: "c.ts",
    });
    const long = stepOf({ sessionUpdate: "tool_call", title: "Bash", rawInput: { command: "x".repeat(200) } });
    expect(long.target).toHaveLength(80);
  });

  it("shows thinking and writing, and nothing else", () => {
    expect(stepOf({ sessionUpdate: "agent_thought_chunk" })).toEqual({ tool: "Thinking" });
    expect(stepOf({ sessionUpdate: "agent_message_chunk" })).toEqual({ tool: "Writing reply" });
    expect(stepOf({ sessionUpdate: "usage_update" })).toBeUndefined();
    expect(stepOf(undefined)).toBeUndefined();
  });
});

describe("permissionAnswer", () => {
  const selected = (optionId) => ({ outcome: { outcome: "selected", optionId } });
  it("allows once, so no lasting rule is written to the person's settings", () => {
    const options = [
      { kind: "allow_always", optionId: "allow-with-updates" },
      { kind: "allow_once", optionId: "allow-once" },
      { kind: "reject_once", optionId: "reject" },
    ];
    expect(permissionAnswer({ options })).toEqual(selected("allow-once"));
    expect(permissionAnswer({ options: [options[0]] })).toEqual(selected("allow-with-updates"));
  });

  it("keeps planning instead of approving its own plan or clearing its context", () => {
    const options = [
      { kind: "allow_always", optionId: "exit-plan-clear-auto" },
      { kind: "allow_always", optionId: "exit-plan-auto" },
      { kind: "allow_once", optionId: "exit-plan-default" },
      { kind: "reject_once", optionId: "reject" },
    ];
    expect(permissionAnswer({ options })).toEqual(selected("reject"));
  });

  it("cancels when nothing allows", () => {
    expect(permissionAnswer({ options: [{ kind: "reject_once", optionId: "no" }] })).toEqual({ outcome: { outcome: "cancelled" } });
    expect(permissionAnswer(undefined)).toEqual({ outcome: { outcome: "cancelled" } });
  });
});

describe("config options", () => {
  const configOptions = [
    {
      id: "model",
      options: [{ value: "a", name: "A" }, { options: [{ value: "b" }] }, { name: "no value" }],
    },
  ];
  it("flattens grouped choices", () => {
    expect(choicesOf(configOptions[0].options)).toEqual([
      { value: "a", name: "A", description: undefined },
      { value: "b", name: "b", description: undefined },
    ]);
    expect(choicesOf(undefined)).toEqual([]);
  });
  it("finds an option by id", () => {
    expect(optionById(configOptions, "model")).toBe(configOptions[0]);
    expect(optionById(undefined, "model")).toBeUndefined();
  });
});

describe("text", () => {
  it("describes errors", () => {
    expect(errorText(new Error("boom"))).toBe("boom");
    expect(errorText({ message: "Invalid params", data: "no session" })).toBe("Invalid params: no session");
    expect(errorText({ message: "x", data: { message: "y" } })).toBe("x: y");
    expect(errorText("plain")).toBe("plain");
  });
  it("labels efforts as Buzz's Claude does", () => {
    expect(effortLabel("xhigh")).toBe("Extra high");
    expect(effortLabel("low")).toBe("Low");
  });
});
