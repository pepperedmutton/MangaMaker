import { useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent, type ReactNode } from "react";
import {
  deleteProjectDocument,
  deleteProjectWorkingDirectory,
  readProjectDocument,
  renameProjectWorkingDirectory,
  writeProjectDocument,
} from "../agent/documents";
import {
  AGENT_DOCUMENT_ROLE_VALUES,
  createUniqueAgentDocumentPathFromTitle,
  normalizeAgentDocumentDirectoryPath,
  normalizeAgentDocumentFileStem,
  type AgentDocument,
  type AgentDocumentMeta,
  type AgentDocumentRole,
} from "../agent/documentSchema";
import {
  getAgentRoleLabel,
  getAgentRoleWorkingDirectory,
  type AgentRoleDefinition,
} from "../agent/roles";

type DocumentWorkspaceProps = {
  projectId: string;
  documents: AgentDocumentMeta[];
  roles?: AgentRoleDefinition[];
  documentId: string | null;
  onSelectDocument: (documentId: string | null) => void;
  onDocumentSaved: () => void | Promise<void>;
};

type DocumentViewMode = "preview" | "edit";

type DocumentContextMenuState = {
  x: number;
  y: number;
  documentId: string | null;
  directoryPath: string | null;
} | null;

const DOCUMENT_CONTEXT_MENU_MARGIN = 8;

const clampNumber = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

type NewDocumentDraft = {
  title: string;
  role: AgentDocumentRole | "";
  directory: string;
  summary: string;
};

type RenameDocumentDraft = {
  documentId: string;
  title: string;
};

type RenameWorkingDirectoryDraft = {
  directoryPath: string;
  name: string;
};

type MarkdownBlock =
  | {
      kind: "heading";
      level: 1 | 2 | 3 | 4;
      text: string;
    }
  | {
      kind: "paragraph";
      text: string;
    }
  | {
      kind: "unorderedList";
      items: string[];
    }
  | {
      kind: "orderedList";
      items: string[];
    }
  | {
      kind: "taskList";
      items: Array<{ checked: boolean; text: string }>;
    }
  | {
      kind: "blockquote";
      text: string;
    }
  | {
      kind: "code";
      language: string | null;
      text: string;
    }
  | {
      kind: "table";
      headers: string[];
      rows: string[][];
    }
  | {
      kind: "rule";
    };

const getDocumentFileName = (path: string) => path.split(/[\\/]/).pop() ?? path;

const getDocumentDirectory = (path: string) => {
  const parts = path.split(/[\\/]/);
  parts.pop();
  return parts.join("/") || ".";
};

const getDirectoryName = (path: string) => {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts.at(-1) ?? path;
};

const documentPathIsUnderDirectory = (documentPath: string, directoryPath: string) =>
  documentPath
    .replace(/\\/g, "/")
    .toLowerCase()
    .startsWith(`${directoryPath.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase()}/`);

const isEditableTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  Boolean(target.closest("input, textarea, select, [contenteditable='true']"));

const slugifyDocumentPart = (value: string, fallback: string) => {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || fallback;
};

const createUniqueDocumentId = (title: string, documents: AgentDocumentMeta[]) => {
  const base = slugifyDocumentPart(title, "document");
  const usedIds = new Set(documents.map((entry) => entry.id));
  let candidate = base;
  let index = 2;
  while (usedIds.has(candidate)) {
    candidate = `${base}-${index}`;
    index += 1;
  }
  return candidate;
};

const defaultDocumentDirectory = (role: AgentDocumentRole | "") =>
  `docs/${slugifyDocumentPart(role || "general", "role")}`;

const defaultDocumentPath = (
  role: AgentDocumentRole | "",
  title: string,
  documents: AgentDocumentMeta[],
  documentId?: string,
  directory?: string,
) =>
  createUniqueAgentDocumentPathFromTitle(
    title,
    directory?.trim() || defaultDocumentDirectory(role),
    documents,
    documentId,
    documentId || "document",
  );

const parseTableRow = (line: string) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());

const isTableSeparator = (line: string) => {
  const cells = parseTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
};

