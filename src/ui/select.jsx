// Buzz's Select (src/shared/design-system/ui/Select.tsx) as markup: a compact
// trigger, or a settings row (`preference`), and a listbox.
//
// A plugin cannot portal, so the list opens as a native popover in the top
// layer. The popover is a transparent layer over the window that holds the
// list. It stays inside its dialog's DOM, so the dialog sees no outside press;
// a press on the layer itself closes only the list.
import { Button, PreferenceRow } from "./controls.jsx";
import { CaretDownIcon, CheckIcon } from "./icons.jsx";
import { h, useEffect, useId, useLayoutEffect, useRef, useState } from "./react.js";

const GAP = 4;
const EDGE = 8;
/** The popup's exit, `--duration-fast`. */
const CLOSE_MS = 120;
const TYPEAHEAD_MS = 700;
const LAYER = {
  position: "fixed",
  inset: 0,
  width: "100vw",
  height: "100vh",
  maxWidth: "none",
  maxHeight: "none",
  margin: 0,
  padding: 0,
  border: "none",
  background: "transparent",
  overflow: "visible",
};

/** Where the list goes beside `anchor`, inside the window. */
function placement(anchor, list, align) {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const below = height - anchor.bottom - EDGE;
  const above = anchor.top - EDGE;
  const side = below < 220 && above > below ? "top" : "bottom";
  // Not yet shown, the list has no width: place it by the trigger until it is.
  const listWidth = list?.offsetWidth || anchor.width;
  const start = align === "end" ? anchor.right - listWidth : anchor.left;
  const left = Math.min(Math.max(EDGE, start), Math.max(EDGE, width - EDGE - listWidth));
  return {
    side,
    style: {
      position: "absolute",
      left: `${left}px`,
      ...(side === "bottom" ? { top: `${anchor.bottom + GAP}px` } : { bottom: `${height - anchor.top + GAP}px` }),
      "--anchor-width": `${anchor.width}px`,
      "--available-height": `${Math.max(120, (side === "bottom" ? below : above) - GAP)}px`,
      "--available-width": `${width - 2 * EDGE}px`,
      "--transform-origin": side === "bottom" ? "top" : "bottom",
    },
  };
}

