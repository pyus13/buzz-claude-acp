// Small, pure pieces of the Agent Client Protocol as this harness uses it.

const EVENT = "buzz-event";
const STEER = "new-message-arrived-while-you-were-working";
const STEER_NOTE =
  "Note: A new message arrived while you were working. Continue your in-progress work and incorporate the new message if it's relevant; if it's unrelated, you may briefly acknowledge it and carry on.";
/** Tool inputs that name what a step acts on, in the order they are tried. */
const STEP_TARGETS = ["description", "path", "file_path", "pattern", "url", "query", "command"];
const TARGET_LIMIT = 80;

/** A turn's prompt as a message steered into the running turn, as Buzz's own
 * Claude words it. */
export function steerPrompt(turn) {
  const open = `\n<${EVENT}>\n`;
  const close = `\n</${EVENT}>`;
  const once = (text) => turn.includes(text) && turn.indexOf(text) === turn.lastIndexOf(text);
  const steered =
    once(open) && once(close)
      ? turn.replace(open, `\n<${STEER}>\n`).replace(close, `\n</${STEER}>`)
      : `<${STEER}>\n${turn.trim()}\n</${STEER}>`;
  return `${steered}\n\n${STEER_NOTE}`;
}

/** A `session/update` as the activity step Buzz shows, if it is one. */
export function stepOf(update) {
  switch (update?.sessionUpdate) {
    case "tool_call": {
      const title = typeof update.title === "string" ? update.title : "";
      const tool = title.split(/__|: /).at(-1)?.split(" ")[0]?.trim() || "Tool";
      const input = update.rawInput && typeof update.rawInput === "object" ? update.rawInput : {};
      const target = STEP_TARGETS.map((key) => input[key]).find(
        (value) => typeof value === "string" && value,
      );
      if (!target) return { tool };
      const short = target.startsWith("/") ? target.split("/").at(-1) || target : target;
      return {
        tool,
        target: short.length > TARGET_LIMIT ? `${short.slice(0, TARGET_LIMIT - 1)}…` : short,
      };
    }
    case "agent_thought_chunk":
      return { tool: "Thinking" };
    case "agent_message_chunk":
      return { tool: "Writing reply" };
    default:
      return undefined;
  }
}

/** The answer to `session/request_permission`. Buzz has no one to ask in the
 * middle of a turn, so the agent's permission mode, the owner's choice, decides:
 * - Leaving plan mode is approving the plan. In Plan mode the plan stands:
 *   Claude keeps planning, and its context is never cleared.
 * - Anything else is allowed once. "Always" would write a lasting allow rule
 *   into the person's own Claude settings.
 * An option list with neither cancels the call. */
export function permissionAnswer(params) {
  const options = (Array.isArray(params?.options) ? params.options : []).filter(
    (option) => typeof option?.optionId === "string",
  );
  const select = (option) =>
    option ? { outcome: { outcome: "selected", optionId: option.optionId } } : { outcome: { outcome: "cancelled" } };
  if (options.some((option) => option.optionId.startsWith("exit-plan-")))
    return select(options.find((option) => String(option.kind).startsWith("reject")));
  return select(
    options.find((option) => option.kind === "allow_once") ??
      options.find((option) => option.kind === "allow_always"),
  );
}

/** Every choice of a select config option, groups flattened. */
export const choicesOf = (options = []) =>
  (Array.isArray(options) ? options : []).flatMap((option) =>
    Array.isArray(option?.options)
      ? choicesOf(option.options)
      : typeof option?.value === "string"
        ? [{ value: option.value, name: option.name || option.value, description: option.description }]
        : [],
  );

export const optionById = (configOptions, id) =>
  Array.isArray(configOptions) ? configOptions.find((option) => option?.id === id) : undefined;

/** A JSON-RPC error, a thrown error or anything else, as one line of text. */
export function errorText(error) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const data = typeof error.data === "string" ? error.data : error.data?.message;
    return data ? `${error.message}: ${data}` : String(error.message);
  }
  return String(error);
}

export const lastLines = (text, count = 6) => text.trim().split("\n").slice(-count).join("\n");

/** Effort ids as Buzz's Claude labels them. */
export const effortLabel = (id) =>
  id === "xhigh" ? "Extra high" : `${id.charAt(0).toUpperCase()}${id.slice(1)}`;
