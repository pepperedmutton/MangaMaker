import {
  normalizeAgentDocumentDirectoryPath,
  type AgentDocumentMeta,
} from "./documentSchema";

export const AGENT_DOCUMENT_WRITE_SCOPE = "activeRoleWorkingDirectoryOnly" as const;

type AgentDocumentPathMeta = Pick<AgentDocumentMeta, "id" | "title" | "path">;

export const normalizeAgentDocumentToolPath = (value: string) =>
  value
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+/g, "/");

export const isAgentDocumentPathUnderDirectory = (
  documentPath: string,
  directoryPath: string,
) => {
  const normalizedDirectory = normalizeAgentDocumentDirectoryPath(directoryPath).replace(/\/+$/, "");
  const normalizedDocumentPath = normalizeAgentDocumentToolPath(documentPath);
  return normalizedDocumentPath
    .toLowerCase()
    .startsWith(`${normalizedDirectory.toLowerCase()}/`);
};

export const createAgentDocumentWriteScopeBlockedResult = ({
  toolName,
  requestedDocumentId,
  requestedPath,
  activeRoleWorkingDirectory,
  existingDocument,
  reason,
}: {
  toolName: string;
  requestedDocumentId?: string | null;
  requestedPath?: string | null;
  activeRoleWorkingDirectory?: string | null;
  existingDocument?: AgentDocumentPathMeta | null;
  reason: string;
}) => ({
  saved: false,
  verified: false,
  blocked: true,
  scope: AGENT_DOCUMENT_WRITE_SCOPE,
  toolName,
  requestedDocumentId: requestedDocumentId ?? existingDocument?.id ?? null,
  requestedPath: requestedPath ?? null,
  activeRoleWorkingDirectory: activeRoleWorkingDirectory ?? null,
  existingDocument: existingDocument
    ? {
        id: existingDocument.id,
        title: existingDocument.title,
        path: existingDocument.path,
      }
    : null,
  reason,
  guidance:
    "Read tools may inspect any project Markdown document, but document mutation tools may affect only existing ordinary output documents under harness.resourcePolicy.activeRoleWorkingDirectory. The Agent may not create Markdown documents; ask the creator to create the target document manually, then retry with a fresh operationId. Do not mutate role metadocs, PrimeDirective.md, or documents outside the active working directory.",
});

export type AgentDocumentWriteScopeBlockedResult = ReturnType<typeof createAgentDocumentWriteScopeBlockedResult>;

export const validateExistingAgentDocumentWriteScope = ({
  toolName,
  document,
  requestedPath,
  activeRoleWorkingDirectory,
}: {
  toolName: string;
  document: AgentDocumentPathMeta;
  requestedPath?: string | null;
  activeRoleWorkingDirectory?: string | null;
}): AgentDocumentWriteScopeBlockedResult | null => {
  if (!activeRoleWorkingDirectory?.trim()) {
    return createAgentDocumentWriteScopeBlockedResult({
      toolName,
      requestedDocumentId: document.id,
      requestedPath,
      activeRoleWorkingDirectory,
      existingDocument: document,
      reason: "The active role does not have a configured working directory, so document writes are disabled.",
    });
  }
  if (!isAgentDocumentPathUnderDirectory(document.path, activeRoleWorkingDirectory)) {
    return createAgentDocumentWriteScopeBlockedResult({
      toolName,
      requestedDocumentId: document.id,
      requestedPath,
      activeRoleWorkingDirectory,
      existingDocument: document,
      reason:
        `Document ${document.id} is outside the active role working directory (${activeRoleWorkingDirectory}).`,
    });
  }
  const normalizedRequestedPath =
    typeof requestedPath === "string" && requestedPath.trim().length > 0
      ? normalizeAgentDocumentToolPath(requestedPath)
      : null;
  if (
    normalizedRequestedPath &&
    normalizedRequestedPath.toLowerCase() !== normalizeAgentDocumentToolPath(document.path).toLowerCase()
  ) {
    return createAgentDocumentWriteScopeBlockedResult({
      toolName,
      requestedDocumentId: document.id,
      requestedPath,
      activeRoleWorkingDirectory,
      existingDocument: document,
      reason:
        "Document mutation tools cannot move or rename document paths. Rename or move documents through project-controlled UI/backend operations, then write only to the existing working-dir document path.",
    });
  }
  return null;
};
