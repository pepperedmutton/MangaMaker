import fs from "node:fs";
import { promises as fsp } from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { defineConfig, type PreviewServer, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";

const PROJECTS_DIR_NAME = "projects";
const PROJECT_META_FILE = ".latest_project";
const PROJECT_JSON_FILE = "project.json";
const PROJECT_ASSETS_DIR = "assets";
const API_BASE = "/__mangamaker__/persistence";
const SHARE_ALLOWED_HOSTS = [
  "gradio.live",
  ".gradio.live",
  "gradio-live.com",
  ".gradio-live.com",
  "ngrok-free.app",
  ".ngrok-free.app",
  "ngrok.app",
  ".ngrok.app",
  "ngrok.dev",
  ".ngrok.dev",
  "ngrok.io",
  ".ngrok.io",
];
const RENDER_ALLOWED_HOSTS = ["onrender.com", ".onrender.com"];
const renderExternalHostname = process.env.RENDER_EXTERNAL_HOSTNAME?.trim();
const ALLOWED_HOSTS = Array.from(
  new Set([
    ...SHARE_ALLOWED_HOSTS,
    ...RENDER_ALLOWED_HOSTS,
    ...(renderExternalHostname ? [renderExternalHostname] : []),
  ]),
);

const sanitizePathComponent = (value: string, fallback: string) => {
  const sanitized = value
    .split("")
    .map((char) => (/^[a-zA-Z0-9_-]$/.test(char) ? char : "_"))
    .join("")
    .replace(/^_+|_+$/g, "");
  return sanitized.length > 0 ? sanitized : fallback;
};

const ensureProjectsRoot = async () => {
  const root = path.resolve(process.cwd(), PROJECTS_DIR_NAME);
  await fsp.mkdir(root, { recursive: true });
  return root;
};

const readProjectIdFromDir = async (projectDir: string) => {
  const projectFile = path.join(projectDir, PROJECT_JSON_FILE);
  const raw = await fsp.readFile(projectFile, "utf8").catch(() => null);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as { id?: unknown };
    if (typeof parsed.id === "string" && parsed.id.trim().length > 0) {
      return parsed.id;
    }
    return null;
  } catch {
    return null;
  }
};

const findProjectDirById = async (root: string, projectId: string) => {
  const entries = await fsp.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const candidateDir = path.join(root, entry.name);
    const candidateProjectId = await readProjectIdFromDir(candidateDir);
    if (candidateProjectId === projectId) {
      return candidateDir;
    }
  }
  return null;
};

const pickProjectFolderName = async (
  root: string,
  projectId: string,
  preferredName: string,
) => {
  const baseName = sanitizePathComponent(preferredName, "project");
  let index = 1;
  while (true) {
    const candidateName = index === 1 ? baseName : `${baseName}-${index}`;
    const candidateDir = path.join(root, candidateName);
    const stats = await fsp.stat(candidateDir).catch(() => null);
    if (!stats) {
      return candidateName;
    }
    if (!stats.isDirectory()) {
      index += 1;
      continue;
    }
    const candidateProjectId = await readProjectIdFromDir(candidateDir);
    if (candidateProjectId === projectId) {
      return candidateName;
    }
    index += 1;
  }
};

const resolveProjectDir = async (
  root: string,
  projectId: string,
  projectTitle: string,
) => {
  const existingDir = await findProjectDirById(root, projectId);
  const targetFolder = await pickProjectFolderName(root, projectId, projectTitle);
  const targetDir = path.join(root, targetFolder);

  if (existingDir && path.resolve(existingDir) !== path.resolve(targetDir)) {
    const targetStats = await fsp.stat(targetDir).catch(() => null);
    if (targetStats) {
      return existingDir;
    }
    try {
      await fsp.rename(existingDir, targetDir);
      return targetDir;
    } catch (error) {
      console.warn("Project folder rename failed; keeping existing folder.", {
        existingDir,
        targetDir,
        error,
      });
      return existingDir;
    }
  }

  if (existingDir) {
    return existingDir;
  }

  return targetDir;
};

