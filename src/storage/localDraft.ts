import { projectSchema, type Project } from "../domain/schema";
import {
  deleteProjectFromProjectsFolder,
  isProjectsFilePersistenceAvailable,
  listProjectsFromProjectsFolder,
  loadProjectFromProjectsFolder,
  persistImportedImageForProject,
  saveProjectToProjectsFolder,
} from "./projectFiles";

const DRAFT_KEY = "mangamaker:draft:v2";
const DRAFT_POINTER_KEY = "mangamaker:draft:pointer";
const PROJECT_INDEX_KEY = "mangamaker:projects:v1";
let saveDraftQueue: Promise<void> = Promise.resolve();

const enqueueDraftSave = <T>(operation: () => Promise<T>): Promise<T> => {
  const next = saveDraftQueue.then(operation, operation);
  saveDraftQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
};

const safeLocalStorageGet = (key: string) => {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage.getItem(key);
  } catch (error) {
    console.warn(`Failed to read localStorage key "${key}"`, error);
    return null;
  }
};

const safeLocalStorageSet = (key: string, value: string) => {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch (error) {
    console.warn(`Failed to write localStorage key "${key}"`, error);
    return false;
  }
};

const safeLocalStorageRemove = (key: string) => {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.removeItem(key);
  } catch (error) {
    console.warn(`Failed to remove localStorage key "${key}"`, error);
  }
};

const blobToFile = async (src: string, fileName: string) => {
  const response = await fetch(src);
  const blob = await response.blob();
  return new File([blob], fileName, {
    type: blob.type || "image/png",
  });
};

const inferImageFileName = (src: string, pageIndex: number, panelIndex: number) => {
  const pathLike = src.split("?")[0]?.split("#")[0] ?? "";
  const byPath = pathLike.split("/").pop() ?? "";
  if (byPath && byPath.includes(".")) {
    return byPath;
  }
  return `panel-${pageIndex + 1}-${panelIndex + 1}.png`;
};

const isTauriAssetUrl = (src: string) => {
  try {
    const url = new URL(src);
    const host = url.host.toLowerCase();
    return host === "asset.localhost" || host.endsWith(".asset.localhost");
  } catch {
    return false;
  }
};

const shouldMaterializeImageSrc = (src: string) => {
  if (src.startsWith("blob:")) {
    return true;
  }
  if (!(src.startsWith("http://") || src.startsWith("https://"))) {
    return false;
  }
  if (isTauriAssetUrl(src)) {
    return false;
  }
  return true;
};

const materializeProjectImageSources = async (project: Project) => {
  if (typeof window === "undefined") {
    return project;
  }

  let hasChanges = false;
  const pages = await Promise.all(
    project.pages.map(async (page, pageIndex) => {
      const panels = await Promise.all(
        page.panels.map(async (panel, panelIndex) => {
          const src = panel.image?.src ?? "";
          if (!panel.image || !shouldMaterializeImageSrc(src)) {
            return panel;
          }
          try {
            const fileName = inferImageFileName(src, pageIndex, panelIndex);
            const file = await blobToFile(src, fileName);
            const nextSrc = await persistImportedImageForProject(project.id, project.title, file);
            if (nextSrc === src) {
              return panel;
            }
            hasChanges = true;
            return {
              ...panel,
              image: {
                ...panel.image,
                src: nextSrc,
              },
            };
          } catch (error) {
            console.warn(
              `Failed to materialize injected image source for page ${pageIndex + 1}, panel ${panelIndex + 1}:`,
              error,
            );
            if (isProjectsFilePersistenceAvailable()) {
              throw error;
            }
            return panel;
          }
        }),
      );

      const panelChanged = panels.some((panel, index) => panel !== page.panels[index]);
      if (!panelChanged) {
        return page;
      }
      hasChanges = true;
      return {
        ...page,
        panels,
      };
    }),
  );

  if (!hasChanges) {
    return project;
  }

  return {
    ...project,
    pages,
  };
};

