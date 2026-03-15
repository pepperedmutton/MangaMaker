import type { ObjectType, Project } from "../domain/schema";
import type { Locale } from "../i18n";

export type ToolMode = "select" | "panel" | "text" | "bubble";

export type EditorSelection = {
  pageId: string;
  objectType: ObjectType;
  objectId: string;
} | null;

export type PanelImageEditingState = {
  pageId: string;
  panelId: string;
} | null;

export type ExportArtifact = {
  kind: "png" | "pdf";
  fileName: string;
  dataUrl: string;
  pageId?: string;
  pageCount?: number;
} | null;

export type StatusMessage = {
  tone: "info" | "success" | "error";
  text: string;
} | null;

export type SaveStatus = {
  target: "localDraft" | null;
  lastSavedAt: string | null;
};

export type HistoryEntry = {
  project: Project;
  selectedPageId: string | null;
  selection: EditorSelection;
  panelImageEditing: PanelImageEditingState;
};

export type EditorSessionState = {
  project: Project;
  selectedPageId: string | null;
  selection: EditorSelection;
  panelImageEditing: PanelImageEditingState;
  locale: Locale;
  activeTool: ToolMode;
  zoom: number;
  lastExport: ExportArtifact;
  statusMessage: StatusMessage;
  saveStatus: SaveStatus;
};
