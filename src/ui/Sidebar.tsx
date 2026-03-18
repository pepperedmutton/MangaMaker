import { useEffect, useState } from "react";
import type { Project } from "../domain/schema";
import { useI18n } from "../i18n/useI18n";
import { PageThumbnail } from "./PageThumbnail";

type SidebarProps = {
  project: Project;
  selectedPageId: string | null;
  onSelectPage: (pageId: string) => void;
  onAddPage: () => void;
  onDuplicatePage: () => void;
  onDeletePage: () => void;
  onMovePageUp: () => void;
  onMovePageDown: () => void;
  onRenameProject: (title: string) => void;
};

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
}: SidebarProps) => {
  const { t } = useI18n();
  const [titleInput, setTitleInput] = useState(project.title);

  useEffect(() => {
    setTitleInput(project.title);
  }, [project.title]);

  return (
    <aside className="left-sidebar">
      <div className="sidebar-header">
        <p className="eyebrow">{t("sidebar.project")}</p>
        <h2>{project.title || t("sidebar.untitledProject")}</h2>
        <p>{t("sidebar.pageCount", { count: project.pages.length })}</p>
      </div>
      {project.title.trim().length > 0 ? (
        <div className="sidebar-title-editor">
          <label>
            <span>{t("sidebar.projectTitleLabel")}</span>
            <input
              aria-label={t("sidebar.projectTitleLabel")}
              value={titleInput}
              onChange={(event) => setTitleInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && titleInput.trim().length > 0) {
                  onRenameProject(titleInput.trim());
                }
              }}
            />
          </label>
          <button
            className="primary-button"
            disabled={titleInput.trim().length === 0 || titleInput.trim() === project.title}
            onClick={() => onRenameProject(titleInput.trim())}
          >
            {t("sidebar.renameProject")}
          </button>
          <p className="sidebar-hint">{t("sidebar.renameHint")}</p>
        </div>
      ) : null}
      <div className="sidebar-actions">
        <button className="primary-button" onClick={onAddPage}>
          {t("sidebar.addPage")}
        </button>
        <button onClick={onDuplicatePage} disabled={!selectedPageId}>
          {t("sidebar.duplicate")}
        </button>
        <button onClick={onDeletePage} disabled={!selectedPageId}>
          {t("sidebar.delete")}
        </button>
      </div>
      <div className="sidebar-actions compact">
        <button onClick={onMovePageUp} disabled={!selectedPageId}>
          {t("sidebar.moveUp")}
        </button>
        <button onClick={onMovePageDown} disabled={!selectedPageId}>
          {t("sidebar.moveDown")}
        </button>
      </div>
      <div className="page-list">
        {project.pages.length === 0 ? (
          <div className="empty-pages">{t("sidebar.emptyPages")}</div>
        ) : (
          project.pages.map((page) => (
            <button
              key={page.id}
              className={page.id === selectedPageId ? "page-card active" : "page-card"}
              onClick={() => onSelectPage(page.id)}
            >
              <PageThumbnail page={page} />
              <div className="page-meta">
                <strong>{page.name}</strong>
                <span>
                  {t("sidebar.pageSummary", {
                    panels: page.panels.length,
                    dialogue: page.texts.length + page.bubbles.length,
                  })}
                </span>
              </div>
            </button>
          ))
        )}
      </div>
    </aside>
  );
};
