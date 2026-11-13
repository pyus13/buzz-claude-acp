// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readConfig } from "../src/config.js";
import { Runtime } from "../src/runtime/runtime.js";
import { ActivityTab } from "../src/ui/activity.jsx";
import { Button } from "../src/ui/controls.jsx";
import { CreateAction, CreateConfiguration } from "../src/ui/create.jsx";
import { DefaultControl, ProviderDialogBody } from "../src/ui/provider.jsx";
import { bindReact, Fragment, h } from "../src/ui/react.js";
import { Select } from "../src/ui/select.jsx";
import { bindServices } from "../src/ui/services.js";
import { SettingsTab } from "../src/ui/settings.jsx";
import { fakeAgents } from "./fake-buzz.js";
import { fakeClaude, fakeHostFor } from "./fake-claude.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
bindReact(React);
void Fragment;

let root;
let container;
let runtime;
let agents;
const opened = [];

function services({ signedIn = true, claudeActivity } = {}) {
  const claude = fakeClaude(signedIn ? {} : { "auth/status": () => ({ state: "unauthenticated" }) });
  agents = fakeAgents();
  agents.types = () => (claudeActivity ? [{ key: "buzz.claude-code/claude-code", tabs: [{ role: "activity", component: claudeActivity }] }] : []);
  runtime = new Runtime({ agents, host: fakeHostFor(claude), typeKey: "local.claude-acp/claude-acp" });
  bindServices({ runtime, agents, openSetup: () => opened.push("setup") });
}

const render = async (element) => {
  await act(async () => root.render(element));
};
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 30)));
const press = (element, key) =>
  act(async () => element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })));
const comboboxes = () => [...container.querySelectorAll('[role="combobox"]')];
const named = (label) => comboboxes().find((element) => element.getAttribute("aria-label") === label);

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  Element.prototype.scrollIntoView = () => {};
  opened.length = 0;
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  runtime?.dispose();
});

describe("Select", () => {
  const options = [
    { value: "thread", label: "One session per thread" },
    { value: "channel", label: "One session per channel", description: "Shared" },
  ];

  it("opens, moves with the keyboard, chooses and returns focus", async () => {
    const onValueChange = vi.fn();
    await render(<Select label="Sessions" value="thread" options={options} onValueChange={onValueChange} />);
    const trigger = named("Sessions");
    await act(async () => trigger.click());
    await settle();
    const list = container.querySelector('[role="listbox"]');
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(list);
    expect(list.querySelector("[data-highlighted]").textContent).toContain("thread");
    await press(list, "ArrowDown");
    await press(list, "Enter");
    expect(onValueChange).toHaveBeenCalledWith("channel");
    expect(document.activeElement).toBe(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("names options and links their descriptions", async () => {
    await render(<Select label="Sessions" value="thread" options={options} onValueChange={() => {}} />);
    const option = container.querySelectorAll('[role="option"]')[1];
    expect(option.getAttribute("aria-label")).toBe("One session per channel");
    expect(document.getElementById(option.getAttribute("aria-describedby")).textContent).toBe("Shared");
  });

  it("closes only itself on Escape and on a press outside the list", async () => {
    const dialogEscape = vi.fn();
    const dialogPress = vi.fn();
    document.addEventListener("keydown", dialogEscape);
    container.addEventListener("pointerdown", dialogPress);
    await render(<Select label="Sessions" value="thread" options={options} onValueChange={() => {}} />);
    const trigger = named("Sessions");
    await act(async () => trigger.click());
    await settle();
    await press(container.querySelector('[role="listbox"]'), "Escape");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(dialogEscape).not.toHaveBeenCalled();
    await act(async () => trigger.click());
    await settle();
    const layer = container.querySelector("[popover]");
    await act(async () => layer.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })));
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    // The press landed inside the dialog's DOM, so the dialog saw no outside press.
    expect(container.contains(layer)).toBe(true);
    document.removeEventListener("keydown", dialogEscape);
  });

  it("ignores clicks while closing", async () => {
    const onValueChange = vi.fn();
    await render(<Select label="Sessions" value="thread" options={options} onValueChange={onValueChange} />);
    await act(async () => named("Sessions").click());
    await settle();
    const [, second] = container.querySelectorAll('[role="option"]');
    await act(async () => second.click());
    await act(async () => second.click());
    expect(onValueChange).toHaveBeenCalledTimes(1);
  });
});

