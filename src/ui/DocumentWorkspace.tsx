import { useEffect, useMemo, useState, type FormEvent, type MouseEvent, type ReactNode } from "react";
import { deleteProjectDocument, readProjectDocument, writeProjectDocument } from "../agent/documents";
import {
  AGENT_DOCUMENT_ROLE_VALUES,
  type AgentDocument,
  type AgentDocumentMeta,
  type AgentDocumentRole,
} from "../agent/documentSchema";
import { getAgentRoleLabel, type AgentRoleDefinition } from "../agent/roles";

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
} | null;

type NewDocumentDraft = {
  title: string;
  role: AgentDocumentRole | "";
  path: string;
  summary: string;
};

type RenameDocumentDraft = {
  documentId: string;
  title: string;
  path: string;
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

const defaultDocumentPath = (role: AgentDocumentRole | "", documentId: string) =>
  `docs/${slugifyDocumentPart(role || "general", "role")}/${slugifyDocumentPart(documentId, "document")}.md`;

const normalizeNewDocumentPath = (path: string, role: AgentDocumentRole | "", documentId: string) => {
  const trimmed = path.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  if (!trimmed) {
    return defaultDocumentPath(role, documentId);
  }
  const underDocs = trimmed.startsWith("docs/") ? trimmed : `docs/${trimmed}`;
  return underDocs.toLowerCase().endsWith(".md") ? underDocs : `${underDocs}.md`;
};

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
  const [error, setError] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<DocumentContextMenuState>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [newDocument, setNewDocument] = useState<NewDocumentDraft>({
    title: "",
    role: "",
    path: "",
    summary: "",
  });
  const [renameDraft, setRenameDraft] = useState<RenameDocumentDraft | null>(null);
  const dirty = Boolean(document && content !== document.content);

  const sortedDocuments = useMemo(
    () =>
      [...documents].sort((left, right) => {
        const leftPath = left.path.toLowerCase();
        const rightPath = right.path.toLowerCase();
        return leftPath.localeCompare(rightPath);
      }),
    [documents],
  );
  const roleByMetadocId = useMemo(
    () => new Map(roles.map((role) => [role.metadocId, role])),
    [roles],
  );

  useEffect(() => {
    let active = true;
    setMode("preview");
    if (!documentId) {
      setDocument(null);
      setContent("");
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    void readProjectDocument(projectId, documentId)
      .then((nextDocument) => {
        if (!active) {
          return;
        }
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
  }, [documentId, projectId]);

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
    window.addEventListener("scroll", closeContextMenu, true);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("click", closeContextMenu);
      window.removeEventListener("resize", closeContextMenu);
      window.removeEventListener("scroll", closeContextMenu, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [contextMenu]);

  const contextDocument =
    contextMenu?.documentId
      ? sortedDocuments.find((entry) => entry.id === contextMenu.documentId) ?? null
      : null;

  const openDocumentContextMenu = (
    event: MouseEvent<HTMLElement>,
    targetDocumentId: string | null,
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
    });
  };

  const openCreateDialog = (role: AgentDocumentRole | "" = "") => {
    setContextMenu(null);
    setError(null);
    setNewDocument({
      title: "",
      role,
      path: "",
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
      path: target.path,
    });
    setRenameDialogOpen(true);
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
      setError("Document title is required.");
      return;
    }
    const id = createUniqueDocumentId(title, documents);
    const path = normalizeNewDocumentPath(newDocument.path, newDocument.role, id);
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
      setError("Document title is required.");
      return;
    }
    const path = normalizeNewDocumentPath(renameDraft.path, target.role ?? "", target.id);
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

  const contextMenuNode = contextMenu ? (
    <div
      className="document-context-menu"
      role="menu"
      style={{ left: contextMenu.x, top: contextMenu.y }}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      <button
        type="button"
        role="menuitem"
        onClick={() => openCreateDialog(contextDocument?.role ?? "")}
      >
        New document
      </button>
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
          <span>Title</span>
          <input
            id="new-document-title"
            aria-label="New document title"
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
        <label htmlFor="new-document-path">
          <span>Path</span>
          <input
            id="new-document-path"
            aria-label="New document path"
            placeholder={defaultDocumentPath(
              newDocument.role,
              createUniqueDocumentId(newDocument.title || "document", documents),
            )}
            value={newDocument.path}
            onChange={(event) => {
              const path = event.currentTarget.value;
              setNewDocument((current) => ({
                ...current,
                path,
              }));
            }}
          />
        </label>
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
          <span>Title</span>
          <input
            id="rename-document-title"
            aria-label="Rename document title"
            value={renameDraft.title}
            autoFocus
            onChange={(event) => {
              const title = event.currentTarget.value;
              setRenameDraft((current) => (current ? { ...current, title } : current));
            }}
          />
        </label>
        <label htmlFor="rename-document-path">
          <span>Path</span>
          <input
            id="rename-document-path"
            aria-label="Rename document path"
            value={renameDraft.path}
            onChange={(event) => {
              const path = event.currentTarget.value;
              setRenameDraft((current) => (current ? { ...current, path } : current));
            }}
          />
        </label>
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
              renameDraft.title.trim().length === 0 ||
              renameDraft.path.trim().length === 0
            }
          >
            {renamingDocumentId === renameDraft.documentId ? "Renaming..." : "Rename"}
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
        <header className="document-toolbar">
          <div>
            <p className="eyebrow">Documents</p>
            <h2>Project document files</h2>
            <p className="document-meta">Open a Markdown file to view the rendered document. Right-click to create, rename, or delete docs.</p>
          </div>
        </header>
        <div className="document-file-browser" aria-label="Project document files">
          {sortedDocuments.length === 0 ? (
            <div className="document-empty">
              <h3>No Markdown documents</h3>
              <p>The project document manifest has not been created yet.</p>
            </div>
          ) : (
            sortedDocuments.map((entry) => {
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
