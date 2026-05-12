import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fsp } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { resolveSysmlPilotRuntimeConfig } from "./config";
import type {
  SysmlDiagnostic,
  SysmlValidationFileInput,
  SysmlValidationResult,
} from "./types";

const execFileAsync = promisify(execFile);

const hashSource = (files: SysmlValidationFileInput[]) => {
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file.path);
    hash.update("\0");
    hash.update(file.content);
    hash.update("\0");
  }
  return hash.digest("hex");
};

const sanitizeValidationFileName = (filePath: string, index: number) => {
  const extension = path.extname(filePath) || ".sysml";
  const stem = path.basename(filePath, extension).replace(/[^a-zA-Z0-9_.-]+/g, "_") || `model_${index + 1}`;
  return `${String(index + 1).padStart(3, "0")}_${stem}${extension}`;
};

const parsePilotJson = (stdout: string) => {
  const jsonLine = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .reverse()
    .find((line) => line.startsWith("{") && line.endsWith("}"));
  if (!jsonLine) {
    throw new Error("SysML Pilot helper did not return JSON.");
  }
  return JSON.parse(jsonLine) as {
    ok?: unknown;
    durationMs?: unknown;
    issueCount?: unknown;
    issues?: unknown;
    exception?: unknown;
  };
};

const normalizeIssues = (issues: unknown): SysmlDiagnostic[] => {
  if (!Array.isArray(issues)) {
    return [];
  }
  return issues.map((issue) => {
    const record = issue && typeof issue === "object" && !Array.isArray(issue)
      ? issue as Record<string, unknown>
      : {};
    return {
      severity: typeof record.severity === "string" ? record.severity : "ERROR",
      message: typeof record.message === "string" ? record.message : "Unknown SysML diagnostic",
      line: typeof record.line === "number" ? record.line : null,
      column: typeof record.column === "number" ? record.column : null,
      syntax: record.syntax === true,
    };
  });
};

export const validateSysmlWithPilot = async (
  files: SysmlValidationFileInput[],
): Promise<SysmlValidationResult> => {
  const config = resolveSysmlPilotRuntimeConfig();
  const sourceHash = hashSource(files);
  const validatedFiles = files.map((file) => file.path);
  if (!config.enabled || !config.javaPath || !config.pilotJarPath || !config.libraryDir || !config.helperClassesDir) {
    return {
      ok: false,
      provider: "unavailable",
      durationMs: 0,
      issueCount: 0,
      issues: [],
      exception: null,
      validatedFiles,
      sourceHash,
      reason: config.reason ?? "SysML v2 Pilot runtime is unavailable.",
    };
  }

  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "mangamaker-sysml-"));
  try {
    const tempFiles: string[] = [];
    for (const [index, file] of files.entries()) {
      const tempFile = path.join(tempDir, sanitizeValidationFileName(file.path, index));
      await fsp.writeFile(tempFile, file.content, "utf8");
      tempFiles.push(tempFile);
    }
    const classPath = `${config.pilotJarPath}${path.delimiter}${config.helperClassesDir}`;
    const { stdout } = await execFileAsync(
      config.javaPath,
      ["-cp", classPath, "SysmlPilotValidator", config.libraryDir, ...tempFiles],
      {
        timeout: config.timeoutMs,
        maxBuffer: 1024 * 1024 * 8,
        windowsHide: true,
      },
    );
    const parsed = parsePilotJson(String(stdout));
    const issues = normalizeIssues(parsed.issues);
    return {
      ok: parsed.ok === true,
      provider: "official-pilot",
      durationMs: typeof parsed.durationMs === "number" ? parsed.durationMs : 0,
      issueCount: typeof parsed.issueCount === "number" ? parsed.issueCount : issues.length,
      issues,
      exception: typeof parsed.exception === "string" ? parsed.exception : null,
      validatedFiles,
      sourceHash,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      provider: "official-pilot",
      durationMs: 0,
      issueCount: 0,
      issues: [],
      exception: message,
      validatedFiles,
      sourceHash,
    };
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
};
