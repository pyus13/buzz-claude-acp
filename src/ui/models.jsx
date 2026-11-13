// Model and Thinking pickers, as Buzz's Claude lists them: the default first,
// then each model; a model's own thinking levels, Automatic first.
import { effortLabel } from "../acp/protocol.js";
import { ClaudeLogoIcon } from "./icons.jsx";
import { h, useEffect, useSyncExternalStore } from "./react.js";
import { Select } from "./select.jsx";
import { services } from "./services.js";

const subscribe = (listener) => services.runtime.subscribe(listener);
const catalogNow = () => services.runtime.catalog.snapshot();
const defaultsNow = () => services.runtime.defaults.snapshot();

/** What Claude offers, read once and kept: never "Loading" twice. */
export function useCatalog() {
  const state = useSyncExternalStore(subscribe, catalogNow);
  useEffect(() => {
    void services.runtime.catalog.ensure();
  }, []);
  return { ...state, retry: () => void services.runtime.catalog.check() };
}

export const useDefaults = () => useSyncExternalStore(subscribe, defaultsNow);

/** Claude's mark beside each model. Made when rendered: nothing runs at load. */
const logo = () => <ClaudeLogoIcon size={20} />;

/** The model choices, with `""` for "the default": this device's default
 * model if one is set, else Claude's own. */
export function modelChoices(catalog, defaults, value, { claudeDefaultOnly = false } = {}) {
  const fallback = catalog.models.find((model) => model.id === "default");
  const claudeDefault = fallback?.description || "Claude default";
  const preferred = !claudeDefaultOnly && defaults.model && catalog.models.find((model) => model.id === defaults.model);
  const defaultName = preferred?.label || (defaults.model && !claudeDefaultOnly ? defaults.model : claudeDefault);
  const listed = catalog.models.filter(
    (model) => model.id !== "default" && (claudeDefaultOnly || model.id !== defaults.model || model.id === value),
  );
  const options = [
    {
      value: "",
      label: claudeDefaultOnly ? claudeDefault : `${defaultName} · Default`,
      description: claudeDefaultOnly ? "Use Claude default" : "Following the provider's model default",
      leading: logo(),
    },
    ...listed.map((model) => ({ value: model.id, label: model.label, description: model.description, leading: logo() })),
  ];
  if (value && !catalog.loading && !listed.some((model) => model.id === value) && !(preferred && value === defaults.model))
    options.push({ value, label: value, description: "Unavailable model", leading: logo() });
  const chosen = options.find((option) => option.value === value) ?? options[0];
  return {
    options,
    valueLabel: catalog.loading && !catalog.models.length ? "Loading models…" : value ? chosen.label : claudeDefaultOnly ? claudeDefault : defaultName,
    valueSuffix: !value && !claudeDefaultOnly && !catalog.loading ? " · Default" : undefined,
    valueTitle: chosen.label,
  };
}

/** The thinking levels a model takes; `""` follows the default model. */
export const effortsOf = (catalog, defaults, model) =>
  catalog.models.find((entry) => entry.id === (model || defaults.model || "default"))?.efforts ?? [];

export function thinkingChoices(catalog, defaults, current) {
  const efforts = effortsOf(catalog, defaults, current.model);
  return [
    { value: "", label: "Automatic · Default" },
    ...(current.effort && !efforts.some((level) => level.id === current.effort)
      ? [{ value: current.effort, label: catalog.models.length ? `${effortLabel(current.effort)} (unavailable)` : effortLabel(current.effort) }]
      : []),
    ...efforts.map((level) => ({ value: level.id, label: effortLabel(level.id) })),
  ];
}

/** A model change keeps the thinking level only where the new model has it. */
export const withModel = (catalog, defaults, current, model) => ({
  ...current,
  model,
  effort:
    !catalog.models.length || effortsOf(catalog, defaults, model).some((level) => level.id === current.effort)
      ? current.effort
      : "",
});

export function ModelSelect({ catalog, current, onChange, disabled, variant, appearance = "outlined", align }) {
  const defaults = useDefaults();
  const choice = modelChoices(catalog, defaults, current.model);
  return (
    <Select
      label="Model"
      value={current.model}
      options={choice.options}
      valueLabel={choice.valueLabel}
      valueSuffix={choice.valueSuffix}
      valueTitle={choice.valueTitle}
      leading={logo()}
      variant={variant}
      appearance={appearance}
      size={appearance === "glass-ghost" ? "xs" : undefined}
      align={align}
      disabled={disabled || (catalog.loading && !catalog.models.length)}
      onValueChange={(model) => onChange(withModel(catalog, defaults, current, model))}
    />
  );
}

export function ThinkingSelect({ catalog, current, onChange, disabled, variant }) {
  const defaults = useDefaults();
  return (
    <Select
      label="Thinking"
      value={current.effort}
      options={thinkingChoices(catalog, defaults, current)}
      valueLabel={current.effort ? undefined : "Automatic"}
      valueSuffix={current.effort ? undefined : " · Default"}
      variant={variant}
      disabled={disabled || !catalog.models.length}
      onValueChange={(effort) => onChange({ ...current, effort })}
    />
  );
}