const startsSpecialBlock = (lines: string[], index: number) => {
  const line = lines[index] ?? "";
  const trimmed = line.trim();
  if (!trimmed) {
    return true;
  }
  if (/^```/.test(line) || /^#{1,4}\s+/.test(line) || /^-{3,}$/.test(trimmed)) {
    return true;
  }
  if (/^>\s?/.test(line) || /^[-*]\s+\[( |x|X)\]\s+/.test(line)) {
    return true;
  }
  if (/^[-*]\s+/.test(line) || /^\d+\.\s+/.test(line)) {
    return true;
  }
  return Boolean(lines[index + 1] && line.includes("|") && isTableSeparator(lines[index + 1]));
};

const parseMarkdownBlocks = (content: string): MarkdownBlock[] => {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    const codeFence = line.match(/^```\s*([\w-]+)?\s*$/);
    if (codeFence) {
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index] ?? "")) {
        codeLines.push(lines[index] ?? "");
        index += 1;
      }
      if (index < lines.length) {
        index += 1;
      }
      blocks.push({
        kind: "code",
        language: codeFence[1] ?? null,
        text: codeLines.join("\n"),
      });
      continue;
    }

    if (line.includes("|") && lines[index + 1] && isTableSeparator(lines[index + 1])) {
      const headers = parseTableRow(line);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && lines[index]?.includes("|")) {
        rows.push(parseTableRow(lines[index] ?? ""));
        index += 1;
      }
      blocks.push({ kind: "table", headers, rows });
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      blocks.push({
        kind: "heading",
        level: heading[1].length as 1 | 2 | 3 | 4,
        text: heading[2],
      });
      index += 1;
      continue;
    }

    if (/^-{3,}$/.test(trimmed)) {
      blocks.push({ kind: "rule" });
      index += 1;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index] ?? "")) {
        quoteLines.push((lines[index] ?? "").replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push({ kind: "blockquote", text: quoteLines.join("\n") });
      continue;
    }

    if (/^[-*]\s+\[( |x|X)\]\s+/.test(line)) {
      const items: Array<{ checked: boolean; text: string }> = [];
      while (index < lines.length) {
        const task = (lines[index] ?? "").match(/^[-*]\s+\[( |x|X)\]\s+(.+)$/);
        if (!task) {
          break;
        }
        items.push({ checked: task[1].toLowerCase() === "x", text: task[2] });
        index += 1;
      }
      blocks.push({ kind: "taskList", items });
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length) {
        const item = (lines[index] ?? "").match(/^[-*]\s+(.+)$/);
        if (!item) {
          break;
        }
        items.push(item[1]);
        index += 1;
      }
      blocks.push({ kind: "unorderedList", items });
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length) {
        const item = (lines[index] ?? "").match(/^\d+\.\s+(.+)$/);
        if (!item) {
          break;
        }
        items.push(item[1]);
        index += 1;
      }
      blocks.push({ kind: "orderedList", items });
      continue;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length && !startsSpecialBlock(lines, index)) {
      paragraphLines.push(lines[index] ?? "");
      index += 1;
    }
    if (paragraphLines.length === 0) {
      paragraphLines.push(line);
      index += 1;
    }
    blocks.push({ kind: "paragraph", text: paragraphLines.join(" ") });
  }

  return blocks;
};

const normalizeSafeHref = (href: string) =>
  /^(https?:|mailto:)/i.test(href) ? href : null;

