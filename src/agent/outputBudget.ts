export const AGENT_RECOMMENDED_MAX_MESSAGE_CHARS = 1200;
export const AGENT_RECOMMENDED_MAX_TOOL_CONTENT_CHARS = 6000;
export const AGENT_RECOMMENDED_LONG_EDIT_TOOL_CALLS_PER_TURN = 1;

export const createAgentOutputBudgetGuidance = (maxOutputTokens?: number | null) => {
  const tokenLine = maxOutputTokens
    ? `This model turn has max_output_tokens=${maxOutputTokens}.`
    : "This model turn has a finite max_output_tokens budget.";
  return [
    tokenLine,
    "The output budget covers the entire assistant response, including JSON syntax and document tool arguments.",
    `Keep message under ${AGENT_RECOMMENDED_MAX_MESSAGE_CHARS} characters.`,
    `For document mutation tool calls, keep each content/newText argument under ${AGENT_RECOMMENDED_MAX_TOOL_CONTENT_CHARS} characters unless the edit is plainly smaller than the remaining output budget.`,
    `For long rewrites, issue at most ${AGENT_RECOMMENDED_LONG_EDIT_TOOL_CALLS_PER_TURN} document mutation tool call per model turn, wait for its verified tool result, then continue the next chunk in a later model turn.`,
    "Do not paste a long revised document into message. Put durable content only in document mutation tool arguments.",
    "If the next needed edit cannot fit safely in this response, stop with taskProgress.status=\"waiting_for_user\" or request a narrower scope instead of emitting truncated JSON.",
  ].join(" ");
};
