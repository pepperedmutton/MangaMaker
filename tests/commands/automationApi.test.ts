import { afterEach, describe, expect, it } from "vitest";
import { installAutomationApi } from "../../src/automation/api";
import { createBlankProject, createDefaultPage } from "../../src/domain/defaults";
import { useEditorStore } from "../../src/state/editorStore";

describe("automation API", () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
    useEditorStore.getState().resetProject();
  });

  it("exposes an explicit all-page project export helper", () => {
    (globalThis as { window?: unknown }).window = {};

    installAutomationApi();

    const api = (globalThis as { window: Window }).window.mangaMaker;
    expect(api?.project.exportAllPages).toEqual(expect.any(Function));
    expect(api?.commands.list()).toContain("exportProjectAllPages");
    expect(api?.commands.describe().find((command) => command.id === "exportProjectAllPages"))
      .toMatchObject({
        description: expect.stringContaining("Export every page"),
        mutatesProject: false,
        dangerLevel: "safe",
      });
  });

  it("loads the current project in place without changing the selected page", async () => {
    (globalThis as { window?: unknown }).window = {};
    installAutomationApi();

    const project = {
      ...createBlankProject("Live update", "manga"),
      pages: [createDefaultPage(0), createDefaultPage(1)],
    };
    const secondPageId = project.pages[1]?.id;
    if (!secondPageId) {
      throw new Error("Expected a second page for the live update test.");
    }
    useEditorStore.setState({
      appView: "editor",
      project,
      selectedPageId: secondPageId,
      selection: null,
      multiSelection: [],
      panelImageEditing: null,
    });

    const updatedProject = structuredClone(useEditorStore.getState().project);
    updatedProject.title = "Live update applied";

    const api = (globalThis as { window: Window }).window.mangaMaker;
    await api?.project.load(updatedProject);

    const state = useEditorStore.getState();
    expect(state.project.title).toBe("Live update applied");
    expect(state.selectedPageId).toBe(secondPageId);
  });
});
