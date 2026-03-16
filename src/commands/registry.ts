import { z } from "zod";
import {
  createBlankProject,
  createDefaultBubble,
  createDefaultPage,
  createDefaultPanelStyle,
  createDefaultText,
  createId,
  clonePage,
  MAX_ZOOM,
  MIN_ZOOM,
} from "../domain/defaults";
import {
  clamp,
  clampBubbleRectToWorkspace,
  clampPanelRectToWorkspace,
  clampPointToWorkspace,
  clampTextBoxToWorkspace,
  clampImageViewBox,
  createInitialPanelViewBox,
  fitViewBoxToPanelAspect,
  getPageById,
  insertPanelPoint,
  preservePanelImageViewBox,
  removePanelPoint,
  removeLayerRef,
  scalePanelPoints,
  snapValue,
  toLayerRef,
} from "../domain/helpers";
import { objectTypeSchema, pointSchema, projectSchema, type Project } from "../domain/schema";
import { renderPageToPngDataUrl, renderProjectToPdfDataUrl } from "../export/render";
import {
  DEFAULT_LOCALE,
  getDefaultPageName,
  getDuplicatedPageName,
  localeSchema,
  persistLocale,
  translate,
  type Locale,
} from "../i18n";
import { loadLocalDraft, saveLocalDraft } from "../storage/localDraft";
import type { EditorSelection, HistoryEntry } from "../state/types";
import type { CommandDefinition } from "./types";

const ensureProject = (project: Project) => projectSchema.parse(project);

const touch = (project: Project): Project => ({
  ...project,
  updatedAt: new Date().toISOString(),
});

const sanitizeFileName = (value: string) =>
  value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "export";

const createStatus = (
  tone: "info" | "success" | "error",
  text: string,
) => ({
  tone,
  text,
});

const getLocale = (context: Parameters<CommandDefinition["execute"]>[0]): Locale =>
  context.getSession().locale ?? DEFAULT_LOCALE;

const createLocalizedStatus = (
  locale: Locale,
  tone: "info" | "success" | "error",
  key: Parameters<typeof translate>[1],
  params?: Parameters<typeof translate>[2],
) => createStatus(tone, translate(locale, key, params));

const createContextStatus = (
  context: Parameters<CommandDefinition["execute"]>[0],
  tone: "info" | "success" | "error",
  key: Parameters<typeof translate>[1],
  params?: Parameters<typeof translate>[2],
) => createLocalizedStatus(getLocale(context), tone, key, params);

const getToolLabel = (locale: Locale, tool: "select" | "panel" | "text" | "bubble") =>
  translate(locale, `toolbar.${tool}`);

const snapshotSession = (
  project: Project,
  selectedPageId: string | null,
  selection: EditorSelection,
  panelImageEditing: HistoryEntry["panelImageEditing"],
): HistoryEntry => ({
  project: structuredClone(project),
  selectedPageId,
  selection: selection ? { ...selection } : null,
  panelImageEditing: panelImageEditing ? { ...panelImageEditing } : null,
});

const updatePage = (
  project: Project,
  pageId: string,
  updater: (page: Project["pages"][number]) => Project["pages"][number],
) => ({
  ...project,
  pages: project.pages.map((page) => (page.id === pageId ? updater(page) : page)),
});

const withPage = <T>(project: Project, pageId: string, selector: (page: Project["pages"][number]) => T) =>
  selector(getPageById(project, pageId));

const getPanel = (project: Project, pageId: string, panelId: string) => {
  const panel = getPageById(project, pageId).panels.find((entry) => entry.id === panelId);
  if (!panel) {
    throw new Error(`Panel not found: ${panelId}`);
  }
  return panel;
};

const getText = (project: Project, pageId: string, textId: string) => {
  const text = getPageById(project, pageId).texts.find((entry) => entry.id === textId);
  if (!text) {
    throw new Error(`Text not found: ${textId}`);
  }
  return text;
};

const readImageMetadata = async (
  src: string,
  fallbackWidth: number,
  fallbackHeight: number,
) => {
  if (typeof window === "undefined" || typeof window.Image === "undefined" || src.length === 0) {
    return {
      sourceWidth: fallbackWidth,
      sourceHeight: fallbackHeight,
    };
  }

  return new Promise<{ sourceWidth: number; sourceHeight: number }>((resolve) => {
    const image = new window.Image();
    image.onload = () =>
      resolve({
        sourceWidth: image.naturalWidth || fallbackWidth,
        sourceHeight: image.naturalHeight || fallbackHeight,
      });
    image.onerror = () =>
      resolve({
        sourceWidth: fallbackWidth,
        sourceHeight: fallbackHeight,
      });
    image.src = src;
  });
};

const assertObjectExists = (
  project: Project,
  pageId: string,
  objectType: z.infer<typeof objectTypeSchema>,
  objectId: string,
) => {
  const page = getPageById(project, pageId);
  const exists =
    objectType === "panel"
      ? page.panels.some((item) => item.id === objectId)
      : objectType === "text"
        ? page.texts.some((item) => item.id === objectId)
        : page.bubbles.some((item) => item.id === objectId);
  if (!exists) {
    throw new Error(`Object not found: ${objectType}:${objectId}`);
  }
};

