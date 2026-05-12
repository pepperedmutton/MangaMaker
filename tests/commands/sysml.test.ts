import { promises as fsp } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveSysmlPilotRuntimeConfig } from "../../src/sysml/config";
import { DEFAULT_MANGA_SYSML_FILES, createNonR18SampleSysmlFiles } from "../../src/sysml/mangaModel";
import { validateSysmlWithPilot } from "../../src/sysml/pilotAdapter";
import {
  getSysmlStandardOverview,
  readSysmlStandardReferenceTopic,
} from "../../src/sysml/standardReference";

const originalProjectsDir = process.env.MANGAMAKER_PROJECTS_DIR;
const tempRoots: string[] = [];

afterEach(async () => {
  if (originalProjectsDir === undefined) {
    delete process.env.MANGAMAKER_PROJECTS_DIR;
  } else {
    process.env.MANGAMAKER_PROJECTS_DIR = originalProjectsDir;
  }
  vi.resetModules();
  await Promise.all(tempRoots.splice(0).map((root) => fsp.rm(root, { recursive: true, force: true })));
});

const createTempProjectsRoot = async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "mangamaker-sysml-test-"));
  tempRoots.push(root);
  process.env.MANGAMAKER_PROJECTS_DIR = root;
  vi.resetModules();
  return root;
};

describe("SysML v2 integration", () => {
  it("publishes an in-harness SysML standard reference overview and focused topics", () => {
    const overview = getSysmlStandardOverview();
    expect(overview).toMatchObject({
      version: expect.stringContaining("SysML v2"),
      mandatoryRules: expect.arrayContaining([
        expect.stringContaining("validate"),
      ]),
      topics: expect.arrayContaining([
        expect.objectContaining({ id: "requirements-verification-traceability" }),
        expect.objectContaining({ id: "mangamaker-mbse-profile" }),
      ]),
    });

    const topic = readSysmlStandardReferenceTopic("mangamaker-mbse-profile");
    expect(topic.guidance).toEqual(
      expect.arrayContaining([
        expect.stringContaining("human creator"),
        expect.stringContaining("ComicPage"),
      ]),
    );
  });

  it("reports official Pilot runtime configuration without exposing runtime internals in the public shape", () => {
    const config = resolveSysmlPilotRuntimeConfig();
    expect(config.provider).toBe(config.enabled ? "official-pilot" : "unavailable");
    expect(config).toMatchObject({
      javaConfigured: expect.any(Boolean),
      pilotJarConfigured: expect.any(Boolean),
      libraryConfigured: expect.any(Boolean),
      helperConfigured: expect.any(Boolean),
    });
  });

  it("initializes per-project SysML files in an isolated project repository", async () => {
    await createTempProjectsRoot();
    const { ensureSysmlRepository, readAllSysmlValidationFiles } = await import("../../src/sysml/repository");
    const manifest = await ensureSysmlRepository("sysml-project");
    expect(manifest.projectId).toBe("sysml-project");
    expect(manifest.files.map((file) => file.path)).toEqual([
      "mangamaker-domain.sysml",
      "project-model.sysml",
    ]);

    const files = await readAllSysmlValidationFiles("sysml-project");
    expect(files).toHaveLength(2);
    expect(files[0].content).toContain("package MangaMakerDomain");
  });

  it("validates the default MangaMaker MBSE seed model with the official Pilot when configured", async () => {
    const result = await validateSysmlWithPilot([...DEFAULT_MANGA_SYSML_FILES]);
    if (!resolveSysmlPilotRuntimeConfig().enabled) {
      expect(result.provider).toBe("unavailable");
      expect(result.reason).toBeTruthy();
      return;
    }
    expect(result.provider).toBe("official-pilot");
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("returns diagnostics for invalid SysML instead of treating text as a valid model", async () => {
    const result = await validateSysmlWithPilot([
      { path: "invalid.sysml", content: "package InvalidModel { !!! }\n" },
    ]);
    if (!resolveSysmlPilotRuntimeConfig().enabled) {
      expect(result.provider).toBe("unavailable");
      return;
    }
    expect(result.ok).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues.some((issue) => issue.syntax || issue.message.length > 0)).toBe(true);
  });

  it("validates a non-R18 sample manga MBSE model", async () => {
    const result = await validateSysmlWithPilot([
      ...DEFAULT_MANGA_SYSML_FILES,
      ...createNonR18SampleSysmlFiles(),
    ]);
    if (!resolveSysmlPilotRuntimeConfig().enabled) {
      expect(result.provider).toBe("unavailable");
      return;
    }
    expect(result.ok).toBe(true);
  });
});
