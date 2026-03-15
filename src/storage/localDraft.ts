import { projectSchema, type Project } from "../domain/schema";

const DRAFT_KEY = "mangamaker:draft:v2";

export const hasLocalDraft = () => {
  if (typeof window === "undefined") {
    return false;
  }
  return Boolean(window.localStorage.getItem(DRAFT_KEY));
};

export const saveLocalDraft = (project: Project) => {
  if (typeof window === "undefined") {
    return null;
  }
  window.localStorage.setItem(DRAFT_KEY, JSON.stringify(projectSchema.parse(project)));
  return new Date().toISOString();
};

export const loadLocalDraft = () => {
  if (typeof window === "undefined") {
    return null;
  }
  const raw = window.localStorage.getItem(DRAFT_KEY);
  if (!raw) {
    return null;
  }
  return projectSchema.parse(JSON.parse(raw));
};

export const clearLocalDraft = () => {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.removeItem(DRAFT_KEY);
};
