const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const truncate = (value: string, maxLength = 220) =>
  value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;

const oneLineSnippet = (value: string, maxLength = 500) => {
  const normalized = value.replace(/\s+/g, " ").trim();
  return truncate(normalized || "<empty response body>", maxLength);
};

export class OpenRouterNonJsonResponseError extends Error {
  readonly status: number;
  readonly contentType: string;
  readonly bodySnippet: string;

  constructor({
    status,
    contentType,
    body,
  }: {
    status: number;
    contentType?: string | null;
    body: string;
  }) {
    const safeContentType = contentType?.trim() || "unknown";
    const bodySnippet = oneLineSnippet(body);
    super(
      `OpenRouter returned a non-JSON response (status=${status}, content-type=${safeContentType}): ${bodySnippet}`,
    );
    this.name = "OpenRouterNonJsonResponseError";
    this.status = status;
    this.contentType = safeContentType;
    this.bodySnippet = bodySnippet;
  }
}

const readString = (value: unknown) => (typeof value === "string" ? value : null);

const describeKeys = (value: unknown) =>
  isRecord(value) ? Object.keys(value).sort().join(",") || "none" : typeof value;

const readErrorMessage = (value: unknown) => {
  if (typeof value === "string") {
    return value;
  }
  if (!isRecord(value)) {
    return null;
  }
  return (
    readString(value.message) ??
    readString(value.error) ??
    readString(value.reason) ??
    JSON.stringify(value)
  );
};

const extractContentText = (value: unknown): string | null => {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    const text = value
      .map((entry) => extractContentText(entry))
      .filter((entry): entry is string => Boolean(entry?.trim()))
      .join("\n")
      .trim();
    return text || null;
  }
  if (!isRecord(value)) {
    return null;
  }
  if ("message" in value || "pendingCommandPlan" in value || "requestedToolCalls" in value) {
    return JSON.stringify(value);
  }
  return (
    readString(value.text) ??
    readString(value.content) ??
    readString(value.output_text) ??
    readString(value.input_text) ??
    null
  );
};

export const describeOpenRouterResponse = (value: unknown) => {
  if (!isRecord(value)) {
    return `responseType=${typeof value}`;
  }
  const choices = value.choices;
  const firstChoice = Array.isArray(choices) ? choices[0] : null;
  const choice = isRecord(firstChoice) ? firstChoice : null;
  const message = isRecord(choice?.message) ? choice.message : null;
  const details = [
    `responseKeys=${describeKeys(value)}`,
    `choiceCount=${Array.isArray(choices) ? choices.length : "missing"}`,
  ];
  if (choice) {
    details.push(`finishReason=${readString(choice.finish_reason) ?? readString(choice.native_finish_reason) ?? "unknown"}`);
    details.push(`choiceKeys=${describeKeys(choice)}`);
  }
  if (message) {
    const content = message.content;
    details.push(`messageKeys=${describeKeys(message)}`);
    details.push(`contentType=${Array.isArray(content) ? `array(${content.length})` : typeof content}`);
    const refusal = readString(message.refusal);
    if (refusal) {
      details.push(`refusal=${truncate(refusal, 160)}`);
    }
    const reasoning = readString(message.reasoning);
    if (reasoning) {
      details.push(`reasoningLength=${reasoning.length}`);
    }
    const toolCalls = message.tool_calls;
    if (Array.isArray(toolCalls)) {
      details.push(`toolCallCount=${toolCalls.length}`);
    }
  }
  return details.join("; ");
};

export const parseOpenRouterResponseJson = (
  body: string,
  metadata: { status: number; contentType?: string | null },
): unknown => {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new OpenRouterNonJsonResponseError({
      status: metadata.status,
      contentType: metadata.contentType,
      body,
    });
  }
};

export const extractOpenRouterAssistantContent = (value: unknown): string => {
  if (!isRecord(value)) {
    throw new Error(`OpenRouter response was not an object (${typeof value}).`);
  }
  const topLevelError = readErrorMessage(value.error);
  if (topLevelError) {
    throw new Error(`OpenRouter returned an error object: ${truncate(topLevelError)}`);
  }
  if (!Array.isArray(value.choices)) {
    throw new Error(`OpenRouter response did not include a choices array. ${describeOpenRouterResponse(value)}`);
  }
  const firstChoice = value.choices[0];
  if (!isRecord(firstChoice)) {
    throw new Error(`OpenRouter response choices array was empty or invalid. ${describeOpenRouterResponse(value)}`);
  }
  const choiceError = readErrorMessage(firstChoice.error);
  if (choiceError) {
    throw new Error(`OpenRouter choice returned an error object: ${truncate(choiceError)}`);
  }
  if (!isRecord(firstChoice.message)) {
    throw new Error(`OpenRouter response choice did not include an assistant message. ${describeOpenRouterResponse(value)}`);
  }
  const parsedContent = extractContentText(firstChoice.message.parsed);
  if (parsedContent?.trim()) {
    return parsedContent;
  }
  const content = extractContentText(firstChoice.message.content);
  if (content?.trim()) {
    return content;
  }
  throw new Error(`OpenRouter assistant content was empty. ${describeOpenRouterResponse(value)}`);
};