const sortProjectsByUpdatedAt = (projects: Project[]) =>
  [...projects].sort(
    (left, right) =>
      new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
  );

const readProjectsFromIndex = () => {
  if (typeof window === "undefined") {
    return [] as Project[];
  }
  const raw = safeLocalStorageGet(PROJECT_INDEX_KEY);
  if (!raw) {
    return [] as Project[];
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [] as Project[];
    }
    return parsed.map((entry) => projectSchema.parse(entry));
  } catch (error) {
    console.warn("Failed to parse project index from localStorage:", error);
    return [] as Project[];
  }
};

const writeProjectsToIndex = (projects: Project[]) => {
  safeLocalStorageSet(PROJECT_INDEX_KEY, JSON.stringify(sortProjectsByUpdatedAt(projects)));
};

const upsertProjectInIndex = (project: Project) => {
  const existing = readProjectsFromIndex().filter((entry) => entry.id !== project.id);
  writeProjectsToIndex([project, ...existing]);
};

const parseProjectsFromRawList = (rawList: string[]) =>
  sortProjectsByUpdatedAt(
    rawList
      .map((raw) => {
        try {
          return projectSchema.parse(JSON.parse(raw));
        } catch (error) {
          console.warn("Skipped invalid project draft while listing projects:", error);
          return null;
        }
      })
      .filter((entry): entry is Project => entry !== null),
  );

const getProjectFromIndexById = (projectId: string) =>
  readProjectsFromIndex().find((project) => project.id === projectId) ?? null;

export const hasLocalDraft = () => {
  if (typeof window === "undefined") {
    return false;
  }
  if (safeLocalStorageGet(DRAFT_POINTER_KEY) || safeLocalStorageGet(DRAFT_KEY)) {
    return true;
  }
  return readProjectsFromIndex().length > 0;
};

export const saveLocalDraft = async (project: Project) => {
  return enqueueDraftSave(async () => {
    if (typeof window === "undefined") {
      return null;
    }
    const snapshot = projectSchema.parse(structuredClone(project));
    const materialized = await materializeProjectImageSources(snapshot);
    const parsed = projectSchema.parse(materialized);
    const filePersistenceRequired = isProjectsFilePersistenceAvailable();

    let persistedToFiles = false;
    let persistedToLocalStorage = false;

    try {
      const filePath = await saveProjectToProjectsFolder(parsed);
      persistedToFiles = Boolean(filePath);
    } catch (error) {
      console.warn("Failed to persist project to projects folder:", error);
    }

    if (filePersistenceRequired && !persistedToFiles) {
      throw new Error(
        "Project persistence failed: current runtime requires writing project data to the local projects folder.",
      );
    }

    const payload = JSON.stringify(parsed);
    const wroteDraft = safeLocalStorageSet(DRAFT_KEY, payload);
    const wrotePointer = safeLocalStorageSet(DRAFT_POINTER_KEY, parsed.id);
    if (wroteDraft && wrotePointer) {
      upsertProjectInIndex(parsed);
      persistedToLocalStorage = true;
    } else {
      console.warn("LocalStorage draft persistence is unavailable; relying on file persistence.");
    }

    if (!persistedToFiles && !persistedToLocalStorage) {
      throw new Error(
        "Project persistence failed: both file persistence and localStorage persistence are unavailable.",
      );
    }

    return new Date().toISOString();
  });
};

export const listLocalProjects = async () => {
  if (typeof window === "undefined") {
    return [] as Project[];
  }
  const filePersistenceAvailable = isProjectsFilePersistenceAvailable();
  try {
    const rawProjects = await listProjectsFromProjectsFolder();
    if (filePersistenceAvailable || rawProjects.length > 0) {
      const projects = parseProjectsFromRawList(rawProjects);
      writeProjectsToIndex(projects);
      return projects;
    }
  } catch (error) {
    console.warn("Failed to list projects from projects folder:", error);
  }

  const projectsFromIndex = readProjectsFromIndex();
  if (projectsFromIndex.length > 0) {
    return sortProjectsByUpdatedAt(projectsFromIndex);
  }

  const rawDraft = safeLocalStorageGet(DRAFT_KEY);
  if (!rawDraft) {
    return [] as Project[];
  }
  try {
    const project = projectSchema.parse(JSON.parse(rawDraft));
    upsertProjectInIndex(project);
    return [project];
  } catch (error) {
    console.warn("Failed to parse local draft from localStorage:", error);
    return [] as Project[];
  }
};

