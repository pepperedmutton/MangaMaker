import type { AgentDocument, AgentDocumentMeta } from "./documentSchema";

export const AGENT_DOCUMENT_MUTATION_TOOL_NAMES = [
  "writeDocument",
  "appendDocument",
  "replaceDocumentSection",
  "replaceDocumentText",
  "editDocumentLines",
  "deleteDocument",
] as const;

export type AgentDocumentMutationToolName = (typeof AGENT_DOCUMENT_MUTATION_TOOL_NAMES)[number];

export const isAgentDocumentMutationToolName = (
  toolName: string,
): toolName is AgentDocumentMutationToolName =>
  (AGENT_DOCUMENT_MUTATION_TOOL_NAMES as readonly string[]).includes(toolName);

const readResultRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

export const isVerifiedAgentDocumentMutationResult = (value: unknown) => {
  const result = readResultRecord(value);
  if (result.saved !== true || result.conflict === true || result.verified === false) {
    return false;
  }
  return result.changed === true || result.alreadyApplied === true || result.deleted === true;
};

type AgentDocumentMetaPatch = Partial<Pick<
  AgentDocumentMeta,
  "title" | "role" | "status" | "path" | "relatedPageIds" | "summary"
>>;

export type AgentDocumentWritePayload = AgentDocumentMetaPatch & {
  operationId: string;
  id: string;
  content: string;
};

export type AppendDocumentInput = AgentDocumentMetaPatch & {
  operationId: string;
  documentId: string;
  content: string;
  heading?: string;
  createHeadingIfMissing?: boolean;
};

export type ReplaceDocumentSectionInput = AgentDocumentMetaPatch & {
  operationId: string;
  documentId: string;
  heading: string;
  content: string;
  headingLevel?: number;
  occurrence?: number;
  createIfMissing?: boolean;
  contentIncludesHeading?: boolean;
};

export type ReplaceDocumentTextInput = AgentDocumentMetaPatch & {
  operationId: string;
  documentId: string;
  oldText: string;
  newText: string;
  replaceAll?: boolean;
};

export type ReadDocumentLinesInput = {
  documentId: string;
  startLine?: number;
  endLine?: number;
};

export type EditDocumentLineOperation =
  | {
      type: "replace";
      startLine: number;
      endLine: number;
      content: string;
    }
  | {
      type: "delete";
      startLine: number;
      endLine: number;
    }
  | {
      type: "insertBefore";
      line: number;
      content: string;
    }
  | {
      type: "insertAfter";
      line: number;
      content: string;
    };

export type EditDocumentLinesInput = AgentDocumentMetaPatch & {
  operationId: string;
  documentId: string;
  operations: EditDocumentLineOperation[];
};

export type IncrementalDocumentEditResult = {
  ok: true;
  writePayload: AgentDocumentWritePayload;
  edit: {
    type: "append" | "replaceSection" | "replaceText" | "editLines";
    changed: boolean;
    documentId: string;
    contentLengthBefore: number;
    contentLengthAfter: number;
    heading?: string;
    headingLevel?: number;
    createdSection?: boolean;
    duplicateAppend?: boolean;
    alreadyApplied?: boolean;
    notFound?: boolean;
    unsafeAppend?: boolean;
    occurrence?: number;
    replacements?: number;
    operationsApplied?: number;
    lineCountBefore?: number;
    lineCountAfter?: number;
    invalidRange?: boolean;
  };
};

export type IncrementalDocumentEdit = IncrementalDocumentEditResult["edit"];

const normalizeMarkdown = (value: string) => value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

const cleanBlock = (value: string) => normalizeMarkdown(value).replace(/^\n+/, "").replace(/\n+$/, "");

const splitMarkdownLines = (value: string) => {
  const normalized = normalizeMarkdown(value);
  const hadTrailingNewline = normalized.endsWith("\n");
  const lines = normalized.length > 0 ? normalized.split("\n") : [];
  if (hadTrailingNewline) {
    lines.pop();
  }
  return { lines, hadTrailingNewline };
};