const findLatestProjectFolder = async (root: string) => {
  const entries = await fsp.readdir(root, { withFileTypes: true });
  let latestFolder: string | null = null;
  let latestModifiedAt = 0;

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const projectFile = path.join(root, entry.name, PROJECT_JSON_FILE);
    const stats = await fsp.stat(projectFile).catch(() => null);
    if (!stats?.isFile()) {
      continue;
    }
    if (stats.mtimeMs > latestModifiedAt) {
      latestModifiedAt = stats.mtimeMs;
      latestFolder = entry.name;
    }
  }

  return latestFolder;
};

const syncLatestProjectMeta = async (root: string) => {
  const latestFolder = await findLatestProjectFolder(root);
  const metaFile = path.join(root, PROJECT_META_FILE);
  if (latestFolder) {
    await fsp.writeFile(metaFile, latestFolder, "utf8");
    return;
  }
  await fsp.rm(metaFile, { force: true });
};

const json = (res: ServerResponse, status: number, payload: unknown) => {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
};

const text = (res: ServerResponse, status: number, body: string) => {
  res.statusCode = status;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.end(body);
};

const readJsonBody = async <T>(req: IncomingMessage): Promise<T> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) {
    throw new Error("Empty request body");
  }
  return JSON.parse(raw) as T;
};

const inferContentType = (filePath: string) => {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".gif") return "image/gif";
  if (ext === ".webp") return "image/webp";
  if (ext === ".bmp") return "image/bmp";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".json") return "application/json; charset=utf-8";
  return "application/octet-stream";
};

