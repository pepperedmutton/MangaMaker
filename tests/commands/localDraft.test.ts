import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createBlankProject,
  createDefaultBubble,
  createDefaultPage,
  createDefaultPanelStyle,
  createDefaultText,
  createId,
} from "../../src/domain/defaults";
import { projectSchema, type Project } from "../../src/domain/schema";

const {
  mockIsProjectsFilePersistenceAvailable,
  mockSaveProjectToProjectsFolder,
} = vi.hoisted(() => ({
  mockIsProjectsFilePersistenceAvailable: vi.fn(() => true),
  mockSaveProjectToProjectsFolder: vi.fn(async () => "/projects/persist-test/project.json"),
}));

vi.mock("../../src/storage/projectFiles", () => ({
  isProjectsFilePersistenceAvailable: mockIsProjectsFilePersistenceAvailable,
  saveProjectToProjectsFolder: mockSaveProjectToProjectsFolder,
  loadProjectFromProjectsFolder: vi.fn(async () => null),
  listProjectsFromProjectsFolder: vi.fn(async () => []),
  deleteProjectFromProjectsFolder: vi.fn(async () => undefined),
  persistImportedImageForProject: vi.fn(async () => "/projects/persist-test/assets/materialized.png"),
}));

import { saveLocalDraft } from "../../src/storage/localDraft";

const DRAFT_KEY = "mangamaker:draft:v2";
const DRAFT_POINTER_KEY = "mangamaker:draft:pointer";

const createMemoryLocalStorage = () => {
  const memory = new Map<string, string>();
  return {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => {
      memory.set(key, value);
    },
    removeItem: (key: string) => {
      memory.delete(key);
    },
    clear: () => {
      memory.clear();
    },
  };
};

const createProjectWithTextAndBubble = (): Project => {
  const project = createBlankProject("Persist Text Bubble");
  const page = createDefaultPage(0);

  const panelId = createId("panel");
  const textId = createId("text");
  const bubbleId = createId("bubble");

  page.panels = [
    {
      id: panelId,
      x: 120,
      y: 120,
      width: 360,
      height: 280,
      rotation: 0,
      points: [
        { x: 0, y: 0 },
        { x: 360, y: 0 },
        { x: 360, y: 280 },
        { x: 0, y: 280 },
      ],
      style: createDefaultPanelStyle(),
      image: {
        src: "https://example.invalid/unreachable.png",
        prompt: "remote-image",
        sourceWidth: 360,
        sourceHeight: 280,
        viewBox: {
          x: 0,
          y: 0,
          width: 360,
          height: 280,
        },
      },
      description: "",
    },
  ];

  page.texts = [
    {
      id: textId,
      ...createDefaultText({
        content: "Text should persist",
      }),
    },
  ];

  page.bubbles = [
    {
      id: bubbleId,
      ...createDefaultBubble({
        bubbleType: "thought",
        strokeColor: "#334455",
      }),
    },
  ];

  page.layers = [`panel:${panelId}`, `text:${textId}`, `bubble:${bubbleId}`];
  project.pages = [page];
  return project;
};

describe("localDraft persistence", () => {
  const originalWindow = (globalThis as { window?: unknown }).window;
  const originalFetch = globalThis.fetch;
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsProjectsFilePersistenceAvailable.mockReturnValue(true);
    mockSaveProjectToProjectsFolder.mockResolvedValue("/projects/persist-test/project.json");

    const localStorage = createMemoryLocalStorage();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        localStorage,
      },
    });
  });

  afterEach(() => {
    if (originalWindow === undefined) {
      Reflect.deleteProperty(globalThis, "window");
    } else {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: originalWindow,
      });
    }

    globalThis.fetch = originalFetch;
    warnSpy.mockClear();
  });

  it("does not drop text/bubble saves when one panel image cannot be materialized", async () => {
    const project = createProjectWithTextAndBubble();
    globalThis.fetch = vi.fn(async () => {
      throw new Error("network blocked");
    }) as typeof fetch;

    const savedAt = await saveLocalDraft(project);

    expect(savedAt).toEqual(expect.any(String));
    expect(mockSaveProjectToProjectsFolder).toHaveBeenCalledTimes(1);

    const persistedProject = mockSaveProjectToProjectsFolder.mock.calls[0]?.[0] as Project;
    expect(persistedProject.pages[0]?.texts[0]?.content).toBe("Text should persist");
    expect(persistedProject.pages[0]?.bubbles[0]?.bubbleType).toBe("thought");
    expect(persistedProject.pages[0]?.bubbles[0]?.strokeColor).toBe("#334455");

    const rawDraft = (
      (globalThis as { window: { localStorage: { getItem: (key: string) => string | null } } }).window
        .localStorage
    ).getItem(DRAFT_KEY);
    const rawPointer = (
      (globalThis as { window: { localStorage: { getItem: (key: string) => string | null } } }).window
        .localStorage
    ).getItem(DRAFT_POINTER_KEY);

    expect(rawDraft).toBeTruthy();
    expect(rawPointer).toBe(project.id);

    const parsed = JSON.parse(rawDraft ?? "{}") as Project;
    expect(parsed.pages[0]?.texts[0]?.content).toBe("Text should persist");
    expect(parsed.pages[0]?.bubbles[0]?.bubbleType).toBe("thought");
    expect(parsed.pages[0]?.bubbles[0]?.strokeColor).toBe("#334455");
  });

  it("keeps non-default bubbleType through compact save payloads", async () => {
    const project = createProjectWithTextAndBubble();
    project.pages[0].bubbles[0] = {
      ...project.pages[0].bubbles[0],
      bubbleType: "diamond",
    };

    await saveLocalDraft(project);

    const rawDraft = (
      (globalThis as { window: { localStorage: { getItem: (key: string) => string | null } } }).window
        .localStorage
    ).getItem(DRAFT_KEY);
    expect(rawDraft).toBeTruthy();

    const compact = JSON.parse(rawDraft ?? "{}") as Record<string, unknown>;
    const compactBubble = (compact.pages as Array<{ bubbles: Array<Record<string, unknown>> }>)[0]
      .bubbles[0];
    expect(compactBubble.bubbleType).toBe("diamond");

    const restored = projectSchema.parse(compact);
    expect(restored.pages[0]?.bubbles[0]?.bubbleType).toBe("diamond");
  });
});
