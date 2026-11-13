// The agent's Settings tab, split as every harness's is: Identity (Harness,
// Model, Thinking, Instructions) and Settings (Workspace, Sessions,
// Permissions, then Buzz's own rows).
import { errorText } from "../acp/protocol.js";
import { MODES, SCOPES } from "../constants.js";
import { readConfig } from "../config.js";
import { AgentInstructions, Button, Field, Input, row, SaveButton, SettingsGroup, stack } from "./controls.jsx";
import { ModelSelect, ThinkingSelect, useCatalog } from "./models.jsx";
import { Fragment, h, useEffect, useId, useRef, useState } from "./react.js";
import { Select } from "./select.jsx";

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** A draft of the agent's settings that follows saves made elsewhere: a
 * field the person has not edited takes the newly saved value. */
function useDraft(saved) {
  const [draft, setDraft] = useState(saved);
  const opened = useRef(saved);
  useEffect(() => {
    const prior = opened.current;
    if (same(prior, saved)) return;
    opened.current = saved;
    setDraft((current) =>
      Object.fromEntries(Object.keys(saved).map((key) => [key, same(current[key], prior[key]) ? saved[key] : current[key]])),
    );
  }, [JSON.stringify(saved)]);
  return [draft, setDraft];
}

export function SettingsTab({ agent, save, settingsHost, settingsSection, settingsContent }) {
  const form = useId();
  const saved = readConfig(agent.config);
  const [draft, setDraft] = useDraft(saved);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const errorRef = useRef(null);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);
  const catalog = useCatalog();
  const configChanged = !same(draft, saved);
  const changed = configChanged || Boolean(settingsHost?.pendingSave);

  const submit = async () => {
    if (saving || !changed) return;
    // Saved as it will be read back, so the form settles on what was saved.
    const next = readConfig(draft);
    setDraft(next);
    setSaving(true);
    setError("");
    try {
      await save({ ...agent.config, ...next }, { base: agent.configBase ?? {} });
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      id={form}
      style={{ ...stack(), containerType: "inline-size" }}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {error && (
        <p ref={errorRef} tabIndex={-1} role="alert" className="buzz-field-error">
          {error}
        </p>
      )}
      {settingsSection !== "runtime" && (
        <>
          <SettingsGroup>
            {settingsHost?.typeControl?.(configChanged) ?? null}
            <ModelSelect catalog={catalog} current={draft} onChange={setDraft} variant="preference" align="start" />
            <ThinkingSelect catalog={catalog} current={draft} onChange={setDraft} variant="preference" />
          </SettingsGroup>
          {catalog.error && (
            <div style={row}>
              <span role="alert" className="text-body-sm text-danger">
                {catalog.error}
              </span>
              <Button size="sm" loading={catalog.loading} onClick={catalog.retry}>
                Try again
              </Button>
            </div>
          )}
          <div style={stack("var(--space-2)")}>
            <AgentInstructions
              value={draft.instructions}
              disabled={false}
              onChange={(instructions) => setDraft({ ...draft, instructions })}
            />
          </div>
        </>
      )}
      {settingsSection !== "identity" && (
        <>
          <div style={stack("var(--space-2)")}>
            <Field label="Workspace" description="The folder Claude works in. Use ~/ for your home folder.">
              {(control) => (
                <Input
                  {...control}
                  value={draft.workspace}
                  spellCheck={false}
                  autoCorrect="off"
                  autoCapitalize="none"
                  onValueChange={(workspace) => setDraft({ ...draft, workspace })}
                />
              )}
            </Field>
          </div>
          <Select
            label="Sessions"
            variant="preference"
            value={draft.scope}
            options={SCOPES.map(([value, label]) => ({ value, label }))}
            onValueChange={(scope) => setDraft({ ...draft, scope: scope === "channel" ? "channel" : "thread" })}
          />
          <Select
            label="Permissions"
            variant="preference"
            value={draft.mode}
            options={MODES.map(([value, label, description]) => ({ value, label, description }))}
            onValueChange={(mode) => setDraft({ ...draft, mode })}
          />
        </>
      )}
      <SaveButton form={form} saving={saving} visible={changed} />
      {settingsSection !== "identity" ? (settingsContent ?? null) : null}
    </form>
  );
}
