import templateProjectJson from "../generated/yukinoProject.json";
import { projectSchema, type Project } from "../domain/schema";

const DRAFT_KEY = "mangamaker:draft:v2";
const DRAFT_POINTER_KEY = "mangamaker:draft:pointer";
const PROJECT_INDEX_KEY = "mangamaker:projects:v1";
const SYNC_MARKER_KEY = "mangamaker:fixture:yukino-sync";

const TARGET_TITLE = "\u96ea\u4e4b\u4e0b\u6f2b\u753b";
const LEGACY_TITLES = new Set([
  "\u96ea\u4e4b\u4e0b\u6f2b\u753b",
  "\u96ea\u4e4b\u4e0b\u96ea\u4e43\u6f2b\u753b",
]);

const safeLocalStorageGet = (key: string) => {
  try {
    return window.localStorage.getItem(key);
  } catch (error) {
    console.warn(`Failed to read localStorage key "${key}"`, error);
    return null;
  }
};

const safeLocalStorageSet = (key: string, value: string) => {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch (error) {
    console.warn(`Failed to write localStorage key "${key}"`, error);
    return false;
  }
};

const parseProject = (raw: string | null) => {
  if (!raw) {
    return null;
  }
  try {
    return projectSchema.parse(JSON.parse(raw));
  } catch (error) {
    console.warn("Skipped invalid MangaMaker project payload during sync:", error);
    return null;
  }
};

const readProjectIndex = () => {
  const raw = safeLocalStorageGet(PROJECT_INDEX_KEY);
  if (!raw) {
    return [] as Project[];
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [] as Project[];
    }

    return parsed
      .map((entry) => {
        try {
          return projectSchema.parse(entry);
        } catch (error) {
          console.warn("Skipped invalid project entry while syncing Yukino project:", error);
          return null;
        }
      })
      .filter((entry): entry is Project => entry !== null);
  } catch (error) {
    console.warn("Failed to parse project index while syncing Yukino project:", error);
    return [] as Project[];
  }
};

const sortProjects = (projects: Project[]) =>
  [...projects].sort(
    (left, right) =>
      new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
  );

const isTargetProject = (project: Project | null) =>
  Boolean(project && LEGACY_TITLES.has(project.title));

const cloneTemplateProject = () => projectSchema.parse(templateProjectJson);

export const syncYukinoProject = () => {
  if (typeof window === "undefined") {
    return;
  }

  const templateProject = cloneTemplateProject();
  const appliedVersion = safeLocalStorageGet(SYNC_MARKER_KEY);
  if (appliedVersion === templateProject.updatedAt) {
    return;
  }

  const draftProject = parseProject(safeLocalStorageGet(DRAFT_KEY));
  const indexedProjects = readProjectIndex();
  const existingProject =
    indexedProjects.find((project) => isTargetProject(project)) ??
    (isTargetProject(draftProject) ? draftProject : null);

  const nextProject: Project = {
    ...templateProject,
    id: existingProject?.id ?? templateProject.id,
    title: TARGET_TITLE,
    createdAt: existingProject?.createdAt ?? templateProject.createdAt,
    updatedAt: new Date().toISOString(),
  };

  const filteredProjects = indexedProjects.filter(
    (project) => project.id !== nextProject.id && !LEGACY_TITLES.has(project.title),
  );
  const nextProjectIndex = sortProjects([nextProject, ...filteredProjects]);

  safeLocalStorageSet(PROJECT_INDEX_KEY, JSON.stringify(nextProjectIndex));

  const currentPointer = safeLocalStorageGet(DRAFT_POINTER_KEY);
  if (!draftProject || isTargetProject(draftProject) || currentPointer === nextProject.id) {
    safeLocalStorageSet(DRAFT_KEY, JSON.stringify(nextProject));
    safeLocalStorageSet(DRAFT_POINTER_KEY, nextProject.id);
  }

  safeLocalStorageSet(SYNC_MARKER_KEY, templateProject.updatedAt);
};
