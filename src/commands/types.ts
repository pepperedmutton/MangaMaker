import { z } from "zod";
import type { Project } from "../domain/schema";
import type { Locale } from "../i18n";
import type {
  EditorSelection,
  EditorSessionState,
  ExportArtifact,
  HistoryEntry,
  PanelImageEditingState,
  SaveStatus,
  StatusMessage,
  ToolMode,
} from "../state/types";

export type CommandContext = {
  getProject: () => Project;
  setProject: (project: Project) => void;
  getSession: () => EditorSessionState;
  setSession: (
    patch:
      | Partial<{
          selectedPageId: string | null;
          selection: EditorSelection;
          panelImageEditing: PanelImageEditingState;
          locale: Locale;
          activeTool: ToolMode;
          zoom: number;
          lastExport: ExportArtifact;
          statusMessage: StatusMessage;
          saveStatus: SaveStatus;
        }>
      | ((session: EditorSessionState) => Partial<EditorSessionState>),
  ) => void;
  getHistory: () => {
    past: HistoryEntry[];
    future: HistoryEntry[];
  };
  setHistory: (history: { past: HistoryEntry[]; future: HistoryEntry[] }) => void;
};

export type CommandDefinition<TInput extends z.ZodTypeAny = z.ZodTypeAny, TResult = unknown> = {
  id: string;
  label: string;
  inputSchema: TInput;
  recordHistory?: boolean;
  execute: (
    context: CommandContext,
    input: z.infer<TInput>,
  ) => TResult | Promise<TResult>;
};
