type AgentConversationMessageLike = {
  role: "user" | "assistant";
  content: string;
};

const HARNESS_DIAGNOSTIC_SNIPPETS = [
  "Agent repeated an identical tool request after MangaMaker had already supplied that result",
  "Agent reached the backend tool budget because it repeated an identical tool request after MangaMaker had already supplied that result",
  "The model kept repeating identical tool requests after MangaMaker supplied and indexed those results",
  "MangaMaker internal harness notice:",
  "MangaMaker suppressed additional tool requests",
  "MangaMaker rejected your previous response because it still requested tools in final-answer-only mode",
  "Final-answer-only mode is now active",
  "The model still tried to request tools instead of producing a final answer",
  "Tool budget reached. I paused instead of answering from incomplete evidence.",
  "Continuing paused tool requests.",
  "Resuming pending tool requests.",
];

const TOOL_PRELUDE_PATTERN =
  /\b(i need to|let me|need to inspect|need to read|need to render|inspect the|read the|render the)\b|(?:\u6211\u9700\u8981|\u8ba9\u6211|\u5148\u67e5\u770b|\u5148\u8bfb\u53d6|\u5148\u6e32\u67d3)/iu;

const ZH_MUTATION_TARGET =
  "(?:\\u6587\\u6863|metadoc|Markdown|doc|\\u9879\\u76ee|\\u9875|\\u753b\\u5e03|\\u6587\\u672c|\\u6c14\\u6ce1|\\u5206\\u955c|\\u9762\\u677f|\\u547d\\u4ee4|\\u89d2\\u8272)";
const ZH_MUTATION_VERB =
  "(?:\\u5199\\u5165|\\u5199\\u8fdb|\\u5199\\u56de|\\u66f4\\u65b0|\\u4fee\\u6539|\\u4fdd\\u5b58|\\u6574\\u5408|\\u5e94\\u7528|\\u6267\\u884c|\\u6539\\u5199|\\u91cd\\u5199|\\u5220\\u9664|\\u79fb\\u9664|\\u521b\\u5efa)";
const ZH_MUTATION_COMPLETION_CLAIM_PATTERNS = [
  new RegExp(`(?:\\u5df2\\u5c06|\\u5df2\\u7ecf|\\u5df2)(?=.{0,80}${ZH_MUTATION_VERB}).{0,80}${ZH_MUTATION_VERB}.{0,120}${ZH_MUTATION_TARGET}`, "u"),
  new RegExp(`${ZH_MUTATION_TARGET}.{0,80}(?:\\u5df2\\u7ecf|\\u5df2).{0,80}${ZH_MUTATION_VERB}`, "u"),
];

const WAITING_FOR_CREATOR_INPUT_PATTERN =
  /(?:已收到.{0,80}(?:约束|要求|指示)|后续输出将|请提供需要修改的文本|等待.{0,40}提供具体文本|received.{0,80}(?:constraint|instruction)|please provide the text to revise|waiting for the text)/iu;
const STRONG_MUTATION_COMPLETION_PATTERN =
  /(?:已(?:经|将)?(?:写入|写进|写回|更新|修改|保存|整合|应用|执行|改写|重写|删除|移除|创建)|(?:wrote|updated|saved|changed|inserted|deleted|created|executed|applied|integrated|rewrote))/iu;

const EN_MUTATION_COMPLETION_CLAIM_PATTERNS = [
  /(wrote|updated|saved|changed|inserted|deleted|created|executed|applied|integrated|rewrote).{0,120}(document|metadoc|project|page|canvas|text|bubble|panel|command)/iu,
  /(document|metadoc|project|page|canvas|text|bubble|panel|command).{0,120}(written|updated|saved|changed|inserted|deleted|created|executed|applied|integrated|rewritten)/iu,
];

export const isAgentHarnessDiagnosticContent = (content: string) =>
  HARNESS_DIAGNOSTIC_SNIPPETS.some((snippet) => content.includes(snippet));

const looksLikeSuppressedToolPrelude = (content: string) =>
  TOOL_PRELUDE_PATTERN.test(content) &&
  (
    content.includes("MangaMaker suppressed additional tool requests") ||
    content.includes("final-answer-only mode") ||
    content.includes("requestedToolCalls") ||
    content.includes("tool requests")
  );

export const isAgentMutationCompletionClaim = (content: string) => {
  const normalized = content.trim();
  if (!normalized) {
    return false;
  }
  if (
    WAITING_FOR_CREATOR_INPUT_PATTERN.test(normalized) &&
    !STRONG_MUTATION_COMPLETION_PATTERN.test(normalized)
  ) {
    return false;
  }
  return (
    ZH_MUTATION_COMPLETION_CLAIM_PATTERNS.some((pattern) => pattern.test(normalized)) ||
    EN_MUTATION_COMPLETION_CLAIM_PATTERNS.some((pattern) => pattern.test(normalized))
  );
};

export const shouldKeepAgentConversationMessage = (message: AgentConversationMessageLike) => {
  if (message.role !== "assistant") {
    return true;
  }
  return (
    !isAgentHarnessDiagnosticContent(message.content) &&
    !looksLikeSuppressedToolPrelude(message.content) &&
    !isAgentMutationCompletionClaim(message.content)
  );
};

export const sanitizeAgentConversationMessages = <T extends AgentConversationMessageLike>(messages: T[]) =>
  messages.filter(shouldKeepAgentConversationMessage);

const hashString = (value: string) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

export const createAgentConversationFingerprint = (messages: AgentConversationMessageLike[]) => {
  const sanitized = sanitizeAgentConversationMessages(messages);
  const serialized = sanitized
    .map((message) => `${message.role}\u0000${message.content}`)
    .join("\u0001");
  return `ctx-v1:${sanitized.length}:${serialized.length}:${hashString(serialized)}`;
};
