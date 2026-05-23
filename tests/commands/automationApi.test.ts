import { afterEach, describe, expect, it } from "vitest";
import { installAutomationApi } from "../../src/automation/api";

describe("automation API", () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
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
});
