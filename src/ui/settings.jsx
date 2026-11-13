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
const LABELS = {
  model: "Model",
  effort: "Thinking",
  instructions: "Instructions",
  workspace: "Workspace",
  scope: "Sessions",
  mode: "Permissions",
};
const shown = (key, value) =>
  key === "scope"
    ? SCOPES.find(([id]) => id === value)?.[1]
    : key === "mode"
      ? MODES.find(([id]) => id === value)?.[1]
      : value || (key === "instructions" ? "No instructions" : "Default");

/** A draft of the agent's settings that follows saves made elsewhere, as
 * Buzz's Claude's does: a field not edited here takes the newly saved value,
 * and one edited here that changed elsewhere too is a conflict to resolve. */
function useDraft(saved) {
  const [state, setState] = useState({ draft: saved, latest: saved, conflicts: [] });
  const opened = useRef(saved);
  useEffect(() => {
    const prior = opened.current;
    if (same(prior, saved)) return;
    opened.current = saved;
    setState(({ draft, conflicts }) => {
      const found = new Set(conflicts);
      const next = {};
      for (const key of Object.keys(saved)) {
        if (same(draft[key], prior[key])) next[key] = saved[key];
        else {
          next[key] = draft[key];
          if (!same(saved[key], prior[key]) && !same(draft[key], saved[key])) found.add(key);
        }
      }
      return { draft: next, latest: saved, conflicts: [...found] };
    });
  }, [JSON.stringify(saved)]);
  return {
    ...state,
    setDraft: (draft) => setState((current) => ({ ...current, draft })),
    resolve: (key, useLatest) =>
      setState((current) => ({
        ...current,
        draft: useLatest ? { ...current.draft, [key]: current.latest[key] } : current.draft,
        conflicts: current.conflicts.filter((item) => item !== key),
      })),
  };
}

function Conflict({ field, latest, draft, resolve, disabled }) {
  return (
    <fieldset aria-label={`${LABELS[field]} conflict`} style={{ ...stack("var(--space-2)"), margin: 0, padding: "var(--space-3) 0", border: 0 }}>
      <p role="alert" className="text-body-sm text-warning" style={{ margin: 0 }}>
        {LABELS[field]} changed elsewhere. Choose which changes to keep.
      </p>
      <div className="text-body-sm" style={{ overflowWrap: "anywhere" }}>
        <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>Latest: {shown(field, latest[field])}</p>
        <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>Yours: {shown(field, draft[field])}</p>
      </div>
      <div style={row}>
        <Button disabled={disabled} onClick={() => resolve(field, true)}>
          Use latest
        </Button>
        <Button disabled={disabled} onClick={() => resolve(field, false)}>
          Keep mine
        </Button>
      </div>
    </fieldset>
  );
}

export function SettingsTab({ agent, save, settingsHost, settingsSection, settingsContent }) {
  const form = useId();
  const saved = readConfig(agent.config);
  const { draft, latest, conflicts, setDraft, resolve } = useDraft(saved);
  // Buzz could not read the agent's config: edits stay here until it can.
  const unavailable = Boolean(agent.configProblem) && !settingsHost?.pendingSave;
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
    if (saving || !changed || conflicts.length || unavailable) return;
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
      {unavailable && (
        <p className="text-body-sm text-muted" style={{ margin: 0 }}>
          Your edits stay in this form. You can save them when configuration is available again.
        </p>
      )}
      {settingsSection !== "runtime" && (
        <>
          {["model", "effort"].filter((field) => conflicts.includes(field)).map((field) => (
            <Conflict key={field} field={field} latest={latest} draft={draft} resolve={resolve} disabled={saving} />
          ))}
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
            {conflicts.includes("instructions") && (
              <Conflict field="instructions" latest={latest} draft={draft} resolve={resolve} disabled={saving} />
            )}
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
          {["workspace", "scope", "mode"].filter((field) => conflicts.includes(field)).map((field) => (
            <Conflict key={field} field={field} latest={latest} draft={draft} resolve={resolve} disabled={saving} />
          ))}
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
      <SaveButton form={form} saving={saving} visible={changed} disabled={conflicts.length > 0 || unavailable} />
      {settingsSection !== "identity" ? (settingsContent ?? null) : null}
    </form>
  );
}