const markdownBlockToLines = (value: string) => {
  const normalized = normalizeMarkdown(value);
  if (!normalized) {
    return [];
  }
  const lines = normalized.split("\n");
  if (lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
};

const joinMarkdownLines = (lines: string[], hadTrailingNewline: boolean) => {
  if (lines.length === 0) {
    return "";
  }
  return `${lines.join("\n")}${hadTrailingNewline ? "\n" : ""}`;
};

const normalizeBlockForComparison = (value: string) =>
  cleanBlock(value)
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const markdownBlockAlreadyPresent = (container: string, block: string) => {
  const normalizedContainer = `\n${normalizeBlockForComparison(container)}\n`;
  const normalizedBlock = normalizeBlockForComparison(block);
  if (!normalizedBlock) {
    return true;
  }
  return normalizedContainer.includes(`\n${normalizedBlock}\n`);
};

const getFirstMarkdownHeading = (value: string) => {
  const firstContentLine = cleanBlock(value)
    .split("\n")
    .find((line) => line.trim().length > 0);
  const match = firstContentLine ? /^(#{1,6})[ \t]+(.+?)\s*$/.exec(firstContentLine) : null;
  if (!match) {
    return null;
  }
  return {
    level: match[1].length,
    heading: match[2].replace(/\s+#+\s*$/, "").trim(),
  };
};

const normalizeHeadingInput = (value: string) => {
  const trimmed = value.trim();
  const match = /^(#{1,6})[ \t]+(.+?)\s*$/.exec(trimmed);
  if (!match) {
    return {
      heading: trimmed.replace(/\s+#+\s*$/, "").trim(),
      headingLevel: undefined as number | undefined,
    };
  }
  return {
    heading: match[2].replace(/\s+#+\s*$/, "").trim(),
    headingLevel: match[1].length,
  };
};

const ensureSeparatedAppend = (base: string, addition: string) => {
  const normalizedBase = normalizeMarkdown(base);
  const normalizedAddition = cleanBlock(addition);
  if (!normalizedAddition) {
    return normalizedBase;
  }
  if (!normalizedBase.trim()) {
    return `${normalizedAddition}\n`;
  }
  const separator = normalizedBase.endsWith("\n\n")
    ? ""
    : normalizedBase.endsWith("\n")
      ? "\n"
      : "\n\n";
  return `${normalizedBase}${separator}${normalizedAddition}\n`;
};

const normalizeHeadingText = (value: string) =>
  value
    .replace(/\s+#+\s*$/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

type MarkdownHeading = {
  lineIndex: number;
  level: number;
  text: string;
};

const parseMarkdownHeadings = (content: string): MarkdownHeading[] => {
  const lines = normalizeMarkdown(content).split("\n");
  const headings: MarkdownHeading[] = [];
  lines.forEach((line, lineIndex) => {
    const match = /^(#{1,6})[ \t]+(.+?)\s*$/.exec(line);
    if (!match) {
      return;
    }
    headings.push({
      lineIndex,
      level: match[1].length,
      text: normalizeHeadingText(match[2]),
    });
  });
  return headings;
};

const findHeading = (
  content: string,
  heading: string,
  options: { headingLevel?: number; occurrence?: number } = {},
) => {
  const normalizedHeading = normalizeHeadingText(heading);
  const occurrence = Math.max(1, Math.floor(options.occurrence ?? 1));
  const matches = parseMarkdownHeadings(content).filter((entry) =>
    entry.text === normalizedHeading &&
    (options.headingLevel === undefined || entry.level === options.headingLevel),
  );
  return matches[occurrence - 1] ?? null;
};

const findSectionEndLine = (lines: string[], sectionStartLine: number, sectionLevel: number) => {
  for (let index = sectionStartLine + 1; index < lines.length; index += 1) {
    const match = /^(#{1,6})[ \t]+(.+?)\s*$/.exec(lines[index]);
    if (match && match[1].length <= sectionLevel) {
      return index;
    }
  }
  return lines.length;
};

const createWritePayload = (
  document: AgentDocument,
  patch: AgentDocumentMetaPatch & { operationId: string },
  content: string,
): AgentDocumentWritePayload => ({
  operationId: patch.operationId,
  id: document.id,
  title: patch.title ?? document.title,
  role: patch.role ?? document.role,
  status: patch.status ?? document.status,
  path: patch.path ?? document.path,
  relatedPageIds: patch.relatedPageIds ?? document.relatedPageIds,
  summary: patch.summary ?? document.summary,
  content,
});

const applyReplaceDocumentSectionEditInternal = (
  document: AgentDocument,
  input: ReplaceDocumentSectionInput,
): IncrementalDocumentEditResult => {
  const before = normalizeMarkdown(document.content);
  const normalizedHeading = normalizeHeadingInput(input.heading);
  const heading = normalizedHeading.heading || input.heading.trim();
  const requestedHeadingLevel = input.headingLevel ?? normalizedHeading.headingLevel;
  const headingMatch = findHeading(before, heading, {
    headingLevel: requestedHeadingLevel,
    occurrence: input.occurrence,
  });
  const replacement = cleanBlock(input.content);
  let nextContent: string;
  let headingLevel = requestedHeadingLevel ?? 2;
  let createdSection = false;
  let notFound = false;
  if (headingMatch) {
    const lines = before.split("\n");
    const sectionEndLine = findSectionEndLine(lines, headingMatch.lineIndex, headingMatch.level);
    headingLevel = headingMatch.level;
    const replacementLines = input.contentIncludesHeading
      ? replacement.split("\n")
      : [lines[headingMatch.lineIndex], "", ...replacement.split("\n")];
    nextContent = [
      ...lines.slice(0, headingMatch.lineIndex),
      ...replacementLines,
      "",
      ...lines.slice(sectionEndLine),
    ].join("\n").replace(/\n{4,}/g, "\n\n\n");
  } else if (input.createIfMissing !== false) {
    const createdContent = input.contentIncludesHeading
      ? replacement
      : `${"#".repeat(headingLevel)} ${heading}\n\n${replacement}`;
    nextContent = ensureSeparatedAppend(before, createdContent);
    createdSection = true;
  } else {
    nextContent = before;
    notFound = true;
  }
  const changed = nextContent !== before;
  return {
    ok: true,
    writePayload: createWritePayload(document, input, nextContent),
    edit: {
      type: "replaceSection",
      changed,
      documentId: document.id,
      contentLengthBefore: before.length,
      contentLengthAfter: nextContent.length,
      heading,
      headingLevel,
      ...(createdSection ? { createdSection } : {}),
      ...(notFound ? { notFound } : {}),
      ...(!changed && !notFound ? { alreadyApplied: true } : {}),
      occurrence: Math.max(1, Math.floor(input.occurrence ?? 1)),
    },
  };
};

export const applyAppendDocumentEdit = (
  document: AgentDocument,
  input: AppendDocumentInput,
): IncrementalDocumentEditResult => {
  const before = normalizeMarkdown(document.content);
  const heading = input.heading?.trim();
  const firstHeading = getFirstMarkdownHeading(input.content);
  if (
    firstHeading &&
    (!heading || normalizeHeadingText(firstHeading.heading) === normalizeHeadingText(heading))
  ) {
    return applyReplaceDocumentSectionEditInternal(document, {
      ...input,
      documentId: input.documentId,
      heading: heading ?? firstHeading.heading,
      headingLevel: firstHeading.level,
      content: input.content,
      contentIncludesHeading: true,
      createIfMissing: input.createHeadingIfMissing,
    });
  }
  if (parseMarkdownHeadings(input.content).length > 0) {
    return {
      ok: true,
      writePayload: createWritePayload(document, input, before),
      edit: {
        type: "append",
        changed: false,
        documentId: document.id,
        contentLengthBefore: before.length,
        contentLengthAfter: before.length,
        ...(heading ? { heading } : {}),
        unsafeAppend: true,
      },
    };
  }
  let nextContent: string;
  let createdSection = false;
  let headingLevel: number | undefined;
  let duplicateAppend = false;
  if (heading) {
    const headingMatch = findHeading(before, heading);
    if (headingMatch) {
      const lines = before.split("\n");
      const sectionEndLine = findSectionEndLine(lines, headingMatch.lineIndex, headingMatch.level);
      const insertion = cleanBlock(input.content);
      const sectionBody = lines.slice(headingMatch.lineIndex + 1, sectionEndLine).join("\n");
      if (markdownBlockAlreadyPresent(sectionBody, insertion)) {
        nextContent = before;
        duplicateAppend = Boolean(insertion);
        headingLevel = headingMatch.level;
      } else {
        const beforeSectionEnd = lines.slice(0, sectionEndLine);
        while (beforeSectionEnd.length > 0 && beforeSectionEnd[beforeSectionEnd.length - 1] === "") {
          beforeSectionEnd.pop();
        }
        const afterSectionEnd = lines.slice(sectionEndLine);
        const insertionLines = insertion ? ["", ...insertion.split("\n"), ""] : [];
        nextContent = [
          ...beforeSectionEnd,
          ...insertionLines,
          ...afterSectionEnd,
        ].join("\n");
        headingLevel = headingMatch.level;
      }
    } else if (input.createHeadingIfMissing !== false) {
      const newSection = `## ${heading}\n\n${cleanBlock(input.content)}`;
      if (markdownBlockAlreadyPresent(before, newSection)) {
        nextContent = before;
        duplicateAppend = true;
      } else {
        nextContent = ensureSeparatedAppend(before, newSection);
        createdSection = true;
      }
      headingLevel = 2;
    } else {
      if (markdownBlockAlreadyPresent(before, input.content)) {
        nextContent = before;
        duplicateAppend = true;
      } else {
        nextContent = ensureSeparatedAppend(before, input.content);
      }
    }
  } else {
    if (markdownBlockAlreadyPresent(before, input.content)) {
      nextContent = before;
      duplicateAppend = true;
    } else {
      nextContent = ensureSeparatedAppend(before, input.content);
    }
  }
  const changed = nextContent !== before;
  return {
    ok: true,
    writePayload: createWritePayload(document, input, nextContent),
    edit: {
      type: "append",
      changed,
      documentId: document.id,
      contentLengthBefore: before.length,
      contentLengthAfter: nextContent.length,
      ...(heading ? { heading } : {}),
      ...(headingLevel ? { headingLevel } : {}),
      ...(createdSection ? { createdSection } : {}),
      ...(duplicateAppend ? { duplicateAppend } : {}),
      ...(!changed && duplicateAppend ? { alreadyApplied: true } : {}),
    },
  };
};

export const applyReplaceDocumentSectionEdit = (
  document: AgentDocument,
  input: ReplaceDocumentSectionInput,
): IncrementalDocumentEditResult => applyReplaceDocumentSectionEditInternal(document, input);

export const applyReplaceDocumentTextEdit = (
  document: AgentDocument,
  input: ReplaceDocumentTextInput,
): IncrementalDocumentEditResult => {
  const before = normalizeMarkdown(document.content);
  const oldText = normalizeMarkdown(input.oldText);
  const newText = normalizeMarkdown(input.newText);
  if (!oldText) {
    return {
      ok: true,
      writePayload: createWritePayload(document, input, before),
      edit: {
        type: "replaceText",
        changed: false,
        documentId: document.id,
        contentLengthBefore: before.length,
        contentLengthAfter: before.length,
        replacements: 0,
      },
    };
  }
  let replacements = 0;
  let nextContent: string;
  if (input.replaceAll) {
    replacements = before.split(oldText).length - 1;
    nextContent = before.split(oldText).join(newText);
  } else {
    const index = before.indexOf(oldText);
    if (index >= 0) {
      replacements = 1;
      nextContent = `${before.slice(0, index)}${newText}${before.slice(index + oldText.length)}`;
    } else {
      nextContent = before;
    }
  }
  return {
    ok: true,
    writePayload: createWritePayload(document, input, nextContent),
    edit: {
      type: "replaceText",
      changed: nextContent !== before,
      documentId: document.id,
      contentLengthBefore: before.length,
      contentLengthAfter: nextContent.length,
      replacements,
      ...(replacements === 0 ? { notFound: true } : {}),
      ...(replacements > 0 && nextContent === before ? { alreadyApplied: true } : {}),
    },
  };
};

export const createDocumentLinesResult = (
  document: AgentDocument,
  input: ReadDocumentLinesInput,
) => {
  const { lines } = splitMarkdownLines(document.content);
  const lineCount = lines.length;
  const requestedStart = Number.isFinite(input.startLine) ? Math.floor(input.startLine ?? 1) : 1;
  const requestedEnd = Number.isFinite(input.endLine) ? Math.floor(input.endLine ?? lineCount) : lineCount;
  const startLine = Math.max(1, Math.min(lineCount || 1, requestedStart));
  const endLine = Math.max(startLine, Math.min(lineCount, requestedEnd));
  const selectedLines = lineCount > 0 ? lines.slice(startLine - 1, endLine) : [];
  return {
    document: {
      id: document.id,
      title: document.title,
      role: document.role ?? null,
      status: document.status,
      path: document.path,
      relatedPageIds: document.relatedPageIds,
      updatedAt: document.updatedAt,
      summary: document.summary ?? "",
      contentLength: document.content.length,
    },
    lineCount,
    startLine: lineCount > 0 ? startLine : 0,
    endLine: lineCount > 0 ? endLine : 0,
    truncatedBefore: lineCount > 0 && startLine > 1,
    truncatedAfter: lineCount > 0 && endLine < lineCount,
    lines: selectedLines.map((text, index) => ({
      line: startLine + index,
      text,
    })),
  };
};

const normalizeLineNumber = (value: number) => Math.floor(value);

const computeLineEditSplice = (
  operation: EditDocumentLineOperation,
  lineCount: number,
): {
  valid: true;
  spliceStart: number;
  deleteCount: number;
  insertLines: string[];
  originalStartLine: number;
  originalEndLine: number;
} | {
  valid: false;
} => {
  if (operation.type === "replace" || operation.type === "delete") {
    const startLine = normalizeLineNumber(operation.startLine);
    const endLine = normalizeLineNumber(operation.endLine);
    if (startLine < 1 || endLine < startLine || endLine > lineCount) {
      return { valid: false };
    }
    return {
      valid: true,
      spliceStart: startLine - 1,
      deleteCount: endLine - startLine + 1,
      insertLines: operation.type === "replace" ? markdownBlockToLines(operation.content) : [],
      originalStartLine: startLine,
      originalEndLine: endLine,
    };
  }
  const line = normalizeLineNumber(operation.line);
  if (operation.type === "insertBefore") {
    if (line < 1 || line > lineCount + 1) {
      return { valid: false };
    }
    return {
      valid: true,
      spliceStart: line - 1,
      deleteCount: 0,
      insertLines: markdownBlockToLines(operation.content),
      originalStartLine: line,
      originalEndLine: line - 1,
    };
  }
  if (line < 0 || line > lineCount) {
    return { valid: false };
  }
  return {
    valid: true,
    spliceStart: line,
    deleteCount: 0,
    insertLines: markdownBlockToLines(operation.content),
    originalStartLine: line,
    originalEndLine: line,
  };
};

export const applyEditDocumentLinesEdit = (
  document: AgentDocument,
  input: EditDocumentLinesInput,
): IncrementalDocumentEditResult => {
  const before = normalizeMarkdown(document.content);
  const { lines, hadTrailingNewline } = splitMarkdownLines(before);
  const lineCountBefore = lines.length;
  const splices = input.operations.map((operation) => computeLineEditSplice(operation, lineCountBefore));
  const invalidRange = splices.some((splice) => !splice.valid);
  let overlapping = false;
  const ranges = splices
    .filter((splice): splice is Extract<typeof splice, { valid: true }> => splice.valid && splice.deleteCount > 0)
    .map((splice) => ({
      start: splice.originalStartLine,
      end: splice.originalStartLine + splice.deleteCount - 1,
    }))
    .sort((left, right) => left.start - right.start);
  for (let index = 1; index < ranges.length; index += 1) {
    if (ranges[index].start <= ranges[index - 1].end) {
      overlapping = true;
      break;
    }
  }
  if (invalidRange || overlapping) {
    return {
      ok: true,
      writePayload: createWritePayload(document, input, before),
      edit: {
        type: "editLines",
        changed: false,
        documentId: document.id,
        contentLengthBefore: before.length,
        contentLengthAfter: before.length,
        operationsApplied: 0,
        lineCountBefore,
        lineCountAfter: lineCountBefore,
        invalidRange: true,
      },
    };
  }
  const nextLines = [...lines];
  const validSplices = splices
    .filter((splice): splice is Extract<typeof splice, { valid: true }> => splice.valid)
    .sort((left, right) => right.spliceStart - left.spliceStart);
  for (const splice of validSplices) {
    nextLines.splice(splice.spliceStart, splice.deleteCount, ...splice.insertLines);
  }
  const nextContent = joinMarkdownLines(nextLines, hadTrailingNewline);
  const changed = nextContent !== before;
  return {
    ok: true,
    writePayload: createWritePayload(document, input, nextContent),
    edit: {
      type: "editLines",
      changed,
      documentId: document.id,
      contentLengthBefore: before.length,
      contentLengthAfter: nextContent.length,
      operationsApplied: validSplices.length,
      lineCountBefore,
      lineCountAfter: nextLines.length,
      ...(!changed ? { alreadyApplied: true } : {}),
    },
  };
};

export const isIncrementalDocumentEditVerifiedNoop = (edit: IncrementalDocumentEditResult["edit"]) =>
  edit.alreadyApplied === true || edit.duplicateAppend === true;

export const incrementalDocumentEditFailureReason = (edit: IncrementalDocumentEditResult["edit"]) => {
  if (edit.notFound) {
    if (edit.type === "replaceText") {
      return "The requested oldText was not found in the document, so no document content was changed.";
    }
    if (edit.type === "replaceSection") {
      return "The requested Markdown heading section was not found and createIfMissing=false, so no document content was changed.";
    }
  }
  if (edit.unsafeAppend) {
    return "appendDocument refused Markdown heading content because appending sections can duplicate document structure. Use replaceDocumentSection for heading-based changes.";
  }
  if (edit.invalidRange) {
    return "The requested line edit used invalid or overlapping line ranges, so no document content was changed. Read document lines again and retry with valid 1-based line ranges.";
  }
  return "The document edit produced no content change.";
};
