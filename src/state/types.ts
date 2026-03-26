import type { BubbleType, ObjectType, Project } from "../domain/schema";
import type { Locale } from "../i18n";

export type ToolMode = "select" | "panel" | "text" | "bubble";
export type BubbleInsertMode = "preset" | "customClickDraw";

export type BubbleInsertState = {
  mode: BubbleInsertMode;
  presetBubbleType: Exclude<BubbleType, "custom">;
  customSmoothness: number;
};

export type EditorSelectionItem = {
  pageId: string;
  objectType: ObjectType;
  objectId: string;
};

export type EditorSelection = EditorSelectionItem | null;

export type EditorMultiSelection = EditorSelectionItem[];

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

export type TextInsertDefaults = {
  width: number;
  height: number;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  letterSpacing: number;
  lineSpacing: number;
};

export type HistoryEntry = {
  project: Project;
  selectedPageId: string | null;
  selection: EditorSelection;
  multiSelection: EditorMultiSelection;
  panelImageEditing: PanelImageEditingState;
};

export type EditorSessionState = {
  project: Project;
  selectedPageId: string | null;
  selection: EditorSelection;
  multiSelection: EditorMultiSelection;
  panelImageEditing: PanelImageEditingState;
  textInsertDefaults: TextInsertDefaults;
  bubbleInsert: BubbleInsertState;
  locale: Locale;
  activeTool: ToolMode;
  zoom: number;
  lastExport: ExportArtifact;
  statusMessage: StatusMessage;
  saveStatus: SaveStatus;
};
