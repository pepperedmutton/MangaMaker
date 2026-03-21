import { useEffect, useRef, useState } from "react";
import type { Project, ProjectType } from "../domain/schema";
import type { Locale } from "../i18n";
import { useI18n } from "../i18n/useI18n";
import { PageThumbnail } from "./PageThumbnail";

type WelcomeScreenProps = {
  projects: Project[];
  loading: boolean;
  title: string;
  projectType: ProjectType;
  draftAvailable: boolean;
  onTitleChange: (value: string) => void;
  onProjectTypeChange: (value: ProjectType) => void;
  onCreateProject: () => void;
  onRestoreDraft: () => void;
  onOpenProject: (project: Project) => void;
  onDeleteProject: (project: Project) => void;
  onSetLocale: (locale: Locale) => void;
};

const formatProjectUpdatedAt = (locale: Locale, timestamp: string) =>
  new Date(timestamp).toLocaleString(locale === "zh-CN" ? "zh-CN" : "en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

export const WelcomeScreen = ({
  projects,
  loading,
  title,
  projectType,
  draftAvailable,
  onTitleChange,
  onProjectTypeChange,
  onCreateProject,
  onRestoreDraft,
  onOpenProject,
  onDeleteProject,
  onSetLocale,
}: WelcomeScreenProps) => {
  const { locale, t } = useI18n();
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [projectMenu, setProjectMenu] = useState<{
    x: number;
    y: number;
    project: Project;
  } | null>(null);

  useEffect(() => {
    if (!projectMenu) {
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
      if (menuRef.current?.contains(event.target as Node)) {
        return;
      }
      setProjectMenu(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setProjectMenu(null);
      }
    };
    const handleResize = () => {
      setProjectMenu(null);
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleResize);
    };
  }, [projectMenu]);

  return (
    <div className="welcome-shell">
      <section className="welcome-card">
        <div className="welcome-header">
          <div>
            <p className="eyebrow">{t("firstRun.startHere")}</p>
            <h1>{t("firstRun.headline")}</h1>
            <p className="lede">{t("firstRun.lede")}</p>
          </div>
          <div className="ribbon-locale">
            <button
              className={`locale-btn${locale === "en" ? " active" : ""}`}
              type="button"
              aria-label={t("language.en")}
              onClick={() => onSetLocale("en")}
            >
              {t("language.en")}
            </button>
            <button
              className={`locale-btn${locale === "zh-CN" ? " active" : ""}`}
              type="button"
              aria-label={t("language.zh-CN")}
              onClick={() => onSetLocale("zh-CN")}
            >
              {t("language.zh-CN")}
            </button>
          </div>
        </div>

        <div className="welcome-layout">
          <section className="welcome-create">
            <label>
              <span>{t("firstRun.projectTitle")}</span>
              <input
                aria-label={t("firstRun.projectTitle")}
                placeholder={t("firstRun.projectTitlePlaceholder")}
                value={title}
                onChange={(event) => onTitleChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    onCreateProject();
                  }
                }}
              />
            </label>
            <label>
              <span>{t("firstRun.projectType")}</span>
              <select
                aria-label={t("firstRun.projectType")}
                value={projectType}
                onChange={(event) => onProjectTypeChange(event.target.value as ProjectType)}
              >
                <option value="manga">{t("projectType.manga")}</option>
                <option value="cg">{t("projectType.cg")}</option>
              </select>
            </label>
            <div className="cta-row">
              <button className="primary-button" onClick={onCreateProject}>
                {t("firstRun.createProject")}
              </button>
              {draftAvailable ? (
                <button onClick={onRestoreDraft}>{t("firstRun.restoreDraft")}</button>
              ) : null}
            </div>
          </section>

          <section className="welcome-projects">
            <div className="welcome-projects-header">
              <p className="eyebrow">{t("welcome.existingProjects")}</p>
            </div>
            {loading ? (
              <p className="hint">{t("welcome.loadingProjects")}</p>
            ) : projects.length === 0 ? (
              <p className="hint">{t("welcome.noProjects")}</p>
            ) : (
              <div className="welcome-project-grid">
                {projects.map((project) => (
                  <button
                    key={project.id}
                    className="welcome-project-card"
                    type="button"
                    onClick={() => onOpenProject(project)}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      const menuWidth = 220;
                      const menuHeight = 120;
                      const x = Math.max(
                        8,
                        Math.min(event.clientX, window.innerWidth - menuWidth - 8),
                      );
                      const y = Math.max(
                        8,
                        Math.min(event.clientY, window.innerHeight - menuHeight - 8),
                      );
                      setProjectMenu({
                        x,
                        y,
                        project,
                      });
                    }}
                  >
                    <PageThumbnail page={project.pages[0] ?? null} />
                    <div className="welcome-project-meta">
                      <strong>{project.title || t("sidebar.untitledProject")}</strong>
                      <span>{t("welcome.projectPages", { count: project.pages.length })}</span>
                      <span>
                        {t("welcome.updatedAt", {
                          time: formatProjectUpdatedAt(locale, project.updatedAt),
                        })}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>
      </section>
      {projectMenu ? (
        <div
          ref={menuRef}
          className="canvas-context-menu sidebar-context-menu"
          style={{
            position: "fixed",
            left: projectMenu.x,
            top: projectMenu.y,
          }}
        >
          <p className="canvas-context-menu-title">{t("contextMenu.sidebar")}</p>
          <div className="canvas-context-menu-actions">
            <button
              className="canvas-context-menu-item danger"
              onClick={() => {
                setProjectMenu(null);
                onDeleteProject(projectMenu.project);
              }}
            >
              {t("contextMenu.deleteProject")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
};
