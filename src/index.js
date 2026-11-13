// Claude (ACP): a Buzz harness whose agents are Claude Code, run through the
// Agent Client Protocol adapter with the person's own Claude login.
//
// This file only says what the plugin gives Buzz. How agents run is in
// runtime/, how the adapter is spoken to in acp/, the views in ui/.
import { CLAUDE_TYPE, PLUGIN_ID, TITLE, TYPE_ID } from "./constants.js";
import {
  adopt,
  carry,
  DEFAULTS,
  describeMigration,
  readConfig,
  SYNCED_SCHEMA,
  withSyncedSettings,
} from "./config.js";
import { Runtime } from "./runtime/runtime.js";
import { ActivityTab } from "./ui/activity.jsx";
import { Create, CreateAction, CreateConfiguration, CreateModel, CreateThinking } from "./ui/create.jsx";
import { HarnessIcon } from "./ui/icons.jsx";
import { providerOf } from "./ui/provider.jsx";
import { bindReact } from "./ui/react.js";
import { bindServices } from "./ui/services.js";
import { SettingsTab } from "./ui/settings.jsx";

export const inject = ["react", "agents", "host"];

export function apply(ctx) {
  const { agents, host } = ctx;
  // Only the desktop app starts processes and serves MCP; elsewhere there is
  // nothing this harness could run.
  if (!host.spawn || !host.serveMcp || !host.resolveDirectory) return;
  if (!agents.harness || !agents.storage)
    throw new Error(`${TITLE} needs a newer Buzz: this one does not let plugins run agent harnesses.`);

  const typeKey = `${ctx.pluginOwner?.id ?? PLUGIN_ID}/${TYPE_ID}`;
  const runtime = new Runtime({ agents, host, typeKey });
  const navigation = ctx.reflect?.get?.("navigation");
  bindReact(ctx.react);
  bindServices({
    runtime,
    agents,
    openSetup:
      navigation && (() => void navigation.open({ version: 1, kind: "settings", section: "agents", provider: typeKey })),
  });

  ctx.effect(() => {
    runtime.sync();
    const unsubscribe = agents.subscribe(() => runtime.sync());
    return () => {
      unsubscribe();
      runtime.dispose();
    };
  });

  agents.register({
    id: TYPE_ID,
    title: TITLE,
    icon: HarnessIcon,
    description:
      "Claude on this computer, signed in with your own Claude account. Each thread it is mentioned in is one continuing session.",
    defaults: () => ({ config: { ...DEFAULTS } }),
    summary: (agent) => readConfig(agent.config).model || TITLE,

    // New agent
    Create,
    CreateAction,
    CreateConfiguration,
    CreateModel,
    createModelReportsReadiness: true,
    CreateThinking,

    // Changing harness, sharing, syncing
    adopt,
    carry,
    describeMigration,
    exportShared: (saved) => ({ runtime: "claude", model: readConfig(saved).model }),
    syncedSettings: { schema: SYNCED_SCHEMA, withSynced: withSyncedSettings },

    // Settings and views
    tabs: [
      { id: "settings", title: "Settings", role: "settings", splitSettings: true, reconcilesConfig: true, component: SettingsTab },
      { id: "activity", title: "Activity", role: "activity", component: ActivityTab },
    ],
    provider: providerOf(),
    sessions: { list: (key) => runtime.sessionList(key), subscribe: runtime.subscribe },
    // Buzz's Claude reads usage from the same Claude Code session files.
    usage: async (agent, options) => {
      const claude = agents.types().find((type) => type.key === CLAUDE_TYPE);
      if (!claude?.usage) throw new Error("Usage needs Buzz's Claude plugin turned on in Settings → Plugins.");
      return claude.usage(agent, options);
    },
    models: (agent) => runtime.models(agent),

    // Running
    resumes: true,
    sessionControls: {
      scope: runtime.scope,
      state: (agent, place) => runtime.sessionState(agent, place),
      run: (agent, place, action, reset) => runtime.control(agent, place, action, reset),
      subscribe: runtime.subscribe,
    },
    run: (delivery) => runtime.run(delivery),
    runOnce: (turn) => runtime.runOnce(turn),
    readFile: (agent, path) => host.readFile(path, { cwd: readConfig(agent.config).workspace }),
  });
}