const commands = {
  createProject: {
    id: "createProject",
    label: "Create Project",
    inputSchema: z.object({
      title: z.string().trim().min(1),
    }),
    execute: (context, input) => {
      const project = ensureProject(createBlankProject(input.title));
      context.setProject(project);
      context.setSession({
        selectedPageId: null,
        selection: null,
        panelImageEditing: null,
        activeTool: "select",
        lastExport: null,
        statusMessage: createContextStatus(context, "success", "command.projectCreated"),
      });
      context.setHistory({ past: [], future: [] });
      return project;
    },
  },
  renameProject: {
    id: "renameProject",
    label: "Rename Project",
    recordHistory: true,
    inputSchema: z.object({
      title: z.string().trim().min(1),
    }),
    execute: (context, input) => {
      const nextProject = ensureProject(
        touch({
          ...context.getProject(),
          title: input.title,
        }),
      );
      context.setProject(nextProject);
      context.setSession({
        statusMessage: createContextStatus(context, "success", "command.projectRenamed"),
      });
      return nextProject;
    },
  },
  saveProject: {
    id: "saveProject",
    label: "Save Project",
    inputSchema: z.object({
      target: z.enum(["localDraft"]).default("localDraft"),
    }),
    execute: (context, input) => {
      const savedAt = saveLocalDraft(context.getProject());
      context.setSession({
        saveStatus: {
          target: input.target,
          lastSavedAt: savedAt,
        },
        statusMessage: createContextStatus(context, "info", "command.projectAutosaved"),
      });
      return {
        target: input.target,
        lastSavedAt: savedAt,
      };
    },
  },
  loadProject: {
    id: "loadProject",
    label: "Load Project",
    inputSchema: z.object({
      project: projectSchema.optional(),
      source: z.enum(["localDraft"]).optional(),
    }),
    execute: (context, input) => {
      const project = input.project ?? loadLocalDraft();
      if (!project) {
        throw new Error("No saved draft was found.");
      }
      const parsed = ensureProject(project);
      context.setProject(parsed);
      context.setSession({
        selectedPageId: parsed.pages[0]?.id ?? null,
        selection: null,
        panelImageEditing: null,
        activeTool: "select",
        lastExport: null,
        statusMessage: createContextStatus(context, "success", "command.projectLoaded"),
      });
      context.setHistory({ past: [], future: [] });
      return parsed;
    },
  },
  addPage: {
    id: "addPage",
    label: "Add Page",
    recordHistory: true,
    inputSchema: z.object({
      name: z.string().optional(),
      width: z.number().positive().optional(),
      height: z.number().positive().optional(),
    }),
    execute: (context, input) => {
      const current = context.getProject();
      const draft = createDefaultPage(current.pages.length);
      const locale = getLocale(context);
      const page = {
        ...draft,
        name: getDefaultPageName(locale, current.pages.length + 1),
        ...(input.name ? { name: input.name } : {}),
        ...(input.width ? { width: input.width } : {}),
        ...(input.height ? { height: input.height } : {}),
      };
      context.setProject(ensureProject(touch({ ...current, pages: [...current.pages, page] })));
      context.setSession({
        selectedPageId: page.id,
        selection: null,
        activeTool: "select",
        statusMessage: createContextStatus(context, "success", "command.pageAdded", {
          name: page.name,
        }),
      });
      return page;
    },
  },
  setPageBackground: {
    id: "setPageBackground",
    label: "Set Page Background",
    recordHistory: true,
    inputSchema: z.object({
      pageId: z.string(),
      background: z.string(),
    }),
    execute: (context, input) => {
      const current = context.getProject();
      withPage(current, input.pageId, (page) => page);
      const nextProject = ensureProject(
        touch(
          updatePage(current, input.pageId, (entry) => ({
            ...entry,
            background: input.background,
          })),
        ),
      );
      context.setProject(nextProject);
      context.setSession({
        selectedPageId: input.pageId,
        statusMessage: createContextStatus(context, "success", "command.pageBackgroundUpdated"),
      });
      return withPage(nextProject, input.pageId, (entry) => entry);
    },
  },
  duplicatePage: {
    id: "duplicatePage",
    label: "Duplicate Page",
    recordHistory: true,
    inputSchema: z.object({
      pageId: z.string(),
    }),
    execute: (context, input) => {
      const current = context.getProject();
      const index = current.pages.findIndex((page) => page.id === input.pageId);
      if (index < 0) {
        throw new Error(`Page not found: ${input.pageId}`);
      }
      const duplicate = {
        ...clonePage(current.pages[index]),
        name: getDuplicatedPageName(getLocale(context), current.pages[index].name),
      };
      const pages = [...current.pages];
      pages.splice(index + 1, 0, duplicate);
      context.setProject(ensureProject(touch({ ...current, pages })));
      context.setSession({
        selectedPageId: duplicate.id,
        selection: null,
        statusMessage: createContextStatus(context, "success", "command.pageDuplicated", {
          name: duplicate.name,
        }),
      });
      return duplicate;
    },
  },
  removePage: {
    id: "removePage",
    label: "Remove Page",
    recordHistory: true,
    inputSchema: z.object({
      pageId: z.string(),
    }),
    execute: (context, input) => {
      const current = context.getProject();
      const index = current.pages.findIndex((page) => page.id === input.pageId);
      if (index < 0) {
        throw new Error(`Page not found: ${input.pageId}`);
      }
      const nextPages = current.pages.filter((page) => page.id !== input.pageId);
      const nextProject = ensureProject(touch({ ...current, pages: nextPages }));
      const nextSelectedPageId =
        nextPages[index]?.id ?? nextPages[index - 1]?.id ?? nextPages[0]?.id ?? null;
      context.setProject(nextProject);
      context.setSession({
        selectedPageId: nextSelectedPageId,
        selection: null,
        statusMessage: createContextStatus(context, "info", "command.pageRemoved"),
      });
      return {
        pageId: input.pageId,
        remainingPages: nextPages.length,
      };
    },
  },
  reorderPage: {
    id: "reorderPage",
    label: "Reorder Page",
    recordHistory: true,
    inputSchema: z.object({
      fromIndex: z.number().int().nonnegative(),
      toIndex: z.number().int().nonnegative(),
    }),
    execute: (context, input) => {
      const current = context.getProject();
      const pages = [...current.pages];
      if (!pages[input.fromIndex] || input.toIndex > pages.length - 1) {
        throw new Error("Page reorder index is out of bounds.");
      }
      const [page] = pages.splice(input.fromIndex, 1);
      pages.splice(input.toIndex, 0, page);
      context.setProject(ensureProject(touch({ ...current, pages })));
      context.setSession({
        statusMessage: createContextStatus(context, "info", "command.pageReordered"),
      });
      return pages.map((entry) => entry.id);
    },
  },
  selectPage: {
    id: "selectPage",
    label: "Select Page",
    inputSchema: z.object({
      pageId: z.string(),
    }),
    execute: (context, input) => {
      withPage(context.getProject(), input.pageId, (page) => page);
      context.setSession({
        selectedPageId: input.pageId,
        selection: null,
        panelImageEditing: null,
        activeTool: "select",
      });
      return { pageId: input.pageId };
    },
  },
  setTool: {
    id: "setTool",
    label: "Set Tool",
    inputSchema: z.object({
      tool: z.enum(["select", "panel", "text", "bubble"]),
    }),
    execute: (context, input) => {
      const locale = getLocale(context);
      context.setSession({
        activeTool: input.tool,
        statusMessage:
          input.tool === "select"
            ? null
            : createLocalizedStatus(locale, "info", "command.toolActive", {
                tool: getToolLabel(locale, input.tool),
              }),
      });
      return { tool: input.tool };
    },
  },
  setLocale: {
    id: "setLocale",
    label: "Set Locale",
    inputSchema: z.object({
      locale: localeSchema,
    }),
    execute: (context, input) => {
      persistLocale(input.locale);
      context.setSession({
        locale: input.locale,
        statusMessage: createLocalizedStatus(input.locale, "info", "command.localeChanged"),
      });
      return { locale: input.locale };
    },
  },
  selectObject: {
    id: "selectObject",
    label: "Select Object",
    inputSchema: z.object({
      pageId: z.string(),
      objectType: objectTypeSchema,
      objectId: z.string(),
    }),
    execute: (context, input) => {
      const page = getPageById(context.getProject(), input.pageId);
      const exists =
        input.objectType === "panel"
          ? page.panels.some((panel) => panel.id === input.objectId)
          : input.objectType === "text"
            ? page.texts.some((text) => text.id === input.objectId)
            : page.bubbles.some((bubble) => bubble.id === input.objectId);
      if (!exists) {
        throw new Error(`Object not found: ${input.objectType}:${input.objectId}`);
      }
      const selection = {
        pageId: input.pageId,
        objectType: input.objectType,
        objectId: input.objectId,
      };
      context.setSession({
        selectedPageId: input.pageId,
        selection,
        panelImageEditing: null,
        activeTool: "select",
      });
      return selection;
    },
  },
  clearSelection: {
    id: "clearSelection",
    label: "Clear Selection",
    inputSchema: z.object({}),
    execute: (context) => {
      context.setSession({
        selection: null,
        panelImageEditing: null,
      });
      return null;
    },
  },
  setZoom: {
    id: "setZoom",
    label: "Set Zoom",
    inputSchema: z.object({
      zoom: z.number(),
    }),
    execute: (context, input) => {
      const zoom = clamp(input.zoom, MIN_ZOOM, MAX_ZOOM);
      context.setSession({
        zoom,
      });
      return { zoom };
    },
  },
  undo: {
    id: "undo",
    label: "Undo",
    inputSchema: z.object({}),
    execute: (context) => {
      const { past, future } = context.getHistory();
      if (past.length === 0) {
        return null;
      }
      const previous = past[past.length - 1];
      const current = context.getSession();
      context.setHistory({
        past: past.slice(0, -1),
        future: [
          snapshotSession(
            current.project,
            current.selectedPageId,
            current.selection,
            current.panelImageEditing,
          ),
          ...future,
        ],
      });
      context.setProject(previous.project);
      context.setSession({
        selectedPageId: previous.selectedPageId,
        selection: previous.selection,
        panelImageEditing: previous.panelImageEditing,
        activeTool: "select",
        statusMessage: createContextStatus(context, "info", "command.undo"),
      });
      return previous;
    },
  },
  redo: {
    id: "redo",
    label: "Redo",
    inputSchema: z.object({}),
    execute: (context) => {
      const { past, future } = context.getHistory();
      if (future.length === 0) {
        return null;
      }
      const [next, ...remainingFuture] = future;
      const current = context.getSession();
      context.setHistory({
        past: [
          ...past,
          snapshotSession(
            current.project,
            current.selectedPageId,
            current.selection,
            current.panelImageEditing,
          ),
        ],
        future: remainingFuture,
      });
      context.setProject(next.project);
      context.setSession({
        selectedPageId: next.selectedPageId,
        selection: next.selection,
        panelImageEditing: next.panelImageEditing,
        activeTool: "select",
        statusMessage: createContextStatus(context, "info", "command.redo"),
      });
      return next;
    },
  },
  createPanel: {
    id: "createPanel",
    label: "Create Panel",
    recordHistory: true,
    inputSchema: z.object({
      pageId: z.string(),
      x: z.number(),
      y: z.number(),
      width: z.number().positive(),
      height: z.number().positive(),
    }),
    execute: (context, input) => {
      const page = getPageById(context.getProject(), input.pageId);
      const rect = clampPanelRectToWorkspace(page, input);
      const panel = {
        id: createId("panel"),
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        rotation: 0,
        points: [
          { x: 0, y: 0 },
          { x: rect.width, y: 0 },
          { x: rect.width, y: rect.height },
          { x: 0, y: rect.height },
        ],
        style: createDefaultPanelStyle(),
        image: null,
      };
      const nextProject = ensureProject(
        touch(
          updatePage(context.getProject(), input.pageId, (entry) => ({
            ...entry,
            panels: [...entry.panels, panel],
            layers: [...entry.layers, toLayerRef("panel", panel.id)],
          })),
        ),
      );
      context.setProject(nextProject);
      context.setSession({
        selectedPageId: input.pageId,
        selection: {
          pageId: input.pageId,
          objectType: "panel",
          objectId: panel.id,
        },
        activeTool: "select",
        statusMessage: createContextStatus(context, "success", "command.panelCreated"),
      });
      return panel;
    },
  },
  movePanel: {
    id: "movePanel",
    label: "Move Panel",
    recordHistory: true,
    inputSchema: z.object({
      pageId: z.string(),
      panelId: z.string(),
      x: z.number(),
      y: z.number(),
    }),
    execute: (context, input) => {
      const page = getPageById(context.getProject(), input.pageId);
      const panel = getPanel(context.getProject(), input.pageId, input.panelId);
      const rect = clampPanelRectToWorkspace(page, {
        x: input.x,
        y: input.y,
        width: panel.width,
        height: panel.height,
      });
      const { x, y } = rect;
      const nextProject = ensureProject(
        touch(
          updatePage(context.getProject(), input.pageId, (entry) => ({
            ...entry,
            panels: entry.panels.map((item) => (item.id === input.panelId ? { ...item, x, y } : item)),
          })),
        ),
      );
      context.setProject(nextProject);
      context.setSession({
        selection: {
          pageId: input.pageId,
          objectType: "panel",
          objectId: input.panelId,
        },
      });
      return withPage(nextProject, input.pageId, (entry) =>
        entry.panels.find((item) => item.id === input.panelId),
      );
    },
  },
  resizePanel: {
    id: "resizePanel",
    label: "Resize Panel",
    recordHistory: true,
    inputSchema: z.object({
      pageId: z.string(),
      panelId: z.string(),
      x: z.number().optional(),
      y: z.number().optional(),
      width: z.number().positive(),
      height: z.number().positive(),
    }),
    execute: (context, input) => {
      const page = getPageById(context.getProject(), input.pageId);
      const panel = getPanel(context.getProject(), input.pageId, input.panelId);
      const rect = clampPanelRectToWorkspace(page, {
        x: input.x ?? panel.x,
        y: input.y ?? panel.y,
        width: input.width,
        height: input.height,
      });
      const nextPoints = scalePanelPoints(
        panel.points,
        panel.width,
        panel.height,
        rect.width,
        rect.height,
      );
      const nextProject = ensureProject(
        touch(
          updatePage(context.getProject(), input.pageId, (entry) => ({
            ...entry,
            panels: entry.panels.map((item) =>
              item.id === input.panelId
                ? {
                    ...item,
                    ...rect,
                    points: nextPoints,
                    image: item.image
                      ? {
                          ...item.image,
                          viewBox: preservePanelImageViewBox(
                            item,
                            rect,
                            item.image.sourceWidth ?? item.image.viewBox.width,
                            item.image.sourceHeight ?? item.image.viewBox.height,
                            item.image.viewBox,
                          ),
                        }
                      : null,
                  }
                : item,
            ),
          })),
        ),
      );
      context.setProject(nextProject);
      return withPage(nextProject, input.pageId, (entry) =>
        entry.panels.find((item) => item.id === input.panelId),
      );
    },
  },
  setPanelStyle: {
    id: "setPanelStyle",
    label: "Set Panel Style",
    recordHistory: true,
    inputSchema: z.object({
      pageId: z.string(),
      panelId: z.string(),
      fill: z.string().optional(),
      stroke: z.string().optional(),
      strokeWidth: z.number().nonnegative().optional(),
      cornerRadius: z.number().nonnegative().optional(),
    }),
    execute: (context, input) => {
      getPanel(context.getProject(), input.pageId, input.panelId);
      const nextProject = ensureProject(
        touch(
          updatePage(context.getProject(), input.pageId, (entry) => ({
            ...entry,
            panels: entry.panels.map((panel) =>
              panel.id === input.panelId
                ? {
                    ...panel,
                    style: {
                      ...panel.style,
                      ...(input.fill !== undefined ? { fill: input.fill } : {}),
                      ...(input.stroke !== undefined ? { stroke: input.stroke } : {}),
                      ...(input.strokeWidth !== undefined ? { strokeWidth: input.strokeWidth } : {}),
                      ...(input.cornerRadius !== undefined ? { cornerRadius: input.cornerRadius } : {}),
                    },
                  }
                : panel,
            ),
          })),
        ),
      );
      context.setProject(nextProject);
      return withPage(nextProject, input.pageId, (entry) =>
        entry.panels.find((panel) => panel.id === input.panelId),
      );
    },
  },
  placeImageInPanel: {
    id: "placeImageInPanel",
    label: "Place Image In Panel",
    recordHistory: true,
    inputSchema: z.object({
      pageId: z.string(),
      panelId: z.string(),
      src: z.string(),
      prompt: z.string().optional(),
    }),
    execute: async (context, input) => {
      const panel = getPanel(context.getProject(), input.pageId, input.panelId);
      const { sourceWidth, sourceHeight } = await readImageMetadata(
        input.src,
        panel.width,
        panel.height,
      );
      const image = {
        src: input.src,
        prompt: input.prompt ?? "",
        sourceWidth,
        sourceHeight,
        viewBox: createInitialPanelViewBox(panel, sourceWidth, sourceHeight),
      };
      const nextProject = ensureProject(
        touch(
          updatePage(context.getProject(), input.pageId, (entry) => ({
            ...entry,
            panels: entry.panels.map((item) =>
              item.id === input.panelId ? { ...item, image } : item,
            ),
          })),
        ),
      );
      context.setProject(nextProject);
      context.setSession({
        selection: {
          pageId: input.pageId,
          objectType: "panel",
          objectId: input.panelId,
        },
        panelImageEditing: null,
        statusMessage: createContextStatus(context, "success", "command.imagePlaced"),
      });
      return image;
    },
  },
  transformImageInPanel: {
    id: "transformImageInPanel",
    label: "Transform Image In Panel",
    recordHistory: true,
    inputSchema: z.object({
      pageId: z.string(),
      panelId: z.string(),
      x: z.number(),
      y: z.number(),
      scaleX: z.number(),
      scaleY: z.number(),
    }),
    execute: (context, input) => {
      const panel = getPanel(context.getProject(), input.pageId, input.panelId);
      if (!panel.image) {
        throw new Error(`Panel image not found: ${input.panelId}`);
      }
      const zoomFactor = 1 / Math.max(0.1, (input.scaleX + input.scaleY) / 2);
      const sourceWidth = panel.image.sourceWidth ?? panel.image.viewBox.width;
      const sourceHeight = panel.image.sourceHeight ?? panel.image.viewBox.height;
      const nextViewBox = clampImageViewBox(
        sourceWidth,
        sourceHeight,
        fitViewBoxToPanelAspect(
          panel,
          sourceWidth,
          sourceHeight,
          {
            x: input.x,
            y: input.y,
            width: panel.image.viewBox.width * zoomFactor,
            height: panel.image.viewBox.height * zoomFactor,
          },
        ),
      );
      const nextProject = ensureProject(
        touch(
          updatePage(context.getProject(), input.pageId, (entry) => ({
            ...entry,
            panels: entry.panels.map((panel) =>
              panel.id === input.panelId && panel.image
                ? {
                    ...panel,
                    image: {
                      ...panel.image,
                      viewBox: nextViewBox,
                      transform: {
                        x: input.x,
                        y: input.y,
                        scaleX: input.scaleX,
                        scaleY: input.scaleY,
                      },
                    },
                  }
                : panel,
            ),
          })),
        ),
      );
      context.setProject(nextProject);
      return withPage(nextProject, input.pageId, (entry) =>
        entry.panels.find((panel) => panel.id === input.panelId)?.image,
      );
    },
  },
  setPanelImageCrop: {
    id: "setPanelImageCrop",
    label: "Set Panel Image Crop",
    recordHistory: true,
    inputSchema: z.object({
      pageId: z.string(),
      panelId: z.string(),
      viewBox: z.object({
        x: z.number(),
        y: z.number(),
        width: z.number().positive(),
        height: z.number().positive(),
      }),
    }),
    execute: (context, input) => {
      const panel = getPanel(context.getProject(), input.pageId, input.panelId);
      if (!panel.image) {
        throw new Error(`Panel image not found: ${input.panelId}`);
      }
      const sourceWidth = panel.image.sourceWidth ?? panel.image.viewBox.width;
      const sourceHeight = panel.image.sourceHeight ?? panel.image.viewBox.height;
      const nextViewBox = fitViewBoxToPanelAspect(
        panel,
        sourceWidth,
        sourceHeight,
        clampImageViewBox(sourceWidth, sourceHeight, input.viewBox),
      );
      const nextProject = ensureProject(
        touch(
          updatePage(context.getProject(), input.pageId, (entry) => ({
            ...entry,
            panels: entry.panels.map((p) =>
              p.id === input.panelId && p.image
                ? { ...p, image: { ...p.image, viewBox: nextViewBox } }
                : p,
            ),
          })),
        ),
      );
      context.setProject(nextProject);
      return withPage(nextProject, input.pageId, (entry) =>
        entry.panels.find((p) => p.id === input.panelId)?.image,
      );
    },
  },
  enterPanelImageEdit: {
    id: "enterPanelImageEdit",
    label: "Enter Panel Image Edit",
    inputSchema: z.object({
      pageId: z.string(),
      panelId: z.string(),
    }),
    execute: (context, input) => {
      const panel = getPanel(context.getProject(), input.pageId, input.panelId);
      if (!panel.image) {
        throw new Error(`Panel image not found: ${input.panelId}`);
      }
      context.setSession({
        panelImageEditing: {
          pageId: input.pageId,
          panelId: input.panelId,
        },
      });
      return { pageId: input.pageId, panelId: input.panelId };
    },
  },
  exitPanelImageEdit: {
    id: "exitPanelImageEdit",
    label: "Exit Panel Image Edit",
    inputSchema: z.object({}),
    execute: (context) => {
      context.setSession({ panelImageEditing: null });
      return null;
    },
  },
  setPanelPoints: {
    id: "setPanelPoints",
    label: "Set Panel Points",
    recordHistory: true,
    inputSchema: z.object({
      pageId: z.string(),
      panelId: z.string(),
      points: z.array(z.object({ x: z.number(), y: z.number() })).min(3),
    }),
    execute: (context, input) => {
      const page = getPageById(context.getProject(), input.pageId);
      const panel = getPanel(context.getProject(), input.pageId, input.panelId);
      const absolutePoints = input.points.map((p: { x: number; y: number }) =>
        clampPointToWorkspace(page, {
          x: panel.x + p.x,
          y: panel.y + p.y,
        }),
      );
      const xs = absolutePoints.map((p: { x: number; y: number }) => p.x);
      const ys = absolutePoints.map((p: { x: number; y: number }) => p.y);
      const minX = Math.min(...xs);
      const minY = Math.min(...ys);
      const maxX = Math.max(...xs);
      const maxY = Math.max(...ys);
      const normalizedPoints = absolutePoints.map((p: { x: number; y: number }) => ({
        x: snapValue(p.x - minX),
        y: snapValue(p.y - minY),
      }));
      const newWidth = Math.max(20, snapValue(maxX - minX));
      const newHeight = Math.max(20, snapValue(maxY - minY));
      const newX = minX;
      const newY = minY;
      const nextProject = ensureProject(
        touch(
          updatePage(context.getProject(), input.pageId, (entry) => ({
            ...entry,
            panels: entry.panels.map((p) =>
              p.id === input.panelId
                ? {
                    ...p,
                    x: newX,
                    y: newY,
                    width: newWidth,
                    height: newHeight,
                    points: normalizedPoints,
                    image: p.image
                      ? {
                          ...p.image,
                          viewBox: preservePanelImageViewBox(
                            p,
                            {
                              x: newX,
                              y: newY,
                              width: newWidth,
                              height: newHeight,
                            },
                            p.image.sourceWidth ?? p.image.viewBox.width,
                            p.image.sourceHeight ?? p.image.viewBox.height,
                            p.image.viewBox,
                          ),
                        }
                      : null,
                  }
                : p,
            ),
          })),
        ),
      );
      context.setProject(nextProject);
      return withPage(nextProject, input.pageId, (entry) =>
        entry.panels.find((p) => p.id === input.panelId),
      );
    },
  },
  addPanelPoint: {
    id: "addPanelPoint",
    label: "Add Panel Point",
    recordHistory: true,
    inputSchema: z.object({
      pageId: z.string(),
      panelId: z.string(),
    }),
    execute: (context, input) => {
      const panel = getPanel(context.getProject(), input.pageId, input.panelId);
      const nextPoints = insertPanelPoint(panel);
      const nextProject = ensureProject(
        touch(
          updatePage(context.getProject(), input.pageId, (entry) => ({
            ...entry,
            panels: entry.panels.map((p) =>
              p.id === input.panelId ? { ...p, points: nextPoints } : p,
            ),
          })),
        ),
      );
      context.setProject(nextProject);
      return withPage(nextProject, input.pageId, (entry) =>
        entry.panels.find((p) => p.id === input.panelId),
      );
    },
  },
  removePanelPoint: {
    id: "removePanelPoint",
    label: "Remove Panel Point",
    recordHistory: true,
    inputSchema: z.object({
      pageId: z.string(),
      panelId: z.string(),
      pointIndex: z.number().int().nonnegative(),
    }),
    execute: (context, input) => {
      const panel = getPanel(context.getProject(), input.pageId, input.panelId);
      const nextPoints = removePanelPoint(panel, input.pointIndex);
      const nextProject = ensureProject(
        touch(
          updatePage(context.getProject(), input.pageId, (entry) => ({
            ...entry,
            panels: entry.panels.map((p) =>
              p.id === input.panelId ? { ...p, points: nextPoints } : p,
            ),
          })),
        ),
      );
      context.setProject(nextProject);
      return withPage(nextProject, input.pageId, (entry) =>
        entry.panels.find((p) => p.id === input.panelId),
      );
    },
  },
  createText: {
    id: "createText",
    label: "Create Text",
    recordHistory: true,
    inputSchema: z.object({
      pageId: z.string(),
      x: z.number(),
      y: z.number(),
      content: z.string().optional(),
    }),
    execute: (context, input) => {
      const page = getPageById(context.getProject(), input.pageId);
      const defaults = createDefaultText({
        ...(input.content ? { content: input.content } : {}),
      });
      const rect = clampTextBoxToWorkspace(page, {
        x: snapValue(input.x),
        y: snapValue(input.y),
        width: defaults.width,
        height: defaults.height,
      });
      const text = {
        id: createId("text"),
        ...defaults,
        ...rect,
      };
      const nextProject = ensureProject(
        touch(
          updatePage(context.getProject(), input.pageId, (entry) => ({
            ...entry,
            texts: [...entry.texts, text],
            layers: [...entry.layers, toLayerRef("text", text.id)],
          })),
        ),
      );
      context.setProject(nextProject);
      context.setSession({
        selection: {
          pageId: input.pageId,
          objectType: "text",
          objectId: text.id,
        },
        activeTool: "select",
        statusMessage: createContextStatus(context, "success", "command.textAdded"),
      });
      return text;
    },
  },
  updateText: {
    id: "updateText",
    label: "Update Text",
    recordHistory: true,
    inputSchema: z.object({
      pageId: z.string(),
      textId: z.string(),
      content: z.string().optional(),
      x: z.number().optional(),
      y: z.number().optional(),
      width: z.number().positive().optional(),
      height: z.number().positive().optional(),
      fontSize: z.number().positive().optional(),
      fontFamily: z.string().optional(),
      color: z.string().optional(),
      direction: z.enum(["horizontal", "vertical"]).optional(),
    }),
    execute: (context, input) => {
      const page = getPageById(context.getProject(), input.pageId);
      const currentText = getText(context.getProject(), input.pageId, input.textId);
      const nextRect = clampTextBoxToWorkspace(page, {
        x: input.x ?? currentText.x,
        y: input.y ?? currentText.y,
        width: input.width ?? currentText.width,
        height: input.height ?? currentText.height,
      });
      const nextProject = ensureProject(
        touch(
          updatePage(context.getProject(), input.pageId, (entry) => ({
            ...entry,
            texts: entry.texts.map((text) =>
              text.id === input.textId
                ? {
                    ...text,
                    ...(input.content !== undefined ? { content: input.content } : {}),
                    x: nextRect.x,
                    y: nextRect.y,
                    width: nextRect.width,
                    height: nextRect.height,
                    ...(input.fontSize !== undefined ? { fontSize: input.fontSize } : {}),
                    ...(input.fontFamily !== undefined ? { fontFamily: input.fontFamily } : {}),
                    ...(input.color !== undefined ? { color: input.color } : {}),
                    ...(input.direction !== undefined ? { direction: input.direction } : {}),
                  }
                : text,
            ),
          })),
        ),
      );
      context.setProject(nextProject);
      return withPage(nextProject, input.pageId, (entry) =>
        entry.texts.find((text) => text.id === input.textId),
      );
    },
  },
  createBubble: {
    id: "createBubble",
    label: "Create Bubble",
    recordHistory: true,
    inputSchema: z.object({
      pageId: z.string(),
      x: z.number(),
      y: z.number(),
      width: z.number().positive().optional(),
      height: z.number().positive().optional(),
      text: z.string().optional(),
    }),
    execute: (context, input) => {
      const page = getPageById(context.getProject(), input.pageId);
      const rect = clampBubbleRectToWorkspace(page, {
        x: input.x,
        y: input.y,
        width: input.width ?? 260,
        height: input.height ?? 150,
      });
      const tailTip = clampPointToWorkspace(page, {
        x: rect.x + rect.width * 0.5,
        y: rect.y + rect.height + 60,
      });
      const bubble = {
        id: createId("bubble"),
        ...createDefaultBubble({
          ...rect,
          tailTip,
          ...(input.text ? { text: input.text } : {}),
        }),
      };
      const nextProject = ensureProject(
        touch(
          updatePage(context.getProject(), input.pageId, (entry) => ({
            ...entry,
            bubbles: [...entry.bubbles, bubble],
            layers: [...entry.layers, toLayerRef("bubble", bubble.id)],
          })),
        ),
      );
      context.setProject(nextProject);
      context.setSession({
        selection: {
          pageId: input.pageId,
          objectType: "bubble",
          objectId: bubble.id,
        },
        activeTool: "select",
        statusMessage: createContextStatus(context, "success", "command.bubbleAdded"),
      });
      return bubble;
    },
  },
  updateBubble: {
    id: "updateBubble",
    label: "Update Bubble",
    recordHistory: true,
    inputSchema: z.object({
      pageId: z.string(),
      bubbleId: z.string(),
      x: z.number().optional(),
      y: z.number().optional(),
      width: z.number().positive().optional(),
      height: z.number().positive().optional(),
      tailTip: pointSchema.optional(),
      text: z.string().optional(),
      fontSize: z.number().positive().optional(),
    }),
    execute: (context, input) => {
      const page = getPageById(context.getProject(), input.pageId);
      const bubble = page.bubbles.find((entry) => entry.id === input.bubbleId);
      if (!bubble) {
        throw new Error(`Bubble not found: ${input.bubbleId}`);
      }

      const rect = clampBubbleRectToWorkspace(page, {
        x: input.x ?? bubble.x,
        y: input.y ?? bubble.y,
        width: input.width ?? bubble.width,
        height: input.height ?? bubble.height,
      });
      const deltaX = rect.x - bubble.x;
      const deltaY = rect.y - bubble.y;
      const tailTip = input.tailTip
        ? clampPointToWorkspace(page, input.tailTip)
        : clampPointToWorkspace(page, {
            x: bubble.tailTip.x + deltaX,
            y: bubble.tailTip.y + deltaY,
          });

      const nextProject = ensureProject(
        touch(
          updatePage(context.getProject(), input.pageId, (entry) => ({
            ...entry,
            bubbles: entry.bubbles.map((item) =>
              item.id === input.bubbleId
                ? {
                    ...item,
                    ...rect,
                    tailTip,
                    ...(input.text !== undefined ? { text: input.text } : {}),
                    ...(input.fontSize !== undefined ? { fontSize: input.fontSize } : {}),
                  }
                : item,
            ),
          })),
        ),
      );
      context.setProject(nextProject);
      return withPage(nextProject, input.pageId, (entry) =>
        entry.bubbles.find((item) => item.id === input.bubbleId),
      );
    },
  },
  deleteObject: {
    id: "deleteObject",
    label: "Delete Object",
    recordHistory: true,
    inputSchema: z.object({
      pageId: z.string(),
      objectType: objectTypeSchema,
      objectId: z.string(),
    }),
    execute: (context, input) => {
      assertObjectExists(context.getProject(), input.pageId, input.objectType, input.objectId);
      const nextProject = ensureProject(
        touch(
          updatePage(context.getProject(), input.pageId, (entry) => ({
            ...entry,
            panels:
              input.objectType === "panel"
                ? entry.panels.filter((item) => item.id !== input.objectId)
                : entry.panels,
            texts:
              input.objectType === "text"
                ? entry.texts.filter((item) => item.id !== input.objectId)
                : entry.texts,
            bubbles:
              input.objectType === "bubble"
                ? entry.bubbles.filter((item) => item.id !== input.objectId)
                : entry.bubbles,
            layers: removeLayerRef(entry.layers, input.objectType, input.objectId),
          })),
        ),
      );
      context.setProject(nextProject);
      const selection = context.getSession().selection;
      if (
        selection &&
        selection.pageId === input.pageId &&
        selection.objectType === input.objectType &&
        selection.objectId === input.objectId
      ) {
        context.setSession({
          selection: null,
          panelImageEditing: null,
        });
      }
      context.setSession({
        statusMessage: createContextStatus(context, "info", "command.objectRemoved"),
      });
      return {
        objectType: input.objectType,
        objectId: input.objectId,
      };
    },
  },
  exportPagePng: {
    id: "exportPagePng",
    label: "Export Page PNG",
    inputSchema: z.object({
      pageId: z.string(),
    }),
    execute: async (context, input) => {
      const page = getPageById(context.getProject(), input.pageId);
      const dataUrl = await renderPageToPngDataUrl(page);
      const artifact = {
        kind: "png" as const,
        fileName: `${sanitizeFileName(page.name)}.png`,
        dataUrl,
        pageId: page.id,
      };
      context.setSession({
        lastExport: artifact,
        statusMessage: createContextStatus(context, "success", "command.exportReady", {
          fileName: artifact.fileName,
        }),
      });
      return artifact;
    },
  },
  exportProjectPdf: {
    id: "exportProjectPdf",
    label: "Export Project PDF",
    inputSchema: z.object({}),
    execute: async (context) => {
      const project = context.getProject();
      const dataUrl = await renderProjectToPdfDataUrl(project.pages);
      const artifact = {
        kind: "pdf" as const,
        fileName: `${sanitizeFileName(project.title || "mangamaker-project")}.pdf`,
        dataUrl,
        pageCount: project.pages.length,
      };
      context.setSession({
        lastExport: artifact,
        statusMessage: createContextStatus(context, "success", "command.exportReady", {
          fileName: artifact.fileName,
        }),
      });
      return artifact;
    },
  },
} satisfies Record<string, CommandDefinition>;

export const commandRegistry = commands;
