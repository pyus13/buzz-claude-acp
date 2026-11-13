// The New agent dialog's parts, as Buzz's Claude has them: Harness, Model and
// Thinking in one group, the instructions below, and Set up beside Harness
// while Claude isn't signed in.
import { readConfig } from "../config.js";
import { AgentInstructions, Button, PreferenceRow, row, SettingsGroup } from "./controls.jsx";
import { ModelSelect, ThinkingSelect, useCatalog } from "./models.jsx";
import { Fragment, h, useEffect } from "./react.js";
import { services } from "./services.js";

/** Compact model field; also the library card's. Ready once Claude's models
 * are read; a failed read holds creation, as an agent could not run. */
export function CreateModel({ config, onChange, onReadyChange, disabled, modelAppearance }) {
  const current = readConfig(config);
  const catalog = useCatalog();
  const ready = !catalog.loading && !catalog.error;
  useEffect(() => onReadyChange?.(ready), [onReadyChange, ready]);
  return (
    <>
      <div style={{ ...row, justifyContent: "flex-end" }}>
        <ModelSelect
          catalog={catalog}
          current={current}
          disabled={disabled}
          variant="compact"
          appearance={modelAppearance ?? "outlined"}
          align="end"
          onChange={(next) => onChange({ ...config, ...next })}
        />
        {catalog.error && (
          <Button size="sm" disabled={disabled} loading={catalog.loading} onClick={catalog.retry}>
            Try again
          </Button>
        )}
      </div>
      {catalog.error && (
        <span role="alert" className="text-body-sm text-danger">
          {catalog.error}
        </span>
      )}
    </>
  );
}

export function CreateThinking({ config, onChange, disabled }) {
  const catalog = useCatalog();
  return (
    <ThinkingSelect
      catalog={catalog}
      current={readConfig(config)}
      disabled={disabled}
      variant="compact"
      onChange={(next) => onChange({ ...config, ...next })}
    />
  );
}

export function CreateConfiguration({ harnessControl, onReadyChange, ...props }) {
  return (
    <SettingsGroup>
      {harnessControl}
      <PreferenceRow title="Model" trailing={<CreateModel {...props} onReadyChange={onReadyChange} />} />
      <PreferenceRow title="Thinking" trailing={<CreateThinking {...props} />} />
    </SettingsGroup>
  );
}

/** The instructions a new agent starts with. */
export function Create({ config, onChange, disabled }) {
  const current = readConfig(config);
  return (
    <AgentInstructions
      creation
      value={current.instructions}
      disabled={disabled}
      onChange={(instructions) => onChange({ ...config, instructions })}
    />
  );
}

/** Beside Harness while Claude needs setting up: opens its setup. */
export function CreateAction({ disabled }) {
  const catalog = useCatalog();
  if (catalog.readiness !== "attention" || !services.openSetup) return null;
  return (
    <Button
      size="sm"
      variant="subtle"
      shape="capsule"
      disabled={disabled}
      aria-label={catalog.attentionLabel}
      onClick={services.openSetup}
    >
      Set up
    </Button>
  );
}