const attachWebPersistenceMiddleware = (
  middlewares: { use: (handler: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) => void },
  closeHandlers: Array<() => void>,
) => {
  const handler = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const method = req.method?.toUpperCase() ?? "GET";
    const host = req.headers.host;
    const url = new URL(req.url ?? "/", host ? `http://${host}` : "http://localhost");
    const pathname = url.pathname;

    try {
      if (method === "GET" && pathname.startsWith("/projects/")) {
        const root = await ensureProjectsRoot();
        const relative = decodeURIComponent(pathname.slice("/projects/".length));
        const candidate = path.resolve(root, relative);
        const rootWithSep = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
        if (!candidate.startsWith(rootWithSep)) {
          text(res, 403, "Forbidden");
          return;
        }
        const stats = await fsp.stat(candidate).catch(() => null);
        if (!stats || !stats.isFile()) {
          next();
          return;
        }
        const stream = fs.createReadStream(candidate);
        res.statusCode = 200;
        res.setHeader("Content-Type", inferContentType(candidate));
        stream.pipe(res);
        return;
      }

      if (!pathname.startsWith(API_BASE)) {
        next();
        return;
      }

      const root = await ensureProjectsRoot();

      if (method === "GET" && pathname === `${API_BASE}/health`) {
        json(res, 200, { ok: true });
        return;
      }

      if (method === "POST" && pathname === `${API_BASE}/write_project_draft`) {
        const payload = await readJsonBody<{
          project_id: string;
          project_title?: string;
          project_json: string;
        }>(req);
        let titleFromJson = "";
        try {
          const parsed = JSON.parse(payload.project_json) as { title?: unknown };
          if (typeof parsed.title === "string") {
            titleFromJson = parsed.title.trim();
          }
        } catch {
          titleFromJson = "";
        }
        const projectTitle =
          titleFromJson ||
          (typeof payload.project_title === "string" ? payload.project_title.trim() : "") ||
          payload.project_id;
        const projectDir = await resolveProjectDir(root, payload.project_id, projectTitle);
        const projectFolder = path.basename(projectDir);
        const assetsDir = path.join(projectDir, PROJECT_ASSETS_DIR);
        await fsp.mkdir(assetsDir, { recursive: true });
        await fsp.writeFile(path.join(projectDir, PROJECT_JSON_FILE), payload.project_json, "utf8");
        await fsp.writeFile(path.join(root, PROJECT_META_FILE), projectFolder, "utf8");
        json(res, 200, { path: `/projects/${projectFolder}/${PROJECT_JSON_FILE}` });
        return;
      }

      if (method === "GET" && pathname === `${API_BASE}/read_project_draft`) {
        const metaFile = path.join(root, PROJECT_META_FILE);
        const metaExists = await fsp.stat(metaFile).catch(() => null);
        if (!metaExists?.isFile()) {
          json(res, 200, { project_json: null });
          return;
        }
        const latestProject = (await fsp.readFile(metaFile, "utf8")).trim();
        const folder = sanitizePathComponent(latestProject, "project");
        const projectFile = path.join(root, folder, PROJECT_JSON_FILE);
        const projectExists = await fsp.stat(projectFile).catch(() => null);
        if (!projectExists?.isFile()) {
          json(res, 200, { project_json: null });
          return;
        }
        const projectJson = await fsp.readFile(projectFile, "utf8");
        json(res, 200, { project_json: projectJson });
        return;
      }

      if (method === "GET" && pathname === `${API_BASE}/list_project_drafts`) {
        const entries = await fsp.readdir(root, { withFileTypes: true });
        const drafts: Array<{ modifiedAt: number; projectJson: string }> = [];
        for (const entry of entries) {
          if (!entry.isDirectory()) {
            continue;
          }
          const projectFile = path.join(root, entry.name, PROJECT_JSON_FILE);
          const stats = await fsp.stat(projectFile).catch(() => null);
          if (!stats?.isFile()) {
            continue;
          }
          const projectJson = await fsp.readFile(projectFile, "utf8");
          drafts.push({ modifiedAt: stats.mtimeMs, projectJson });
        }
        drafts.sort((a, b) => b.modifiedAt - a.modifiedAt);
        json(res, 200, { projects: drafts.map((entry) => entry.projectJson) });
        return;
      }

      if (method === "POST" && pathname === `${API_BASE}/save_imported_image`) {
        const payload = await readJsonBody<{
          project_id: string;
          project_title?: string;
          original_file_name: string;
          bytes: number[];
        }>(req);
        const projectTitle =
          (typeof payload.project_title === "string" ? payload.project_title.trim() : "") ||
          payload.project_id;
        const projectDir = await resolveProjectDir(root, payload.project_id, projectTitle);
        const projectFolder = path.basename(projectDir);
        const assetsDir = path.join(projectDir, PROJECT_ASSETS_DIR);
        await fsp.mkdir(assetsDir, { recursive: true });

        const originalPath = path.parse(payload.original_file_name);
        const stem = sanitizePathComponent(originalPath.name, "image");
        const ext = sanitizePathComponent((originalPath.ext || ".bin").replace(/^\./, ""), "bin").toLowerCase();
        const timestamp = Date.now();
        let index = 0;
        let fileName = `${stem}-${timestamp}.${ext}`;
        let assetPath = path.join(assetsDir, fileName);
        while (await fsp.stat(assetPath).then(() => true).catch(() => false)) {
          index += 1;
          fileName = `${stem}-${timestamp}-${index}.${ext}`;
          assetPath = path.join(assetsDir, fileName);
        }

        await fsp.writeFile(assetPath, Buffer.from(payload.bytes));
        json(res, 200, { path: `/projects/${projectFolder}/${PROJECT_ASSETS_DIR}/${fileName}` });
        return;
      }

      if (method === "POST" && pathname === `${API_BASE}/delete_project_draft`) {
        const payload = await readJsonBody<{ project_id: string }>(req);
        const projectDir = await findProjectDirById(root, payload.project_id);
        if (projectDir) {
          await fsp.rm(projectDir, { recursive: true, force: true });
        }
        await syncLatestProjectMeta(root);
        json(res, 200, { ok: true });
        return;
      }

      text(res, 404, "Not Found");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      json(res, 500, { error: message });
    }
  };

  middlewares.use(handler);
  closeHandlers.push(() => {
    // connect does not expose remove; process lifetime cleanup is sufficient.
  });
};

const webPersistencePlugin = () => ({
  name: "mangamaker-web-persistence",
  configureServer(server: ViteDevServer) {
    const closeHandlers: Array<() => void> = [];
    attachWebPersistenceMiddleware(server.middlewares, closeHandlers);
    server.httpServer?.once("close", () => closeHandlers.forEach((close) => close()));
  },
  configurePreviewServer(server: PreviewServer) {
    const closeHandlers: Array<() => void> = [];
    attachWebPersistenceMiddleware(server.middlewares, closeHandlers);
    server.httpServer?.once("close", () => closeHandlers.forEach((close) => close()));
  },
});

export default defineConfig({
  plugins: [react(), webPersistencePlugin()],
  server: {
    allowedHosts: ALLOWED_HOSTS,
  },
  preview: {
    allowedHosts: ALLOWED_HOSTS,
  },
});
