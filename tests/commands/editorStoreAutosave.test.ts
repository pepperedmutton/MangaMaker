import { beforeEach, describe, expect, it, vi } from "vitest";
import { createBlankProject } from "../../src/domain/defaults";
import { shouldAutoSaveAfterCommand } from "../../src/state/autoSavePolicy";

const { mockSaveLocalDraft } = vi.hoisted(() => ({
  mockSaveLocalDraft: vi.fn(),
}));

vi.mock("../../src/storage/localDraft", () => ({
  saveLocalDraft: mockSaveLocalDraft,
  loadLocalDraft: vi.fn(async () => null),
  listLocalProjects: vi.fn(async () => []),
  deleteLocalProject: vi.fn(async () => true),
}));

const waitForCondition = async (condition: () => boolean) => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Timed out waiting for condition.");
};

describe("editor store major-change auto-save", () => {
  beforeEach(async () => {
    mockSaveLocalDraft.mockReset();
    mockSaveLocalDraft.mockResolvedValue("2026-05-15T12:00:00.000Z");
    const { useEditorStore } = await import("../../src/state/editorStore");
    useEditorStore.getState().resetProject();
  });

  it("marks structural and image commands as major auto-save triggers", () => {
    expect(shouldAutoSaveAfterCommand("addPage")).toBe(true);
    expect(shouldAutoSaveAfterCommand("createPanel")).toBe(true);
    expect(shouldAutoSaveAfterCommand("placeImageInPanel")).toBe(true);
    expect(shouldAutoSaveAfterCommand("pasteClipboardItem")).toBe(true);
    expect(shouldAutoSaveAfterCommand("movePanel")).toBe(false);
    expect(shouldAutoSaveAfterCommand("updateText")).toBe(false);
  });

  it("auto-saves after a major project change", async () => {
    const { useEditorStore } = await import("../../src/state/editorStore");
    useEditorStore.getState().setProject(createBlankProject("Autosave Project"));

    await useEditorStore.getState().executeCommand("addPage", {});

    await waitForCondition(() => mockSaveLocalDraft.mock.calls.length === 1);
    await waitForCondition(() => useEditorStore.getState().saveStatus.hasUnsavedChanges === false);

    expect(mockSaveLocalDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Autosave Project",
        pages: expect.arrayContaining([expect.objectContaining({ id: expect.any(String) })]),
      }),
      { mode: "last-write-wins" },
    );
    expect(useEditorStore.getState().saveStatus).toMatchObject({
      target: "localDraft",
      lastSavedAt: "2026-05-15T12:00:00.000Z",
      hasUnsavedChanges: false,
    });
  });

  it("does not auto-save high-frequency minor transforms", async () => {
    const { useEditorStore } = await import("../../src/state/editorStore");
    useEditorStore.getState().setProject(createBlankProject("Autosave Project"));
    const page = await useEditorStore.getState().executeCommand("addPage", {}) as { id: string };
    const panel = await useEditorStore.getState().executeCommand("createPanel", {
      pageId: page.id,
      x: 10,
      y: 20,
      width: 120,
      height: 160,
    }) as { id: string };
    await waitForCondition(() => mockSaveLocalDraft.mock.calls.length >= 1);
    await waitForCondition(() => useEditorStore.getState().saveStatus.hasUnsavedChanges === false);
    mockSaveLocalDraft.mockClear();

    await useEditorStore.getState().executeCommand("movePanel", {
      pageId: page.id,
      panelId: panel.id,
      x: 40,
      y: 50,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockSaveLocalDraft).not.toHaveBeenCalled();
    expect(useEditorStore.getState().saveStatus.hasUnsavedChanges).toBe(true);
  });
});