const renderInlineMarkdown = (text: string): ReactNode[] => {
  const nodes: ReactNode[] = [];
  const pattern = /(\[([^\]]+)\]\(([^)\s]+)\)|`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*)/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) {
      nodes.push(text.slice(cursor, match.index));
    }
    const key = `${match.index}-${match[0]}`;
    if (match[2] && match[3]) {
      const safeHref = normalizeSafeHref(match[3]);
      nodes.push(
        safeHref ? (
          <a key={key} href={safeHref} target="_blank" rel="noreferrer">
            {match[2]}
          </a>
        ) : (
          <span key={key}>{match[2]}</span>
        ),
      );
    } else if (match[4]) {
      nodes.push(<code key={key}>{match[4]}</code>);
    } else if (match[5]) {
      nodes.push(<strong key={key}>{match[5]}</strong>);
    } else if (match[6]) {
      nodes.push(<em key={key}>{match[6]}</em>);
    }
    cursor = match.index + match[0].length;
  }

  if (cursor < text.length) {
    nodes.push(text.slice(cursor));
  }

  return nodes.length > 0 ? nodes : [text];
};

const MarkdownViewer = ({ content }: { content: string }) => {
  const blocks = useMemo(() => parseMarkdownBlocks(content), [content]);
  return (
    <article className="document-viewer" aria-label="Rendered Markdown document">
      {blocks.map((block, index) => {
        const key = `${block.kind}-${index}`;
        if (block.kind === "heading") {
          if (block.level === 1) {
            return <h1 key={key}>{renderInlineMarkdown(block.text)}</h1>;
          }
          if (block.level === 2) {
            return <h2 key={key}>{renderInlineMarkdown(block.text)}</h2>;
          }
          if (block.level === 3) {
            return <h3 key={key}>{renderInlineMarkdown(block.text)}</h3>;
          }
          return <h4 key={key}>{renderInlineMarkdown(block.text)}</h4>;
        }
        if (block.kind === "paragraph") {
          return <p key={key}>{renderInlineMarkdown(block.text)}</p>;
        }
        if (block.kind === "unorderedList") {
          return (
            <ul key={key}>
              {block.items.map((item, itemIndex) => (
                <li key={`${key}-${itemIndex}`}>{renderInlineMarkdown(item)}</li>
              ))}
            </ul>
          );
        }
        if (block.kind === "orderedList") {
          return (
            <ol key={key}>
              {block.items.map((item, itemIndex) => (
                <li key={`${key}-${itemIndex}`}>{renderInlineMarkdown(item)}</li>
              ))}
            </ol>
          );
        }
        if (block.kind === "taskList") {
          return (
            <ul key={key} className="document-task-list">
              {block.items.map((item, itemIndex) => (
                <li key={`${key}-${itemIndex}`}>
                  <input type="checkbox" checked={item.checked} readOnly />
                  <span>{renderInlineMarkdown(item.text)}</span>
                </li>
              ))}
            </ul>
          );
        }
        if (block.kind === "blockquote") {
          return (
            <blockquote key={key}>
              {block.text.split("\n").map((line, lineIndex) => (
                <p key={`${key}-${lineIndex}`}>{renderInlineMarkdown(line)}</p>
              ))}
            </blockquote>
          );
        }
        if (block.kind === "code") {
          return (
            <pre key={key}>
              {block.language ? <span className="document-code-language">{block.language}</span> : null}
              <code>{block.text}</code>
            </pre>
          );
        }
        if (block.kind === "table") {
          return (
            <div key={key} className="document-table-wrap">
              <table>
                <thead>
                  <tr>
                    {block.headers.map((header, headerIndex) => (
                      <th key={`${key}-head-${headerIndex}`}>{renderInlineMarkdown(header)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row, rowIndex) => (
                    <tr key={`${key}-row-${rowIndex}`}>
                      {block.headers.map((_, cellIndex) => (
                        <td key={`${key}-row-${rowIndex}-${cellIndex}`}>
                          {renderInlineMarkdown(row[cellIndex] ?? "")}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        return <hr key={key} />;
      })}
    </article>
  );
};

export const DocumentWorkspace = ({
  projectId,
  documents,
  roles = [],
  documentId,
  onSelectDocument,
  onDocumentSaved,
}: DocumentWorkspaceProps) => {
  const [document, setDocument] = useState<AgentDocument | null>(null);
  const [content, setContent] = useState("");
  const [mode, setMode] = useState<DocumentViewMode>("preview");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [renamingDocumentId, setRenamingDocumentId] = useState<string | null>(null);
  const [deletingDocumentId, setDeletingDocumentId] = useState<string | null>(null);
  const [renamingDirectoryPath, setRenamingDirectoryPath] = useState<string | null>(null);
  const [deletingDirectoryPath, setDeletingDirectoryPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<DocumentContextMenuState>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renameDirectoryDialogOpen, setRenameDirectoryDialogOpen] = useState(false);
  const [expandedDirectoryPaths, setExpandedDirectoryPaths] = useState<Set<string>>(() => new Set());
  const [newDocument, setNewDocument] = useState<NewDocumentDraft>({
    title: "",
    role: "",
    directory: "",
    summary: "",
  });
  const [renameDraft, setRenameDraft] = useState<RenameDocumentDraft | null>(null);
  const [renameDirectoryDraft, setRenameDirectoryDraft] = useState<RenameWorkingDirectoryDraft | null>(null);
  const dirty = Boolean(document && content !== document.content);
  const dirtyRef = useRef(false);
  const loadedDocumentIdRef = useRef<string | null>(null);
  const loadedDocumentRevisionRef = useRef<string | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);

  const sortedDocuments = useMemo(
    () =>
      [...documents].sort((left, right) => {
        const leftPath = left.path.toLowerCase();
        const rightPath = right.path.toLowerCase();
        return leftPath.localeCompare(rightPath);
      }),
    [documents],
  );
  const workingDirectoryRows = useMemo(() => {
    const directoryByPath = new Map<string, { path: string; roles: AgentRoleDefinition[] }>();
    for (const role of roles) {
      const path = getAgentRoleWorkingDirectory(role);
      const key = path.toLowerCase();
      const current = directoryByPath.get(key);
      if (current) {
        current.roles.push(role);
      } else {
        directoryByPath.set(key, { path, roles: [role] });
      }
    }
    return Array.from(directoryByPath.values()).sort((left, right) =>
      left.path.toLowerCase().localeCompare(right.path.toLowerCase()),
    );
  }, [roles]);
  const roleByMetadocId = useMemo(
    () => new Map(roles.map((role) => [role.metadocId, role])),
    [roles],
  );
  const workingDirectoryDocuments = useMemo(() => {
    const entries = new Map<string, AgentDocumentMeta[]>();
    for (const { path } of workingDirectoryRows) {
      entries.set(path, sortedDocuments.filter((document) => documentPathIsUnderDirectory(document.path, path)));
    }
    return entries;
  }, [sortedDocuments, workingDirectoryRows]);
  const documentsInWorkingDirectories = useMemo(() => {
    const ids = new Set<string>();
    for (const directoryDocuments of workingDirectoryDocuments.values()) {
      for (const document of directoryDocuments) {
        ids.add(document.id);
      }
    }
    return ids;
  }, [workingDirectoryDocuments]);
  const fileBrowserEntries = useMemo(
    () =>
      [
        ...workingDirectoryRows.map((entry) => ({
          kind: "directory" as const,
          sortPath: `${entry.path}/`,
          entry,
        })),
        ...sortedDocuments
          .filter((entry) => !documentsInWorkingDirectories.has(entry.id))
          .map((entry) => ({
          kind: "document" as const,
          sortPath: entry.path,
          entry,
        })),
      ].sort((left, right) => left.sortPath.toLowerCase().localeCompare(right.sortPath.toLowerCase())),
    [documentsInWorkingDirectories, sortedDocuments, workingDirectoryRows],
  );
  const selectedDocumentMeta = useMemo(
    () => documents.find((entry) => entry.id === documentId) ?? null,
    [documentId, documents],
  );
  const selectedDocumentRevision = selectedDocumentMeta
    ? [
        selectedDocumentMeta.id,
        selectedDocumentMeta.updatedAt,
        selectedDocumentMeta.path,
        selectedDocumentMeta.title,
        selectedDocumentMeta.summary ?? "",
        selectedDocumentMeta.lastAgentRunId ?? "",
      ].join("\u0000")
    : "";

  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  useEffect(() => {
    let active = true;
    const sameOpenDocument = loadedDocumentIdRef.current === documentId;
    if (!documentId) {
      loadedDocumentIdRef.current = null;
      loadedDocumentRevisionRef.current = null;
      setDocument(null);
      setContent("");
      setError(null);
      setLoading(false);
      return;
    }
    if (
      sameOpenDocument &&
      dirtyRef.current &&
      loadedDocumentRevisionRef.current &&
      loadedDocumentRevisionRef.current !== selectedDocumentRevision
    ) {
      setError("This document changed on disk, but the editor has unsaved local edits. Save or reopen the file to load the latest version.");
      return;
    }
    if (!sameOpenDocument) {
      setMode("preview");
    }
    setLoading(true);
    setError(null);
    void readProjectDocument(projectId, documentId)
      .then((nextDocument) => {
        if (!active) {
          return;
        }
        loadedDocumentIdRef.current = documentId;
        loadedDocumentRevisionRef.current = selectedDocumentRevision;
        setDocument(nextDocument);
        setContent(nextDocument.content);
      })
      .catch((loadError) => {
        if (!active) {
          return;
        }
        setError(loadError instanceof Error ? loadError.message : String(loadError));
        setDocument(null);
        setContent("");
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [documentId, projectId, selectedDocumentRevision]);

  useEffect(() => {
    if (!contextMenu) {
      return;
    }
    const closeContextMenu = () => setContextMenu(null);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeContextMenu();
      }
    };
    window.addEventListener("click", closeContextMenu);
    window.addEventListener("resize", closeContextMenu);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("click", closeContextMenu);
      window.removeEventListener("resize", closeContextMenu);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [contextMenu]);

  useEffect(() => {
    setExpandedDirectoryPaths((current) => {
      let changed = false;
      const next = new Set(current);
      for (const [directoryPath, directoryDocuments] of workingDirectoryDocuments) {
        if (directoryDocuments.length > 0 && !next.has(directoryPath)) {
          next.add(directoryPath);
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [workingDirectoryDocuments]);

  useEffect(() => {
    if (!contextMenu || !contextMenuRef.current) {
      return;
    }
    const menuRect = contextMenuRef.current.getBoundingClientRect();
    const maxLeft = Math.max(
      DOCUMENT_CONTEXT_MENU_MARGIN,
      window.innerWidth - menuRect.width - DOCUMENT_CONTEXT_MENU_MARGIN,
    );
    const maxTop = Math.max(
      DOCUMENT_CONTEXT_MENU_MARGIN,
      window.innerHeight - menuRect.height - DOCUMENT_CONTEXT_MENU_MARGIN,
    );
    const nextX = clampNumber(contextMenu.x, DOCUMENT_CONTEXT_MENU_MARGIN, maxLeft);
    const opensDown = contextMenu.y + menuRect.height <= window.innerHeight - DOCUMENT_CONTEXT_MENU_MARGIN;
    const opensUp = contextMenu.y - menuRect.height >= DOCUMENT_CONTEXT_MENU_MARGIN;
    const nextY = opensDown
      ? contextMenu.y
      : opensUp
        ? contextMenu.y - menuRect.height
        : clampNumber(contextMenu.y, DOCUMENT_CONTEXT_MENU_MARGIN, maxTop);
    if (Math.abs(nextX - contextMenu.x) > 0.5 || Math.abs(nextY - contextMenu.y) > 0.5) {
      setContextMenu({ ...contextMenu, x: nextX, y: nextY });
    }
  }, [contextMenu]);

  const contextDocument =
    contextMenu?.documentId
      ? sortedDocuments.find((entry) => entry.id === contextMenu.documentId) ?? null
      : null;
  const contextDirectoryPath = contextMenu?.directoryPath ?? "";

  const openDocumentContextMenu = (
    event: MouseEvent<HTMLElement>,
    targetDocumentId: string | null,
    targetDirectoryPath: string | null = null,
  ) => {
    if (isEditableTarget(event.target)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      documentId: targetDocumentId,
      directoryPath: targetDirectoryPath,
    });
  };

  const openCreateDialog = (
    role: AgentDocumentRole | "" = "",
    directory = "",
  ) => {
    setContextMenu(null);
    setError(null);
    setNewDocument({
      title: "",
      role,
      directory,
      summary: "",
    });
    setCreateDialogOpen(true);
  };

  const openRenameDialog = (targetDocumentId: string) => {
    const target = documents.find((entry) => entry.id === targetDocumentId);
    if (!target) {
      setError(`Document not found: ${targetDocumentId}`);
      return;
    }
    setContextMenu(null);
    setError(null);
    setRenameDraft({
      documentId: target.id,
      title: target.title,
    });
    setRenameDialogOpen(true);
  };

  const openRenameDirectoryDialog = (targetDirectoryPath: string) => {
    setContextMenu(null);
    setError(null);
    setRenameDirectoryDraft({
      directoryPath: targetDirectoryPath,
      name: getDirectoryName(targetDirectoryPath),
    });
    setRenameDirectoryDialogOpen(true);
  };

  const toggleWorkingDirectory = (targetDirectoryPath: string) => {
    setExpandedDirectoryPaths((current) => {
      const next = new Set(current);
      if (next.has(targetDirectoryPath)) {
        next.delete(targetDirectoryPath);
      } else {
        next.add(targetDirectoryPath);
      }
      return next;
    });
  };

  const saveDocument = async () => {
    if (!document) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const saved = await writeProjectDocument(projectId, {
        ...document,
        content,
        expectedUpdatedAt: document.updatedAt,
      });
      setDocument(saved);
      setContent(saved.content);
      setMode("preview");
      await onDocumentSaved();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  };

  const createDocument = async (event: FormEvent) => {
    event.preventDefault();
    const title = newDocument.title.trim();
    if (!title) {
      setError("Document name is required.");
      return;
    }
    const id = createUniqueDocumentId(title, documents);
    const path = defaultDocumentPath(
      newDocument.role,
      title,
      documents,
      id,
      newDocument.directory,
    );
    if (documents.some((entry) => entry.path.toLowerCase() === path.toLowerCase())) {
      setError(`A document already uses ${path}.`);
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const created = await writeProjectDocument(projectId, {
        id,
        title,
        ...(newDocument.role ? { role: newDocument.role } : {}),
        status: "draft",
        path,
        relatedPageIds: [],
        summary: newDocument.summary.trim() || undefined,
        content: `# ${title}\n\n`,
      });
      setDocument(created);
      setContent(created.content);
      setMode("preview");
      onSelectDocument(created.id);
      await onDocumentSaved();
      setCreateDialogOpen(false);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : String(createError));
    } finally {
      setCreating(false);
    }
  };

  const renameDocumentFile = async (event: FormEvent) => {
    event.preventDefault();
    if (!renameDraft) {
      return;
    }
    const target = documents.find((entry) => entry.id === renameDraft.documentId);
    if (!target) {
      setError(`Document not found: ${renameDraft.documentId}`);
      return;
    }
    const title = renameDraft.title.trim();
    if (!title) {
      setError("Document name is required.");
      return;
    }
    const path = defaultDocumentPath(
      target.role ?? "",
      title,
      documents,
      target.id,
      getDocumentDirectory(target.path),
    );
    if (
      documents.some(
        (entry) => entry.id !== target.id && entry.path.toLowerCase() === path.toLowerCase(),
      )
    ) {
      setError(`A document already uses ${path}.`);
      return;
    }
    setRenamingDocumentId(target.id);
    setError(null);
    try {
      const isOpenDocument = document?.id === target.id;
      const source = isOpenDocument && document
        ? document
        : await readProjectDocument(projectId, target.id);
      const saved = await writeProjectDocument(projectId, {
        ...source,
        title,
        path,
        content: isOpenDocument ? content : source.content,
        expectedUpdatedAt: source.updatedAt,
      });
      setDocument(saved);
      setContent(saved.content);
      setMode("preview");
      onSelectDocument(saved.id);
      await onDocumentSaved();
      setRenameDialogOpen(false);
      setRenameDraft(null);
    } catch (renameError) {
      setError(renameError instanceof Error ? renameError.message : String(renameError));
    } finally {
      setRenamingDocumentId(null);
    }
  };

  const renameWorkingDirectory = async (event: FormEvent) => {
    event.preventDefault();
    if (!renameDirectoryDraft) {
      return;
    }
    const name = renameDirectoryDraft.name.trim();
    if (!name) {
      setError("Working directory name is required.");
      return;
    }
    const parentDirectory = getDocumentDirectory(renameDirectoryDraft.directoryPath);
    const directoryName = normalizeAgentDocumentFileStem(
      name,
      getDirectoryName(renameDirectoryDraft.directoryPath),
    );
    const nextDirectoryPath = normalizeAgentDocumentDirectoryPath(`${parentDirectory}/${directoryName}`);
    setRenamingDirectoryPath(renameDirectoryDraft.directoryPath);
    setError(null);
    try {
      await renameProjectWorkingDirectory(
        projectId,
        renameDirectoryDraft.directoryPath,
        nextDirectoryPath,
      );
      await onDocumentSaved();
      setRenameDirectoryDialogOpen(false);
      setRenameDirectoryDraft(null);
    } catch (renameError) {
      setError(renameError instanceof Error ? renameError.message : String(renameError));
    } finally {
      setRenamingDirectoryPath(null);
    }
  };

  const deleteDocument = async (targetDocumentId: string) => {
    const target = documents.find((entry) => entry.id === targetDocumentId);
    if (!target) {
      setError(`Document not found: ${targetDocumentId}`);
      return;
    }
    setContextMenu(null);
    const confirmed = window.confirm(
      `Delete "${target.title}"?\n\nThis removes ${target.path} from the project documents.`,
    );
    if (!confirmed) {
      return;
    }
    setDeletingDocumentId(targetDocumentId);
    setError(null);
    try {
      await deleteProjectDocument(projectId, targetDocumentId);
      if (documentId === targetDocumentId) {
        setDocument(null);
        setContent("");
        onSelectDocument(null);
      }
      await onDocumentSaved();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : String(deleteError));
    } finally {
      setDeletingDocumentId(null);
    }
  };

  const deleteWorkingDirectory = async (targetDirectoryPath: string) => {
    setContextMenu(null);
    const affectedDocuments = documents.filter((entry) =>
      documentPathIsUnderDirectory(entry.path, targetDirectoryPath),
    );
    const affectedRoles =
      workingDirectoryRows.find((entry) => entry.path === targetDirectoryPath)?.roles ?? [];
    const confirmed = window.confirm(
      [
        `Delete working directory "${targetDirectoryPath}"?`,
        "",
        affectedRoles.length > 0
          ? `This removes ${affectedRoles.length} role binding(s): ${affectedRoles.map((role) => role.name).join(", ")}. Their metadocs are preserved as ordinary documents.`
          : "No role binding uses this directory.",
        affectedDocuments.length > 0
          ? `This also deletes ${affectedDocuments.length} Markdown document(s) under the directory.`
          : "No Markdown documents are registered under the directory.",
      ].join("\n"),
    );
    if (!confirmed) {
      return;
    }
    setDeletingDirectoryPath(targetDirectoryPath);
    setError(null);
    try {
      await deleteProjectWorkingDirectory(projectId, targetDirectoryPath);
      if (selectedDocumentMeta && documentPathIsUnderDirectory(selectedDocumentMeta.path, targetDirectoryPath)) {
        setDocument(null);
        setContent("");
        onSelectDocument(null);
      }
      await onDocumentSaved();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : String(deleteError));
    } finally {
      setDeletingDirectoryPath(null);
    }
  };

  const contextMenuNode = contextMenu ? (
    <div
      ref={contextMenuRef}
      className="document-context-menu"
      role="menu"
      style={{ left: contextMenu.x, top: contextMenu.y }}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      <button
        type="button"
        role="menuitem"
        onClick={() => openCreateDialog(contextDocument?.role ?? "", contextDirectoryPath)}
      >
        New document
      </button>
      {contextDirectoryPath ? (
        <>
          <button
            type="button"
            role="menuitem"
            disabled={renamingDirectoryPath === contextDirectoryPath}
            onClick={() => openRenameDirectoryDialog(contextDirectoryPath)}
          >
            Rename working dir
          </button>
          <button
            type="button"
            role="menuitem"
            className="danger"
            disabled={deletingDirectoryPath === contextDirectoryPath}
            onClick={() => void deleteWorkingDirectory(contextDirectoryPath)}
          >
            Delete working dir
          </button>
        </>
      ) : null}
      {contextDocument ? (
        <>
          <button
            type="button"
            role="menuitem"
            disabled={renamingDocumentId === contextDocument.id}
            onClick={() => openRenameDialog(contextDocument.id)}
          >
            Rename document
          </button>
          <button
            type="button"
            role="menuitem"
            className="danger"
            disabled={deletingDocumentId === contextDocument.id}
            onClick={() => void deleteDocument(contextDocument.id)}
          >
            Delete document
          </button>
        </>
      ) : null}
    </div>
  ) : null;

  const createDialogNode = createDialogOpen ? (
    <div className="document-dialog-backdrop">
      <form
        className="document-dialog"
        role="dialog"
        aria-label="New Markdown document"
        onSubmit={(event) => void createDocument(event)}
      >
        <h3>New Markdown document</h3>
        <label htmlFor="new-document-title">
          <span>Name</span>
          <input
            id="new-document-title"
            aria-label="New document name"
            value={newDocument.title}
            autoFocus
            onChange={(event) => {
              const title = event.currentTarget.value;
              setNewDocument((current) => ({
                ...current,
                title,
              }));
            }}
          />
        </label>
        <label htmlFor="new-document-role">
          <span>Role tag</span>
          <select
            id="new-document-role"
            aria-label="New document role"
            value={newDocument.role}
            onChange={(event) => {
              const role = event.currentTarget.value as AgentDocumentRole | "";
              setNewDocument((current) => ({
                ...current,
                role,
              }));
            }}
          >
            <option value="">None</option>
            {AGENT_DOCUMENT_ROLE_VALUES.map((role) => (
              <option key={role} value={role}>
                {getAgentRoleLabel(role, roles)}
              </option>
            ))}
          </select>
        </label>
        <p className="document-meta">
          Folder is assigned by the project. File name is generated from the document name.
        </p>
        <label htmlFor="new-document-summary">
          <span>Summary</span>
          <textarea
            id="new-document-summary"
            aria-label="New document summary"
            rows={3}
            value={newDocument.summary}
            onChange={(event) => {
              const summary = event.currentTarget.value;
              setNewDocument((current) => ({
                ...current,
                summary,
              }));
            }}
          />
        </label>
        <div className="document-dialog-actions">
          <button type="button" disabled={creating} onClick={() => setCreateDialogOpen(false)}>
            Cancel
          </button>
          <button
            type="submit"
            className="primary-button"
            disabled={creating || newDocument.title.trim().length === 0}
          >
            {creating ? "Creating..." : "Create"}
          </button>
        </div>
      </form>
    </div>
  ) : null;

  const renameDialogNode = renameDialogOpen && renameDraft ? (
    <div className="document-dialog-backdrop">
      <form
        className="document-dialog"
        role="dialog"
        aria-label="Rename Markdown document"
        onSubmit={(event) => void renameDocumentFile(event)}
      >
        <h3>Rename Markdown document</h3>
        <label htmlFor="rename-document-title">
          <span>Name</span>
          <input
            id="rename-document-title"
            aria-label="Rename document name"
            value={renameDraft.title}
            autoFocus
            onChange={(event) => {
              const title = event.currentTarget.value;
              setRenameDraft((current) => (current ? { ...current, title } : current));
            }}
          />
        </label>
        <p className="document-meta">
          Folder is assigned by the project. Renaming changes the document name and generated file name only.
        </p>
        <div className="document-dialog-actions">
          <button
            type="button"
            disabled={renamingDocumentId === renameDraft.documentId}
            onClick={() => {
              setRenameDialogOpen(false);
              setRenameDraft(null);
            }}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="primary-button"
            disabled={
              renamingDocumentId === renameDraft.documentId ||
              renameDraft.title.trim().length === 0
            }
          >
            {renamingDocumentId === renameDraft.documentId ? "Renaming..." : "Rename"}
          </button>
        </div>
      </form>
    </div>
  ) : null;

  const renameDirectoryDialogNode = renameDirectoryDialogOpen && renameDirectoryDraft ? (
    <div className="document-dialog-backdrop">
      <form
        className="document-dialog"
        role="dialog"
        aria-label="Rename working directory"
        onSubmit={(event) => void renameWorkingDirectory(event)}
      >
        <h3>Rename working directory</h3>
        <p className="document-meta">
          Parent folder is assigned by the project: {getDocumentDirectory(renameDirectoryDraft.directoryPath)}.
          Renaming changes only the working directory name.
        </p>
        <label htmlFor="rename-working-directory-name">
          <span>Name</span>
          <input
            id="rename-working-directory-name"
            aria-label="Rename working directory name"
            value={renameDirectoryDraft.name}
            autoFocus
            onChange={(event) => {
              const name = event.currentTarget.value;
              setRenameDirectoryDraft((current) =>
                current ? { ...current, name } : current,
              );
            }}
          />
        </label>
        <div className="document-dialog-actions">
          <button
            type="button"
            disabled={renamingDirectoryPath === renameDirectoryDraft.directoryPath}
            onClick={() => {
              setRenameDirectoryDialogOpen(false);
              setRenameDirectoryDraft(null);
            }}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="primary-button"
            disabled={
              renamingDirectoryPath === renameDirectoryDraft.directoryPath ||
              renameDirectoryDraft.name.trim().length === 0
            }
          >
            {renamingDirectoryPath === renameDirectoryDraft.directoryPath ? "Renaming..." : "Rename"}
          </button>
        </div>
      </form>
    </div>
  ) : null;

  if (!documentId) {
    return (
      <section
        className="document-workspace"
        aria-label="Project document workspace"
        onContextMenu={(event) => openDocumentContextMenu(event, null)}
      >
        {contextMenuNode}
        {createDialogNode}
        {renameDialogNode}
        {renameDirectoryDialogNode}
        <header className="document-toolbar">
          <div>
            <p className="eyebrow">Documents</p>
            <h2>Project document files</h2>
            <p className="document-meta">Open a Markdown file to view the rendered document. Right-click to create, rename, or delete docs.</p>
          </div>
        </header>
        <div className="document-file-browser" aria-label="Project document files">
          {fileBrowserEntries.length === 0 ? (
            <div className="document-empty">
              <h3>No Markdown documents</h3>
              <p>The project document manifest has not been created yet.</p>
            </div>
          ) : (
            fileBrowserEntries.map((browserEntry) => {
              if (browserEntry.kind === "directory") {
                const { path, roles: directoryRoles } = browserEntry.entry;
                const directoryDocuments = workingDirectoryDocuments.get(path) ?? [];
                const expanded = expandedDirectoryPaths.has(path);
                return (
                  <div key={`directory-group-${path}`} className="document-directory-group">
                    <button
                      type="button"
                      className="document-file-row document-directory-row"
                      aria-label={`Working directory ${path}`}
                      aria-expanded={expanded}
                      onClick={() => toggleWorkingDirectory(path)}
                      onContextMenu={(event) => openDocumentContextMenu(event, null, path)}
                      title={path}
                    >
                      <span className="document-file-name">
                        <span aria-hidden="true">{expanded ? "[-]" : "[+]"}</span> {getDirectoryName(path)}/
                      </span>
                      <span className="document-file-path">{path}</span>
                      <span className="document-file-meta">
                        Working dir: {directoryRoles.map((role) => role.name).join(", ")} / {directoryDocuments.length} docs
                      </span>
                    </button>
                    {expanded ? (
                      <div className="document-directory-children" role="list">
                        {directoryDocuments.length === 0 ? (
                          <div className="document-file-row document-empty-directory-row" role="listitem">
                            <span className="document-file-name">No Markdown files</span>
                            <span className="document-file-path">{path}</span>
                            <span className="document-file-meta">Right-click the working dir to create one</span>
                          </div>
                        ) : (
                          directoryDocuments.map((entry) => {
                            const metadocRole = roleByMetadocId.get(entry.id);
                            return (
                              <button
                                key={entry.id}
                                type="button"
                                className="document-file-row document-directory-child-row"
                                onClick={() => onSelectDocument(entry.id)}
                                onContextMenu={(event) => openDocumentContextMenu(event, entry.id)}
                                title={entry.path}
                              >
                                <span className="document-file-name">{getDocumentFileName(entry.path)}</span>
                                <span className="document-file-path">{getDocumentDirectory(entry.path)}</span>
                                <span className="document-file-meta">
                                  {metadocRole
                                    ? `Metadoc: ${metadocRole.name}`
                                    : entry.role
                                      ? `${getAgentRoleLabel(entry.role, roles)} tag`
                                      : "Ordinary doc"} / {entry.status}
                                </span>
                              </button>
                            );
                          })
                        )}
                      </div>
                    ) : null}
                  </div>
                );
              }
              const entry = browserEntry.entry;
              const metadocRole = roleByMetadocId.get(entry.id);
              return (
                <button
                  key={entry.id}
                  type="button"
                  className="document-file-row"
                  onClick={() => onSelectDocument(entry.id)}
                  onContextMenu={(event) => openDocumentContextMenu(event, entry.id)}
                  title={entry.path}
                >
                  <span className="document-file-name">{getDocumentFileName(entry.path)}</span>
                  <span className="document-file-path">{getDocumentDirectory(entry.path)}</span>
                  <span className="document-file-meta">
                    {metadocRole
                      ? `Metadoc: ${metadocRole.name}`
                      : entry.role
                        ? `${getAgentRoleLabel(entry.role, roles)} tag`
                        : "Ordinary doc"} / {entry.status}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </section>
    );
  }

  return (
    <section
      className="document-workspace"
      aria-label="Project document workspace"
      onContextMenu={(event) => openDocumentContextMenu(event, documentId)}
    >
      {contextMenuNode}
      {createDialogNode}
      {renameDialogNode}
      {renameDirectoryDialogNode}
      <header className="document-toolbar">
        <div>
          <p className="eyebrow">Markdown</p>
          <h2>{document?.title ?? "Loading document..."}</h2>
          {document ? (
            <p className="document-meta">
              {roleByMetadocId.get(document.id)
                ? `Metadoc: ${roleByMetadocId.get(document.id)?.name}`
                : document.role
                  ? `${getAgentRoleLabel(document.role, roles)} tag`
                  : "Ordinary doc"} / {document.status} / {document.path}
            </p>
          ) : null}
        </div>
        <div className="document-toolbar-actions">
          <button type="button" onClick={() => onSelectDocument(null)}>
            Files
          </button>
          {document ? (
            <button
              type="button"
              onClick={() => setMode((current) => (current === "preview" ? "edit" : "preview"))}
            >
              {mode === "preview" ? "Edit" : "Preview"}
            </button>
          ) : null}
          {mode === "edit" ? (
            <button
              type="button"
              className="primary-button"
              disabled={!document || saving || !dirty}
              onClick={() => void saveDocument()}
            >
              {saving ? "Saving..." : dirty ? "Save" : "Saved"}
            </button>
          ) : null}
        </div>
      </header>
      {error ? <p className="document-error">{error}</p> : null}
      {loading ? <p className="document-loading">Loading document...</p> : null}
      {document && mode === "edit" ? (
        <textarea
          className="document-editor"
          aria-label="Markdown document editor"
          value={content}
          spellCheck={false}
          onChange={(event) => setContent(event.currentTarget.value)}
        />
      ) : null}
      {document && mode === "preview" ? <MarkdownViewer content={content} /> : null}
    </section>
  );
};
