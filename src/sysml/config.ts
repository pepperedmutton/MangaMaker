import fs from "node:fs";
import path from "node:path";
import type { SysmlConfig } from "./types";

const LOCAL_JDK_VERSION = "jdk-21.0.11+10";
const PILOT_VERSION = "0.58.0";

const isWindows = process.platform === "win32";
const javaExecutableName = isWindows ? "java.exe" : "java";
const javacExecutableName = isWindows ? "javac.exe" : "javac";

const exists = (target: string) => {
  try {
    return fs.existsSync(target);
  } catch {
    return false;
  }
};

const resolveFromRoot = (cwd: string, ...segments: string[]) => path.resolve(cwd, ...segments);

export type SysmlPilotRuntimeConfig = SysmlConfig & {
  javaPath: string | null;
  javacPath: string | null;
  pilotJarPath: string | null;
  libraryDir: string | null;
  helperClassesDir: string | null;
  helperSourcePath: string;
  timeoutMs: number;
};

const parseTimeout = (value: string | undefined) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 60_000;
};

const resolveJavaPath = (cwd: string) => {
  const explicit = process.env.MANGAMAKER_SYSML_JAVA?.trim();
  if (explicit) {
    return path.resolve(explicit);
  }
  const local = resolveFromRoot(cwd, ".mangamaker_runtime", "java", LOCAL_JDK_VERSION, "bin", javaExecutableName);
  return exists(local) ? local : javaExecutableName;
};

const resolveJavacPath = (javaPath: string) => {
  if (javaPath === javaExecutableName) {
    return javacExecutableName;
  }
  return path.join(path.dirname(javaPath), javacExecutableName);
};

export const resolveSysmlPilotRuntimeConfig = (cwd = process.cwd()): SysmlPilotRuntimeConfig => {
  const disabled = process.env.MANGAMAKER_SYSML_ENABLED?.trim() === "0";
  const javaPath = resolveJavaPath(cwd);
  const javacPath = resolveJavacPath(javaPath);
  const pilotJarPath = path.resolve(
    process.env.MANGAMAKER_SYSML_PILOT_JAR?.trim() ||
      resolveFromRoot(
        cwd,
        ".mangamaker_runtime",
        "sysml-v2",
        "jupyter-sysml-kernel",
        "sysml",
        "jupyter-sysml-kernel-0.58.0-all.jar",
      ),
  );
  const libraryDir = path.resolve(
    process.env.MANGAMAKER_SYSML_LIBRARY_DIR?.trim() ||
      resolveFromRoot(cwd, ".mangamaker_runtime", "sysml-v2", "jupyter-sysml-kernel", "sysml", "sysml.library"),
  );
  const helperClassesDir = path.resolve(
    process.env.MANGAMAKER_SYSML_HELPER_CLASSES?.trim() ||
      resolveFromRoot(cwd, ".mangamaker_runtime", "sysml-v2", "helper"),
  );
  const helperSourcePath = resolveFromRoot(cwd, "scripts", "sysml", "SysmlPilotValidator.java");
  const javaConfigured = javaPath === javaExecutableName || exists(javaPath);
  const pilotJarConfigured = exists(pilotJarPath);
  const libraryConfigured = exists(libraryDir);
  const helperConfigured = exists(path.join(helperClassesDir, "SysmlPilotValidator.class"));
  const enabled = !disabled && javaConfigured && pilotJarConfigured && libraryConfigured && helperConfigured;
  const missing = [
    disabled ? "SysML is disabled by MANGAMAKER_SYSML_ENABLED=0" : "",
    javaConfigured ? "" : "Java runtime was not found",
    pilotJarConfigured ? "" : "SysML v2 Pilot jar was not found",
    libraryConfigured ? "" : "SysML v2 Pilot library directory was not found",
    helperConfigured ? "" : "MangaMaker SysML Pilot helper class was not compiled",
  ].filter(Boolean);

  return {
    enabled,
    provider: enabled ? "official-pilot" : "unavailable",
    version: enabled ? PILOT_VERSION : null,
    ...(missing.length > 0 ? { reason: missing.join("; ") } : {}),
    javaConfigured,
    pilotJarConfigured,
    libraryConfigured,
    helperConfigured,
    javaPath: javaConfigured ? javaPath : null,
    javacPath: javaConfigured ? javacPath : null,
    pilotJarPath: pilotJarConfigured ? pilotJarPath : null,
    libraryDir: libraryConfigured ? libraryDir : null,
    helperClassesDir: helperClassesDir,
    helperSourcePath,
    timeoutMs: parseTimeout(process.env.MANGAMAKER_SYSML_TIMEOUT_MS),
  };
};

export const toPublicSysmlConfig = (config: SysmlPilotRuntimeConfig): SysmlConfig => ({
  enabled: config.enabled,
  provider: config.provider,
  version: config.version,
  ...(config.reason ? { reason: config.reason } : {}),
  javaConfigured: config.javaConfigured,
  pilotJarConfigured: config.pilotJarConfigured,
  libraryConfigured: config.libraryConfigured,
  helperConfigured: config.helperConfigured,
});
