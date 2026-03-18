import { projectSchema, type Project } from "../domain/schema";
import {
  listProjectsFromProjectsFolder,
  loadProjectFromProjectsFolder,
  saveProjectToProjectsFolder,
} from "./projectFiles";

const DRAFT_KEY = "mangamaker:draft:v2";
const DRAFT_POINTER_KEY = "mangamaker:draft:pointer";
const PROJECT_INDEX_KEY = "mangamaker:projects:v1";

const sortProjectsByUpdatedAt = (projects: Project[]) =>
  [...projects].sort(
    (left, right) =>
      new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
  );

const readProjectsFromIndex = () => {
  if (typeof window === "undefined") {
    return [] as Project[];
  }
  const raw = window.localStorage.getItem(PROJECT_INDEX_KEY);
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
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(PROJECT_INDEX_KEY, JSON.stringify(sortProjectsByUpdatedAt(projects)));
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
  if (window.localStorage.getItem(DRAFT_POINTER_KEY) || window.localStorage.getItem(DRAFT_KEY)) {
    return true;
  }
  return readProjectsFromIndex().length > 0;
};

export const saveLocalDraft = async (project: Project) => {
  if (typeof window === "undefined") {
    return null;
  }
  const parsed = projectSchema.parse(project);
  window.localStorage.setItem(DRAFT_KEY, JSON.stringify(parsed));
  window.localStorage.setItem(DRAFT_POINTER_KEY, parsed.id);
  upsertProjectInIndex(parsed);
  try {
    await saveProjectToProjectsFolder(parsed);
  } catch (error) {
    console.warn("Failed to persist project to projects folder:", error);
  }
  return new Date().toISOString();
};

export const listLocalProjects = async () => {
  if (typeof window === "undefined") {
    return [] as Project[];
  }
  try {
    const rawProjects = await listProjectsFromProjectsFolder();
    if (rawProjects.length > 0) {
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

  const rawDraft = window.localStorage.getItem(DRAFT_KEY);
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
        window.localStorage.setItem(DRAFT_KEY, JSON.stringify(match));
        window.localStorage.setItem(DRAFT_POINTER_KEY, match.id);
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
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify(project));
      window.localStorage.setItem(DRAFT_POINTER_KEY, project.id);
      upsertProjectInIndex(project);
      return project;
    }
  } catch (error) {
    console.warn("Failed to load project from projects folder:", error);
  }

  const pointer = window.localStorage.getItem(DRAFT_POINTER_KEY);
  if (pointer) {
    const project = getProjectFromIndexById(pointer);
    if (project) {
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify(project));
      return project;
    }
  }

  const raw = window.localStorage.getItem(DRAFT_KEY);
  if (!raw) {
    return null;
  }
  const project = projectSchema.parse(JSON.parse(raw));
  upsertProjectInIndex(project);
  return project;
};

export const clearLocalDraft = () => {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.removeItem(DRAFT_KEY);
  window.localStorage.removeItem(DRAFT_POINTER_KEY);
};

