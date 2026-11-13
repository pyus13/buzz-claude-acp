// What the views read from the plugin, set once when the plugin is applied.

export const services = { runtime: undefined, agents: undefined, openSetup: undefined };

export function bindServices(next) {
  Object.assign(services, next);
}