/** `options`: `{ value, label, description?, leading?, disabled? }`. */
export function Select({
  label,
  value,
  options,
  onValueChange,
  variant = "compact",
  appearance = "outlined",
  size,
  valueLabel,
  valueSuffix,
  valueTitle,
  leading,
  align = "start",
  disabled = false,
  description,
}) {
  const id = useId();
  const trigger = useRef(null);
  const layer = useRef(null);
  const list = useRef(null);
  const closing = useRef(undefined);
  const typed = useRef({ text: "", at: 0 });
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState("closed");
  const [place, setPlace] = useState({ side: "bottom", style: {} });
  const [highlight, setHighlight] = useState(-1);

  const selectedIndex = options.findIndex((option) => option.value === value);
  const selected = options[selectedIndex];
  const enabled = (index) => index >= 0 && index < options.length && !options[index].disabled;
  const step = (from, by) => {
    for (let index = from + by; index >= 0 && index < options.length; index += by) if (enabled(index)) return index;
    return from;
  };
  const optionId = (index) => `${id}-option-${index}`;

  const position = () => {
    const anchor = trigger.current?.getBoundingClientRect();
    if (anchor) setPlace(placement(anchor, list.current?.parentElement, align));
  };

  const show = () => {
    if (disabled || open) return;
    clearTimeout(closing.current);
    position();
    try {
      layer.current?.showPopover?.();
    } catch {
      // Already shown.
    }
    setOpen(true);
    setPhase("starting");
    setHighlight(enabled(selectedIndex) ? selectedIndex : step(-1, 1));
    requestAnimationFrame(() => {
      list.current?.focus({ preventScroll: true });
      requestAnimationFrame(() => setPhase("open"));
    });
  };

  const hide = (returnFocus = true) => {
    if (!open) return;
    setOpen(false);
    setPhase("ending");
    clearTimeout(closing.current);
    closing.current = setTimeout(() => {
      try {
        layer.current?.hidePopover?.();
      } catch {
        // Already hidden.
      }
      setPhase("closed");
    }, CLOSE_MS);
    if (returnFocus) trigger.current?.focus({ preventScroll: true });
  };

  const choose = (index) => {
    if (!open || !enabled(index)) return;
    hide();
    if (options[index].value !== value) onValueChange(options[index].value);
  };

  useEffect(() => () => clearTimeout(closing.current), []);
  useEffect(() => {
    if (disabled) hide(false);
  }, [disabled]);
  // Measure the list once shown, so it is kept inside the window.
  useLayoutEffect(() => {
    if (open) position();
  }, [open, options.length]);
  useEffect(() => {
    if (!open) return;
    const move = (event) => {
      if (event.type === "scroll" && list.current?.contains(event.target)) return;
      position();
    };
    window.addEventListener("resize", move);
    window.addEventListener("scroll", move, true);
    return () => {
      window.removeEventListener("resize", move);
      window.removeEventListener("scroll", move, true);
    };
  }, [open]);
  useEffect(() => {
    if (open && highlight >= 0) document.getElementById(optionId(highlight))?.scrollIntoView?.({ block: "nearest" });
  }, [open, highlight]);

  const onTriggerKey = (event) => {
    if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
      event.preventDefault();
      show();
    }
  };

  const onListKey = (event) => {
    const { key } = event;
    const handled = () => {
      event.preventDefault();
      event.stopPropagation();
    };
    if (key === "Escape") {
      // Closes only the list, not a dialog it sits in.
      handled();
      hide();
    } else if (key === "Tab") hide();
    else if (key === "ArrowDown") {
      handled();
      setHighlight((index) => step(index, 1));
    } else if (key === "ArrowUp") {
      handled();
      setHighlight((index) => step(index, -1));
    } else if (key === "Home") {
      handled();
      setHighlight(step(-1, 1));
    } else if (key === "End") {
      handled();
      setHighlight(step(options.length, -1));
    } else if (key === "Enter" || (key === " " && !typed.current.text)) {
      handled();
      choose(highlight);
    } else if (key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      const now = Date.now();
      const text = (now - typed.current.at < TYPEAHEAD_MS ? typed.current.text : "") + key.toLowerCase();
      typed.current = { text, at: now };
      setTimeout(() => {
        if (Date.now() - typed.current.at >= TYPEAHEAD_MS) typed.current = { text: "", at: 0 };
      }, TYPEAHEAD_MS);
      const match = options.findIndex((option, index) => enabled(index) && option.label.toLowerCase().startsWith(text));
      if (match >= 0) setHighlight(match);
    }
  };

  const preference = variant === "preference";
  const control = (
    <div data-buzz-ui="" className="buzz-select text-body" data-variant="compact" data-appearance={appearance}>
      <div className="sr-only" id={`${id}-label`}>
        {label}
      </div>
      <Button
        ref={trigger}
        shape={preference ? "control" : "capsule"}
        variant={appearance === "outlined" ? "outline" : appearance}
        size={size ?? "sm"}
        disabled={disabled}
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        data-popup-open={open ? "" : undefined}
        onClick={() => (open ? hide() : show())}
        onKeyDown={onTriggerKey}
      >
        <span className="buzz-select-value-content">
          {leading && (
            <span className="buzz-select-leading" aria-hidden="true">
              {leading}
            </span>
          )}
          <span className="buzz-select-value-text">
            <span className="buzz-select-value" title={valueTitle ?? selected?.label}>
              {valueLabel ?? selected?.label ?? ""}
            </span>
            {valueSuffix && <span className="buzz-select-value-suffix">{valueSuffix}</span>}
          </span>
        </span>
        <span aria-hidden="true">
          <CaretDownIcon size={14} className="buzz-dropdown-chevron" />
        </span>
      </Button>
      <div
        ref={layer}
        popover="manual"
        style={{ ...LAYER, ...(phase === "closed" ? { display: "none" } : {}), pointerEvents: open ? "auto" : "none" }}
        onPointerDown={(event) => {
          if (event.target === layer.current) {
            event.preventDefault();
            hide(false);
          }
        }}
      >
        <div
          data-buzz-ui=""
          className="buzz-select-popup text-body"
          data-variant="compact"
          data-side={place.side}
          data-starting-style={phase === "starting" ? "" : undefined}
          data-ending-style={phase === "ending" ? "" : undefined}
          style={place.style}
          onKeyDown={onListKey}
        >
          <div
            ref={list}
            role="listbox"
            id={`${id}-list`}
            tabIndex={-1}
            aria-labelledby={`${id}-label`}
            aria-activedescendant={open && highlight >= 0 ? optionId(highlight) : undefined}
            style={{ outline: "none" }}
          >
            {options.map((option, index) => {
              const isSelected = index === selectedIndex;
              const describedBy = option.description ? `${optionId(index)}-description` : undefined;
              return (
                <div
                  key={option.value || "\u0000default"}
                  id={optionId(index)}
                  role="option"
                  aria-selected={isSelected}
                  aria-disabled={option.disabled || undefined}
                  aria-label={option.label}
                  aria-describedby={describedBy}
                  className="buzz-select-option"
                  data-highlighted={open && index === highlight ? "" : undefined}
                  data-selected={isSelected ? "" : undefined}
                  data-disabled={option.disabled ? "" : undefined}
                  onPointerMove={() => enabled(index) && index !== highlight && setHighlight(index)}
                  onClick={() => choose(index)}
                >
                  <span className="buzz-select-option-main">
                    {option.leading && (
                      <span className="buzz-select-leading" aria-hidden="true">
                        {option.leading}
                      </span>
                    )}
                    <span className="buzz-select-option-content">
                      <span>{option.label}</span>
                      {option.description && (
                        <span id={describedBy} className="buzz-select-option-description text-body-sm text-subtle">
                          {option.description}
                        </span>
                      )}
                    </span>
                  </span>
                  <span className="buzz-select-indicator" data-selected={isSelected ? "" : undefined} aria-hidden="true">
                    <CheckIcon size={14} />
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
  return preference ? <PreferenceRow title={label} subtitle={description} trailing={control} /> : control;
}