export const loadLocalDraft = async (projectId?: string) => {
  if (typeof window === "undefined") {
    return null;
  }

  if (projectId) {
    try {
      const projects = await listLocalProjects();
      const match = projects.find((project) => project.id === projectId) ?? null;
      if (match) {
        safeLocalStorageSet(DRAFT_KEY, JSON.stringify(match));
        safeLocalStorageSet(DRAFT_POINTER_KEY, match.id);
        return match;
      }
    } catch (error) {
      console.warn("Failed to load specific project from project catalog:", error);
    }
    return getProjectFromIndexById(projectId);
  }

  try {
    const rawFromProjects = await loadProjectFromProjectsFolder();
    if (rawFromProjects) {
      const project = projectSchema.parse(JSON.parse(rawFromProjects));
      safeLocalStorageSet(DRAFT_KEY, JSON.stringify(project));
      safeLocalStorageSet(DRAFT_POINTER_KEY, project.id);
      upsertProjectInIndex(project);
      return project;
    }
  } catch (error) {
    console.warn("Failed to load project from projects folder:", error);
  }

  const pointer = safeLocalStorageGet(DRAFT_POINTER_KEY);
  if (pointer) {
    const project = getProjectFromIndexById(pointer);
    if (project) {
      safeLocalStorageSet(DRAFT_KEY, JSON.stringify(project));
      return project;
    }
  }

  const raw = safeLocalStorageGet(DRAFT_KEY);
  if (!raw) {
    return null;
  }
  const project = projectSchema.parse(JSON.parse(raw));
  upsertProjectInIndex(project);
  return project;
};

export const deleteLocalProject = async (projectId: string) => {
  return enqueueDraftSave(async () => {
    if (typeof window === "undefined") {
      return false;
    }

    try {
      await deleteProjectFromProjectsFolder(projectId);
    } catch (error) {
      console.warn("Failed to delete project from projects folder:", error);
      if (isProjectsFilePersistenceAvailable()) {
        throw error;
      }
    }

    const remainingProjects = readProjectsFromIndex().filter((project) => project.id !== projectId);
    writeProjectsToIndex(remainingProjects);

    const pointer = safeLocalStorageGet(DRAFT_POINTER_KEY);
    const rawDraft = safeLocalStorageGet(DRAFT_KEY);
    const draftMatchesDeletedProject = rawDraft
      ? (() => {
          try {
            return projectSchema.parse(JSON.parse(rawDraft)).id === projectId;
          } catch {
            return false;
          }
        })()
      : false;

    if (pointer === projectId || draftMatchesDeletedProject) {
      safeLocalStorageRemove(DRAFT_POINTER_KEY);
      safeLocalStorageRemove(DRAFT_KEY);
      const fallbackProject = remainingProjects[0] ?? null;
      if (fallbackProject) {
        safeLocalStorageSet(DRAFT_POINTER_KEY, fallbackProject.id);
        safeLocalStorageSet(DRAFT_KEY, JSON.stringify(fallbackProject));
      }
    }

    return true;
  });
};

export const clearLocalDraft = () => {
  if (typeof window === "undefined") {
    return;
  }
  safeLocalStorageRemove(DRAFT_KEY);
  safeLocalStorageRemove(DRAFT_POINTER_KEY);
  if (!isProjectsFilePersistenceAvailable()) {
    safeLocalStorageRemove(PROJECT_INDEX_KEY);
  }
};
