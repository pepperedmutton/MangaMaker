import { createHash } from "node:crypto";
import { promises as fsp } from "node:fs";
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_MANGA_SYSML_FILES } from "./mangaModel";
import type {
  SysmlFile,
  SysmlFileMeta,
  SysmlRepositoryManifest,
  SysmlValidationFileInput,
  SysmlWriteResult,
} from "./types";

const PROJECTS_DIR_NAME = process.env.MANGAMAKER_PROJECTS_DIR?.trim() || "projects";
const PROJECT_JSON_FILE = "project.json";
const SYSML_DIR = "sysml";
const SYSML_OPERATIONS_FILE = ".sysml-operations.json";

const now = () => new Date().toISOString();

const hashText = (value: string) => createHash("sha256").update(value).digest("hex");

const safeSegment = (value: string) =>
  value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "project";

const projectsRoot = () => path.resolve(process.cwd(), PROJECTS_DIR_NAME);

const pathInside = (root: string, target: string) => {
  const relative = path.relative(root, target);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
};

const readProjectId = async (projectDir: string) => {
  try {
    const raw = await fsp.readFile(path.join(projectDir, PROJECT_JSON_FILE), "utf8");
    const parsed = JSON.parse(raw) as { id?: unknown };
    return typeof parsed.id === "string" ? parsed.id : null;
  } catch {
    return null;
  }
};

export const resolveSysmlProjectDir = async (projectId: string) => {
  const root = projectsRoot();
  await fsp.mkdir(root, { recursive: true });
  const entries = await fsp.readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const candidate = path.join(root, entry.name);
    const candidateId = await readProjectId(candidate);
    if (candidateId === projectId) {
      return candidate;
    }
  }
  return path.join(root, safeSegment(projectId));
};

export const getSysmlRoot = async (projectId: string) =>
  path.join(await resolveSysmlProjectDir(projectId), SYSML_DIR);

const normalizeSysmlRelativePath = (relativePath: string) => {
  const normalized = relativePath.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.includes("\0")) {
    throw new Error("SysML file path is required.");
  }
  if (normalized.split("/").some((segment) => segment === ".." || segment === "")) {
    throw new Error("SysML file path must stay inside the project sysml directory.");
  }
  if (!/\.(sysml|kerml)$/i.test(normalized)) {
    throw new Error("SysML file path must end with .sysml or .kerml.");
  }
  return normalized;
};

const resolveSysmlFilePath = async (projectId: string, relativePath: string) => {
  const root = await getSysmlRoot(projectId);
  const normalized = normalizeSysmlRelativePath(relativePath);
  const absolute = path.resolve(root, normalized);
  if (!pathInside(root, absolute)) {
    throw new Error("SysML file path must stay inside the project sysml directory.");
  }
  return { root, normalized, absolute };
};

const walkSysmlFiles = async (dir: string, root: string, output: string[]) => {
  const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      continue;
    }
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkSysmlFiles(absolute, root, output);
      continue;
    }
    if (entry.isFile() && /\.(sysml|kerml)$/i.test(entry.name)) {
      output.push(path.relative(root, absolute).replace(/\\/g, "/"));
    }
  }
};

const readOperations = async (root: string): Promise<Record<string, string>> => {
  try {
    const raw = await fsp.readFile(path.join(root, SYSML_OPERATIONS_FILE), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, string>
      : {};
  } catch {
    return {};
  }
};

const writeOperations = async (root: string, operations: Record<string, string>) => {
  await fsp.writeFile(path.join(root, SYSML_OPERATIONS_FILE), JSON.stringify(operations, null, 2), "utf8");
};

const readFileMeta = async (root: string, relativePath: string): Promise<SysmlFileMeta> => {
  const absolute = path.join(root, relativePath);
  const [stats, content] = await Promise.all([
    fsp.stat(absolute),
    fsp.readFile(absolute, "utf8"),
  ]);
  return {
    path: relativePath,
    size: Buffer.byteLength(content, "utf8"),
    updatedAt: stats.mtime.toISOString(),
    hash: hashText(content),
  };
};

export const ensureSysmlRepository = async (projectId: string): Promise<SysmlRepositoryManifest> => {
  const root = await getSysmlRoot(projectId);
  await fsp.mkdir(root, { recursive: true });
  let initialized = false;
  for (const file of DEFAULT_MANGA_SYSML_FILES) {
    const target = path.join(root, file.path);
    if (!fs.existsSync(target)) {
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.writeFile(target, file.content, "utf8");
      initialized = true;
    }
  }
  return listSysmlFiles(projectId, initialized);
};

export const listSysmlFiles = async (
  projectId: string,
  initialized = false,
): Promise<SysmlRepositoryManifest> => {
  const root = await getSysmlRoot(projectId);
  await fsp.mkdir(root, { recursive: true });
  const paths: string[] = [];
  await walkSysmlFiles(root, root, paths);
  const files = await Promise.all(paths.sort((a, b) => a.localeCompare(b)).map((entry) => readFileMeta(root, entry)));
  return {
    projectId,
    root,
    initialized,
    files,
  };
};

export const readSysmlFile = async (projectId: string, relativePath: string): Promise<SysmlFile> => {
  const { root, normalized, absolute } = await resolveSysmlFilePath(projectId, relativePath);
  const content = await fsp.readFile(absolute, "utf8");
  const meta = await readFileMeta(root, normalized);
  return { ...meta, content };
};

export const readAllSysmlValidationFiles = async (projectId: string): Promise<SysmlValidationFileInput[]> => {
  const manifest = await ensureSysmlRepository(projectId);
  const files = await Promise.all(manifest.files.map((file) => readSysmlFile(projectId, file.path)));
  return files.map((file) => ({
    path: file.path,
    content: file.content,
  }));
};

export const writeSysmlFile = async (
  projectId: string,
  input: { path: string; content: string; operationId?: string },
): Promise<SysmlWriteResult> => {
  const { root, normalized, absolute } = await resolveSysmlFilePath(projectId, input.path);
  await fsp.mkdir(root, { recursive: true });
  await fsp.mkdir(path.dirname(absolute), { recursive: true });
  const contentHash = hashText(`${normalized}\0${input.content}`);
  const operationId = input.operationId?.trim() || `sysml-write-${Date.now()}`;
  const operations = await readOperations(root);
  const existingContent = await fsp.readFile(absolute, "utf8").catch(() => null);
  if (operations[operationId]) {
    if (operations[operationId] !== contentHash) {
      throw new Error(`SysML write operationId ${operationId} was already applied with different file content.`);
    }
    const file = existingContent === input.content
      ? await readSysmlFile(projectId, normalized)
      : await (async () => {
          await fsp.writeFile(absolute, input.content, "utf8");
          return readSysmlFile(projectId, normalized);
        })();
    return {
      saved: true,
      changed: false,
      alreadyApplied: true,
      operationId,
      file,
    };
  }
  const changed = existingContent !== input.content;
  await fsp.writeFile(absolute, input.content, "utf8");
  operations[operationId] = contentHash;
  await writeOperations(root, operations);
  return {
    saved: true,
    changed,
    alreadyApplied: false,
    operationId,
    file: await readSysmlFile(projectId, normalized),
  };
};

export const deleteSysmlFile = async (projectId: string, relativePath: string) => {
  const { normalized, absolute } = await resolveSysmlFilePath(projectId, relativePath);
  await fsp.rm(absolute, { force: true });
  return {
    deleted: true,
    path: normalized,
    updatedAt: now(),
  };
};
