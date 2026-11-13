// Buzz gives a plugin React through `ctx.react`; it cannot import it. The UI
// modules use these bindings, set once when the plugin is applied. Modules
// only define components at load, so nothing here runs before `bindReact`.

let React;

export function bindReact(react) {
  React = react;
}

/** The JSX factory (esbuild's `jsxFactory`). */
export const h = (...args) => React.createElement(...args);
/** The JSX fragment (esbuild's `jsxFragment`); resolved when rendered. */
export function Fragment(props) {
  return React.createElement(React.Fragment, null, props.children);
}

export const useEffect = (...args) => React.useEffect(...args);
export const useId = () => React.useId();
export const useLayoutEffect = (...args) => React.useLayoutEffect(...args);
export const useRef = (initial) => React.useRef(initial);
export const useState = (initial) => React.useState(initial);
export const useSyncExternalStore = (subscribe, snapshot) => React.useSyncExternalStore(subscribe, snapshot, snapshot);
