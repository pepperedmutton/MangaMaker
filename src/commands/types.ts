import { z } from "zod";
import type { Project } from "../domain/schema";
import type { Locale } from "../i18n";
import type {
  BubbleInsertState,
  AppView,
  EditorSelection,
  EditorMultiSelection,
  EditorSessionState,
  ExportArtifact,
  HistoryEntry,
  PanelImageEditingState,
  SaveStatus,
  StatusMessage,
  TextInsertDefaults,
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
          multiSelection: EditorMultiSelection;
          panelImageEditing: PanelImageEditingState;
          locale: Locale;
          activeTool: ToolMode;
          textInsertDefaults: TextInsertDefaults;
          bubbleInsert: BubbleInsertState;
          zoom: number;
          lastExport: ExportArtifact;
          statusMessage: StatusMessage;
          saveStatus: SaveStatus;
          appView: AppView;
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