describe("Button", () => {
  it("shows the spinner and stays focusable while loading", async () => {
    const onClick = vi.fn();
    await render(
      <Button loading onClick={onClick}>
        Save
      </Button>,
    );
    const button = container.querySelector("button");
    expect(button.disabled).toBe(false);
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(button.querySelector(".buzz-button-spinner")).not.toBeNull();
    await act(async () => button.click());
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe("SettingsTab", () => {
  const agentWith = (config, configBase = { settings: "rev1" }) => ({ key: "agent-1", type: "t", config, configBase });

  it("saves the normalised draft against the agent's base", async () => {
    services();
    const save = vi.fn(async () => {});
    await render(<SettingsTab agent={agentWith(readConfig({}))} save={save} settingsSection="runtime" />);
    await settle();
    const input = container.querySelector("input.buzz-input");
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    await act(async () => {
      setValue.call(input, "  ~/code  ");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => container.querySelector('button[type="submit"]').click());
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ workspace: "~/code" }), { base: { settings: "rev1" } });
  });

  it("takes saves made elsewhere into fields not edited here", async () => {
    services();
    const save = vi.fn(async () => {});
    const first = readConfig({ instructions: "old" });
    await render(<SettingsTab agent={agentWith(first)} save={save} settingsSection="identity" />);
    await settle();
    const textarea = container.querySelector("textarea");
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
    await act(async () => {
      setValue.call(textarea, "mine");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // Another device changed the model.
    await render(<SettingsTab agent={agentWith({ ...first, model: "sonnet" }, { settings: "rev2" })} save={save} settingsSection="identity" />);
    await settle();
    await act(async () => container.querySelector('button[type="submit"]').click());
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ instructions: "mine", model: "sonnet" }), { base: { settings: "rev2" } });
  });

  it("makes a field changed here and elsewhere a conflict, and holds Save until it's resolved", async () => {
    services();
    const save = vi.fn(async () => {});
    const first = readConfig({ instructions: "old" });
    await render(<SettingsTab agent={agentWith(first)} save={save} settingsSection="identity" />);
    await settle();
    const textarea = container.querySelector("textarea");
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
    await act(async () => {
      setValue.call(textarea, "mine");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await render(<SettingsTab agent={agentWith({ ...first, instructions: "theirs" }, { settings: "rev2" })} save={save} settingsSection="identity" />);
    await settle();
    expect(container.textContent).toContain("Instructions changed elsewhere");
    expect(container.textContent).toContain("Latest: theirs");
    const submit = container.querySelector('button[type="submit"]');
    expect(submit.getAttribute("aria-disabled")).toBe("true");
    await act(async () => submit.click());
    expect(save).not.toHaveBeenCalled();
    await act(async () => [...container.querySelectorAll("button")].find((b) => b.textContent === "Keep mine").click());
    await act(async () => container.querySelector('button[type="submit"]').click());
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ instructions: "mine" }), { base: { settings: "rev2" } });
  });

  it("holds Save while Buzz can't read the agent's config", async () => {
    services();
    await render(<SettingsTab agent={{ ...agentWith(readConfig({ workspace: "~/a" })), configProblem: "Unavailable" }} save={async () => {}} settingsSection="runtime" />);
    expect(container.textContent).toContain("Your edits stay in this form");
  });

  it("shows Save only while there is something to save", async () => {
    services();
    await render(<SettingsTab agent={agentWith(readConfig({}))} save={async () => {}} settingsSection="runtime" />);
    expect(container.querySelector('button[type="submit"]')).toBeNull();
  });
});

describe("New agent", () => {
  it("groups Harness, Model and Thinking and is ready once models are read", async () => {
    services();
    const ready = vi.fn();
    await render(
      <CreateConfiguration
        config={readConfig({})}
        onChange={() => {}}
        disabled={false}
        onReadyChange={ready}
        harnessControl={<div id="harness">Harness</div>}
      />,
    );
    await settle();
    await settle();
    expect(container.querySelector(".buzz-settings-group #harness")).not.toBeNull();
    expect(named("Model").textContent).toContain("Opus 5.5");
    expect(ready).toHaveBeenLastCalledWith(true);
  });

  it("offers Set up beside Harness only while Claude isn't signed in", async () => {
    services({ signedIn: false });
    await render(<CreateAction disabled={false} />);
    await settle();
    await settle();
    const setUp = [...container.querySelectorAll("button")].find((button) => button.textContent === "Set up");
    expect(setUp.getAttribute("aria-label")).toBe("Sign in to Claude");
    await act(async () => setUp.click());
    expect(opened).toEqual(["setup"]);
  });
});

describe("Agent setup", () => {
  it("says how Claude is signed in", async () => {
    services();
    await render(<ProviderDialogBody onClose={() => {}} />);
    await settle();
    await settle();
    expect(container.textContent).toContain("Signed in with your Claude account (Claude Max).");
    expect(container.textContent).toContain("Done");
  });

  it("offers Check again when signed out", async () => {
    services({ signedIn: false });
    await render(<ProviderDialogBody onClose={() => {}} />);
    await settle();
    await settle();
    expect(container.textContent).toContain("claude auth login");
    expect([...container.querySelectorAll("button")].some((button) => button.textContent.includes("Check again"))).toBe(true);
  });

  it("saves a default model and keeps the way back to the dialog", async () => {
    services();
    const onConfigure = vi.fn();
    await render(<DefaultControl onConfigure={onConfigure} />);
    await settle();
    await settle();
    await act(async () => named("Claude (ACP) default model").click());
    await settle();
    const sonnet = [...container.querySelectorAll('[role="option"]')].find((option) => option.textContent.includes("Sonnet"));
    await act(async () => sonnet.click());
    await settle();
    expect(runtime.defaults.snapshot().model).toBe("sonnet");
    await act(async () => [...container.querySelectorAll("button")].find((b) => b.textContent === "Edit configuration").click());
    expect(onConfigure).toHaveBeenCalled();
  });
});

describe("Activity", () => {
  it("shows Buzz's Claude Activity tab, and says how to get it without", async () => {
    const ClaudeActivity = ({ agent }) => <div id="claude">{`Activity for ${agent.key}`}</div>;
    services({ claudeActivity: ClaudeActivity });
    await render(<ActivityTab agent={{ key: "agent-9" }} />);
    expect(container.querySelector("#claude").textContent).toBe("Activity for agent-9");
    agents.types = () => [];
    await act(async () => agents.emit());
    expect(container.textContent).toContain("Turn on Buzz's Claude plugin");
  });
});

void h;
