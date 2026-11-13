// The Activity tab: Buzz's own Claude Activity tab, which reads the same
// Claude Code sessions this harness runs (their record is kept for it).
import { CLAUDE_TYPE } from "../constants.js";
import { h, useSyncExternalStore } from "./react.js";
import { services } from "./services.js";

const claudeActivity = () =>
  services.agents
    .types()
    .find((type) => type.key === CLAUDE_TYPE)
    ?.tabs?.find((tab) => tab.role === "activity")?.component;

export function ActivityTab(props) {
  // Follows Buzz's Claude plugin being turned on or off.
  const Claude = useSyncExternalStore(services.agents.subscribe, claudeActivity);
  if (Claude) return <Claude {...props} />;
  return (
    <p className="text-body-sm text-subtle" style={{ margin: 0 }}>
      Turn on Buzz's Claude plugin in Settings → Plugins to see this agent's conversations and transcripts here.
    </p>
  );
}
