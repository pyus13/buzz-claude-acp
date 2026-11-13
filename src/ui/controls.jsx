// Buzz's shared controls, as markup: the same elements, classes and data
// attributes as src/shared/design-system/ui, so Buzz's stylesheet styles them.
import { SpinnerIcon } from "./icons.jsx";
import { Fragment, h, useId } from "./react.js";

/** Buzz's Button. Loading keeps it focusable and shows the spinner. */
export function Button({
  variant = "subtle",
  size = "md",
  shape = "capsule",
  type = "button",
  loading = false,
  disabled = false,
  onClick,
  children,
  ...props
}) {
  const inert = disabled || loading;
  return (
    <button
      {...props}
      type={type}
      disabled={disabled && !loading}
      aria-disabled={inert || undefined}
      aria-busy={loading || undefined}
      data-disabled={inert ? "" : undefined}
      data-buzz-ui=""
      className="buzz-button"
      data-variant={variant}
      data-size={size}
      data-button-shape={shape}
      data-loading={loading || undefined}
      onClick={(event) => {
        if (inert) {
          event.preventDefault();
          return;
        }
        onClick?.(event);
      }}
    >
      <span className="buzz-button-label">{children}</span>
      {loading && <SpinnerIcon size={18} className="buzz-button-spinner" />}
    </button>
  );
}

export const SettingsGroup = ({ children }) => (
  <div data-buzz-ui="" className="buzz-settings-group" data-layout="rows">
    {children}
  </div>
);

export function PreferenceRow({ title, subtitle, trailing }) {
  return (
    <div data-buzz-ui="" className="buzz-preference-row" data-variant="default">
      <div className="buzz-preference-row-content">
        <div className="buzz-preference-row-label">{title}</div>
        {subtitle && <span className="buzz-preference-row-description">{subtitle}</span>}
      </div>
      {trailing != null && <div className="buzz-preference-row-trailing">{trailing}</div>}
    </div>
  );
}

/** Buzz's Field. `children` renders the control with the props that connect
 * it to the label and the description. */
export function Field({ label, description, optional = false, children }) {
  const id = useId();
  const describedBy = description ? `${id}-description` : undefined;
  return (
    <div data-buzz-ui="" className="buzz-field">
      <label className="buzz-field-label" htmlFor={id}>
        {label}
        {optional && (
          <>
            {" "}
            <span className="buzz-field-optional">Optional</span>
          </>
        )}
      </label>
      {children({ id, "aria-describedby": describedBy })}
      {description && (
        <p id={describedBy} className="buzz-field-description">
          {description}
        </p>
      )}
    </div>
  );
}

export function Input({ value, onValueChange, ...props }) {
  return (
    <input
      {...props}
      data-buzz-ui=""
      data-size="md"
      className="buzz-input"
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
    />
  );
}

const EXAMPLE = "Help me plan my week and prioritize tasks.";

/** Buzz's AgentInstructions: optional while creating, taller in Settings. */
export function AgentInstructions({ value, disabled, onChange, creation = false }) {
  return (
    <Field label="Instructions" optional={creation}>
      {(control) => (
        <textarea
          {...control}
          data-buzz-ui=""
          className="buzz-textarea"
          data-variant="text"
          data-surface="inset"
          data-appearance="outlined"
          rows={creation ? 4 : 8}
          value={value}
          disabled={disabled}
          placeholder={EXAMPLE}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </Field>
  );
}

/** Buzz's agent save button where the panel's footer is out of a plugin's
 * reach: inline, shown only while there is something to save. */
export function SaveButton({ form, saving, visible }) {
  if (!visible && !saving) return null;
  return (
    <div>
      <Button type="submit" form={form} variant="prominent" loading={saving}>
        {saving ? "Saving…" : "Save"}
      </Button>
    </div>
  );
}

export const stack = (gap = "var(--space-4)") => ({ display: "grid", gap, minWidth: 0 });
export const row = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "var(--space-2)", maxWidth: "100%" };

export { Fragment };
