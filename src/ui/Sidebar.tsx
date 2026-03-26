import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import type { Project, ProjectType } from "../domain/schema";
import { useI18n } from "../i18n/useI18n";
import { PageThumbnail } from "./PageThumbnail";

type SidebarProps = {
  project: Project;
  selectedPageId: string | null;
  onSelectPage: (pageId: string) => void;
  onAddPage: (insertAfterPageId?: string) => void;
  onDuplicatePage: (pageId: string) => void;
  onDeletePage: (pageId: string) => void;
  onMovePageUp: (pageId: string) => void;
  onMovePageDown: (pageId: string) => void;
  onRenameProject: (title: string) => void;
  onSetProjectType: (type: ProjectType) => void;
};

type SidebarContextTarget =
  | {
      kind: "sidebar";
    }
  | {
      kind: "page";
      pageId: string;
    };

type SidebarContextMenuState =
  | {
      x: number;
      y: number;
      target: SidebarContextTarget;
    }
  | null;

type SidebarContextAction = {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
};

const SIDEBAR_CONTEXT_MENU_WIDTH = 220;

export const Sidebar = ({
  project,
  selectedPageId,
  onSelectPage,
  onAddPage,
  onDuplicatePage,
  onDeletePage,
  onMovePageUp,
  onMovePageDown,
  onRenameProject,
  onSetProjectType,
}: SidebarProps) => {
  const { t } = useI18n();
  const [titleInput, setTitleInput] = useState(project.title);
  const [contextMenu, setContextMenu] = useState<SidebarContextMenuState>(null);
  const sidebarRef = useRef<HTMLElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setTitleInput(project.title);
  }, [project.title]);

  useEffect(() => {
    if (!contextMenu) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (menuRef.current?.contains(event.target as Node)) {
        return;
      }
      setContextMenu(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setContextMenu(null);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [contextMenu]);

  useEffect(() => {
    setContextMenu((previous) => {
      if (!previous) {
        return previous;
      }
      if (previous.target.kind === "page") {
        const pageId = previous.target.pageId;
        if (!project.pages.some((entry) => entry.id === pageId)) {
          return null;
        }
      }
      return previous;
    });
  }, [project.pages]);

  const commitProjectTitle = () => {
    const nextTitle = titleInput.trim();
    if (nextTitle.length === 0) {
      setTitleInput(project.title);
      return;
    }
    if (nextTitle !== project.title) {
      onRenameProject(nextTitle);
    }
  };

  const openContextMenu = (
    event: ReactMouseEvent<HTMLElement>,
    target: SidebarContextTarget,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const sidebarRect = sidebarRef.current?.getBoundingClientRect();
    if (!sidebarRect) {
      return;
    }
    const x = Math.max(
      8,
      Math.min(event.clientX - sidebarRect.left, sidebarRect.width - SIDEBAR_CONTEXT_MENU_WIDTH - 8),
    );
    const y = Math.max(8, Math.min(event.clientY - sidebarRect.top, sidebarRect.height - 240));
    setContextMenu({ x, y, target });
  };

  const closeContextMenu = () => {
    setContextMenu(null);
  };

  const runMenuAction = (action: () => void) => {
    closeContextMenu();
    action();
  };

  const contextTargetPageId =
    contextMenu?.target.kind === "page" ? contextMenu.target.pageId : selectedPageId;
  const contextTargetPage = contextTargetPageId
    ? project.pages.find((page) => page.id === contextTargetPageId) ?? null
    : null;
  const contextTargetPageIndex = contextTargetPage
    ? project.pages.findIndex((page) => page.id === contextTargetPage.id)
    : -1;
  const canMoveContextPageUp = contextTargetPageIndex > 0;
  const canMoveContextPageDown =
    contextTargetPageIndex >= 0 && contextTargetPageIndex < project.pages.length - 1;
  const contextMenuTitle =
    contextMenu?.target.kind === "page" ? t("contextMenu.page") : t("contextMenu.sidebar");
  const contextMenuActions: SidebarContextAction[] = [
    {
      label: t("sidebar.addPage"),
      onSelect: () =>
        runMenuAction(() =>
          contextMenu?.target.kind === "page" && contextTargetPage
            ? onAddPage(contextTargetPage.id)
            : onAddPage(),
        ),
    },
    ...(contextMenu?.target.kind === "page" && contextTargetPage
      ? [
          {
            label: t("contextMenu.selectPage"),
            disabled: contextTargetPage.id === selectedPageId,
            onSelect: () => runMenuAction(() => onSelectPage(contextTargetPage.id)),
          },
          {
            label: t("sidebar.duplicate"),
            onSelect: () => runMenuAction(() => onDuplicatePage(contextTargetPage.id)),
          },
          {
            label: t("sidebar.moveUp"),
            disabled: !canMoveContextPageUp,
            onSelect: () => {
              if (!canMoveContextPageUp) {
                return;
              }
              runMenuAction(() => onMovePageUp(contextTargetPage.id));
            },
          },
          {
            label: t("sidebar.moveDown"),
            disabled: !canMoveContextPageDown,
            onSelect: () => {
              if (!canMoveContextPageDown) {
                return;
              }
              runMenuAction(() => onMovePageDown(contextTargetPage.id));
            },
          },
          {
            label: t("contextMenu.deletePage"),
            danger: true,
            onSelect: () => runMenuAction(() => onDeletePage(contextTargetPage.id)),
          },
        ]
      : []),
  ];

  return (
    <aside
      ref={sidebarRef}
      className="left-sidebar"
      onContextMenu={(event) => openContextMenu(event, { kind: "sidebar" })}
    >
      <div className="sidebar-header">
        <p className="eyebrow">{t("sidebar.project")}</p>
        <input
          className="sidebar-project-title"
          aria-label={t("sidebar.projectTitleLabel")}
          value={titleInput}
          placeholder={t("sidebar.untitledProject")}
          onChange={(event) => setTitleInput(event.target.value)}
          onBlur={commitProjectTitle}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.currentTarget.blur();
            }
            if (event.key === "Escape") {
              setTitleInput(project.title);
              event.currentTarget.blur();
            }
          }}
        />
        <label className="sidebar-project-type">
          <span>{t("sidebar.projectTypeLabel")}</span>
          <select
            aria-label={t("sidebar.projectTypeLabel")}
            value={project.type}
            onChange={(event) => onSetProjectType(event.target.value as ProjectType)}
          >
            <option value="manga">{t("projectType.manga")}</option>
            <option value="cg">{t("projectType.cg")}</option>
          </select>
        </label>
        <p>{t("sidebar.pageCount", { count: project.pages.length })}</p>
      </div>
      <div className="page-list">
        {project.pages.length === 0 ? (
          <div className="empty-pages">{t("sidebar.emptyPages")}</div>
        ) : (
          project.pages.map((page, index) => (
            <div
              key={page.id}
              className={page.id === selectedPageId ? "page-card active" : "page-card"}
              role="button"
              tabIndex={0}
              onClick={() => onSelectPage(page.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelectPage(page.id);
                }
              }}
              onContextMenu={(event) =>
                openContextMenu(event, {
                  kind: "page",
                  pageId: page.id,
                })
              }
            >
              <PageThumbnail page={page} />
              <div className="page-meta">
                <strong>{t("defaults.pageName", { index: index + 1 })}</strong>
                <span>
                  {t("sidebar.pageSummary", {
                    panels: page.panels.length,
                    dialogue: page.texts.length + page.bubbles.length,
                  })}
                </span>
              </div>
            </div>
          ))
        )}
      </div>
      {contextMenu && contextMenuActions.length > 0 ? (
        <div
          ref={menuRef}
          className="canvas-context-menu sidebar-context-menu"
          role="menu"
          aria-label={contextMenuTitle}
          style={{
            left: `${contextMenu.x}px`,
            top: `${contextMenu.y}px`,
          }}
          onContextMenu={(event) => {
            event.preventDefault();
          }}
        >
          <p className="canvas-context-menu-title">{contextMenuTitle}</p>
          <div className="canvas-context-menu-actions">
            {contextMenuActions.map((action) => (
              <div
                key={action.label}
                className={`canvas-context-menu-item${action.danger ? " danger" : ""}${action.disabled ? " disabled" : ""}`}
                role="menuitem"
                tabIndex={action.disabled ? -1 : 0}
                aria-disabled={action.disabled ? "true" : undefined}
                onClick={() => {
                  if (action.disabled) {
                    return;
                  }
                  action.onSelect();
                }}
                onKeyDown={(event) => {
                  if (action.disabled) {
                    return;
                  }
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    action.onSelect();
                  }
                }}
              >
                {action.label}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </aside>
  );
};
