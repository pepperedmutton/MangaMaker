import fs from "node:fs";
import { promises as fsp } from "node:fs";
import path from "node:path";
import { createHash, timingSafeEqual } from "node:crypto";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
const PROJECTS_DIR_NAME = "projects";
const PROJECT_META_FILE = ".latest_project";
const PROJECT_JSON_FILE = "project.json";
const PROJECT_ASSETS_DIR = "assets";
const API_BASE = "/__mangamaker__/persistence";
const AUTH_PASSWORD = "19260817";
const AUTH_COOKIE_NAME = "mangamaker_auth";
const AUTH_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const AUTH_LOGIN_PATH = "/__mangamaker__/auth/login";
const AUTH_COOKIE_TOKEN = createHash("sha256")
    .update(`mangamaker:${AUTH_PASSWORD}`)
    .digest("hex");
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
const ALLOWED_HOSTS = Array.from(new Set([
    ...SHARE_ALLOWED_HOSTS,
    ...RENDER_ALLOWED_HOSTS,
    ...(renderExternalHostname ? [renderExternalHostname] : []),
]));
const sanitizePathComponent = (value, fallback) => {
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
const readProjectIdFromDir = async (projectDir) => {
    const projectFile = path.join(projectDir, PROJECT_JSON_FILE);
    const raw = await fsp.readFile(projectFile, "utf8").catch(() => null);
    if (!raw) {
        return null;
    }
    try {
        const parsed = JSON.parse(raw);
        if (typeof parsed.id === "string" && parsed.id.trim().length > 0) {
            return parsed.id;
        }
        return null;
    }
    catch {
        return null;
    }
};
const findProjectDirById = async (root, projectId) => {
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
const pickProjectFolderName = async (root, projectId, preferredName) => {
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
const resolveProjectDir = async (root, projectId, projectTitle) => {
    const existingDir = await findProjectDirById(root, projectId);
    if (existingDir) {
        return existingDir;
    }
    const targetFolder = await pickProjectFolderName(root, projectId, projectTitle);
    return path.join(root, targetFolder);
};
const normalizeProjectAssetPaths = (projectJson, projectFolder) => {
    let parsed;
    try {
        parsed = JSON.parse(projectJson);
    }
    catch {
        return projectJson;
    }
    if (!parsed || typeof parsed !== "object") {
        return projectJson;
    }
    const draft = parsed;
    if (!Array.isArray(draft.pages)) {
        return projectJson;
    }
    let changed = false;
    for (const page of draft.pages) {
        if (!page || typeof page !== "object" || !Array.isArray(page.panels)) {
            continue;
        }
        for (const panel of page.panels) {
            if (!panel || typeof panel !== "object" || !panel.image || typeof panel.image !== "object") {
                continue;
            }
            const src = panel.image.src;
            if (typeof src !== "string") {
                continue;
            }
            const prefix = "/projects/";
            const assetsSegment = `/${PROJECT_ASSETS_DIR}/`;
            if (!src.startsWith(prefix)) {
                continue;
            }
            const assetsIndex = src.indexOf(assetsSegment, prefix.length);
            if (assetsIndex <= prefix.length) {
                continue;
            }
            const folderInSrc = src.slice(prefix.length, assetsIndex);
            if (!folderInSrc || folderInSrc === projectFolder) {
                continue;
            }
            const assetSuffix = src.slice(assetsIndex + assetsSegment.length);
            panel.image.src = `${prefix}${projectFolder}${assetsSegment}${assetSuffix}`;
            changed = true;
        }
    }
    return changed ? JSON.stringify(parsed) : projectJson;
};
const PROJECT_ASSET_PATH_PATTERN = /^\/projects\/([^/]+)\/assets\/(.+)$/;
const extractProjectAssetReferences = (projectJson) => {
    let parsed;
    try {
        parsed = JSON.parse(projectJson);
    }
    catch {
        return [];
    }
    const seen = new Set();
    const references = [];
    const visit = (value) => {
        if (typeof value === "string") {
            const match = value.match(PROJECT_ASSET_PATH_PATTERN);
            if (!match) {
                return;
            }
            const sourceFolder = sanitizePathComponent(match[1] ?? "", "");
            if (!sourceFolder) {
                return;
            }
            let assetRelativePath = (match[2] ?? "").trim();
            if (!assetRelativePath) {
                return;
            }
            try {
                assetRelativePath = decodeURIComponent(assetRelativePath);
            }
            catch {
                // Keep raw path when decoding fails.
            }
            assetRelativePath = assetRelativePath.replace(/\\/g, "/").replace(/^\/+/, "");
            if (!assetRelativePath) {
                return;
            }
            const key = `${sourceFolder}/${assetRelativePath}`;
            if (seen.has(key)) {
                return;
            }
            seen.add(key);
            references.push({
                sourceFolder,
                assetRelativePath,
            });
            return;
        }
        if (Array.isArray(value)) {
            for (const entry of value) {
                visit(entry);
            }
            return;
        }
        if (!value || typeof value !== "object") {
            return;
        }
        for (const entry of Object.values(value)) {
            visit(entry);
        }
    };
    visit(parsed);
    return references;
};
const resolvePathInsideRoot = (root, relative) => {
    const candidate = path.resolve(root, relative);
    const rootWithSep = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
    if (!candidate.startsWith(rootWithSep)) {
        return null;
    }
    return candidate;
};
const copyReferencedProjectAssets = async (root, targetProjectFolder, targetAssetsDir, references) => {
    for (const reference of references) {
        if (reference.sourceFolder === targetProjectFolder) {
            continue;
        }
        const sourceAssetsDir = path.join(root, reference.sourceFolder, PROJECT_ASSETS_DIR);
        const sourcePath = resolvePathInsideRoot(sourceAssetsDir, reference.assetRelativePath);
        const targetPath = resolvePathInsideRoot(targetAssetsDir, reference.assetRelativePath);
        if (!sourcePath || !targetPath) {
            continue;
        }
        const sourceStats = await fsp.stat(sourcePath).catch(() => null);
        if (!sourceStats?.isFile()) {
            continue;
        }
        const targetStats = await fsp.stat(targetPath).catch(() => null);
        if (targetStats?.isFile()) {
            continue;
        }
        await fsp.mkdir(path.dirname(targetPath), { recursive: true });
        await fsp.copyFile(sourcePath, targetPath);
    }
};
const findLatestProjectFolder = async (root) => {
    const entries = await fsp.readdir(root, { withFileTypes: true });
    let latestFolder = null;
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
const syncLatestProjectMeta = async (root) => {
    const latestFolder = await findLatestProjectFolder(root);
    const metaFile = path.join(root, PROJECT_META_FILE);
    if (latestFolder) {
        await fsp.writeFile(metaFile, latestFolder, "utf8");
        return;
    }
    await fsp.rm(metaFile, { force: true });
};
const json = (res, status, payload) => {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(payload));
};
const text = (res, status, body) => {
    res.statusCode = status;
    const trimmed = body.trimStart().toLowerCase();
    const isHtml = trimmed.startsWith("<!doctype html") || trimmed.startsWith("<html");
    res.setHeader("Content-Type", isHtml ? "text/html; charset=utf-8" : "text/plain; charset=utf-8");
    res.end(body);
};
const readRawBody = async (req) => {
    const chunks = [];
    for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString("utf8");
};
const readJsonBody = async (req) => {
    const raw = await readRawBody(req);
    if (!raw) {
        throw new Error("Empty request body");
    }
    return JSON.parse(raw);
};
const requestExpectsJson = (req, pathname) => {
    const accept = String(req.headers.accept ?? "").toLowerCase();
    const contentType = String(req.headers["content-type"] ?? "").toLowerCase();
    return pathname.startsWith(API_BASE) || accept.includes("application/json") || contentType.includes("application/json");
};
const parseCookies = (req) => {
    const raw = String(req.headers.cookie ?? "");
    if (!raw) {
        return new Map();
    }
    const cookies = new Map();
    const entries = raw.split(";");
    for (const entry of entries) {
        const separator = entry.indexOf("=");
        if (separator <= 0) {
            continue;
        }
        const name = entry.slice(0, separator).trim();
        const value = entry.slice(separator + 1).trim();
        if (!name) {
            continue;
        }
        try {
            cookies.set(name, decodeURIComponent(value));
        }
        catch {
            cookies.set(name, value);
        }
    }
    return cookies;
};
const isSecureRequest = (req) => {
    const forwardedProto = String(req.headers["x-forwarded-proto"] ?? "")
        .split(",")[0]
        ?.trim()
        .toLowerCase();
    if (forwardedProto === "https") {
        return true;
    }
    const encrypted = req.socket.encrypted;
    return encrypted === true;
};
const buildAuthCookie = (req) => {
    const attributes = [
        `${AUTH_COOKIE_NAME}=${encodeURIComponent(AUTH_COOKIE_TOKEN)}`,
        "Path=/",
        `Max-Age=${AUTH_COOKIE_MAX_AGE_SECONDS}`,
        "HttpOnly",
        "SameSite=Lax",
    ];
    if (isSecureRequest(req)) {
        attributes.push("Secure");
    }
    return attributes.join("; ");
};
const hasValidAuthCookie = (req) => {
    const cookies = parseCookies(req);
    const token = cookies.get(AUTH_COOKIE_NAME);
    if (!token) {
        return false;
    }
    const expected = Buffer.from(AUTH_COOKIE_TOKEN, "utf8");
    const received = Buffer.from(token, "utf8");
    if (received.length !== expected.length) {
        return false;
    }
    return timingSafeEqual(received, expected);
};
const escapeHtml = (value) => value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
const normalizeNextPath = (value) => {
    const normalized = String(value ?? "").trim();
    if (!normalized.startsWith("/") || normalized.startsWith("//")) {
        return "/";
    }
    if (normalized.startsWith(AUTH_LOGIN_PATH)) {
        return "/";
    }
    return normalized;
};
const renderPasswordLoginPage = (nextPath, errorMessage) => {
    const errorBlock = errorMessage
        ? `<p class="auth-error">${escapeHtml(errorMessage)}</p>`
        : "";
    const escapedNext = escapeHtml(nextPath);
    return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>MangaMaker 登录</title>
    <style>
      :root {
        color-scheme: light;
      }
      * {
        box-sizing: border-box;
      }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        font-family: "Source Han Sans", "PingFang SC", "Microsoft YaHei", sans-serif;
        background: radial-gradient(circle at 20% 20%, #efe9dc 0%, #e1d3bd 48%, #cfb18c 100%);
        color: #2d241b;
      }
      .auth-card {
        width: min(420px, calc(100vw - 32px));
        padding: 28px;
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.92);
        box-shadow: 0 18px 42px rgba(45, 36, 27, 0.22);
      }
      h1 {
        margin: 0 0 6px;
        font-size: 26px;
      }
      p {
        margin: 0 0 18px;
        color: #5c4a3a;
      }
      label {
        display: block;
        margin: 0 0 10px;
        font-weight: 600;
      }
      input[type="password"] {
        width: 100%;
        border: 1px solid #b89a7b;
        border-radius: 10px;
        padding: 12px 14px;
        font-size: 16px;
        outline: none;
      }
      input[type="password"]:focus {
        border-color: #8f5b2f;
        box-shadow: 0 0 0 2px rgba(143, 91, 47, 0.15);
      }
      button {
        margin-top: 14px;
        width: 100%;
        border: 0;
        border-radius: 10px;
        padding: 12px 14px;
        font-size: 16px;
        font-weight: 700;
        color: #fff;
        background: linear-gradient(135deg, #8f5b2f, #6f4a2c);
        cursor: pointer;
      }
      .auth-error {
        margin: 0 0 12px;
        color: #b42318;
        font-weight: 600;
      }
    </style>
  </head>
  <body>
    <main class="auth-card">
      <h1>MangaMaker</h1>
      <p>请输入访问密码</p>
      ${errorBlock}
      <form method="post" action="${AUTH_LOGIN_PATH}">
        <input type="hidden" name="next" value="${escapedNext}" />
        <label for="password">密码</label>
        <input id="password" name="password" type="password" autocomplete="current-password" autofocus required />
        <button type="submit">登录</button>
      </form>
    </main>
  </body>
</html>`;
};
const readLoginPayload = async (req) => {
    const contentType = String(req.headers["content-type"] ?? "").toLowerCase();
    const raw = await readRawBody(req);
    if (!raw) {
        return { password: "", next: "/" };
    }
    if (contentType.includes("application/json")) {
        const parsed = JSON.parse(raw);
        return {
            password: typeof parsed.password === "string" ? parsed.password : "",
            next: normalizeNextPath(typeof parsed.next === "string" ? parsed.next : "/"),
        };
    }
    const params = new URLSearchParams(raw);
    return {
        password: String(params.get("password") ?? ""),
        next: normalizeNextPath(params.get("next")),
    };
};
const appendCookieHeader = (res, cookie) => {
    const current = res.getHeader("Set-Cookie");
    if (!current) {
        res.setHeader("Set-Cookie", cookie);
        return;
    }
    if (Array.isArray(current)) {
        res.setHeader("Set-Cookie", [...current.map(String), cookie]);
        return;
    }
    res.setHeader("Set-Cookie", [String(current), cookie]);
};
const clearAuthCookie = (req) => {
    const attributes = [
        `${AUTH_COOKIE_NAME}=`,
        "Path=/",
        "Max-Age=0",
        "HttpOnly",
        "SameSite=Lax",
    ];
    if (isSecureRequest(req)) {
        attributes.push("Secure");
    }
    return attributes.join("; ");
};
const redirect = (res, location) => {
    res.statusCode = 302;
    res.setHeader("Location", location);
    res.end();
};
const isSafeStringEqual = (left, right) => {
    const leftBuffer = Buffer.from(left, "utf8");
    const rightBuffer = Buffer.from(right, "utf8");
    if (leftBuffer.length !== rightBuffer.length) {
        return false;
    }
    try {
        return timingSafeEqual(leftBuffer, rightBuffer);
    }
    catch {
        return false;
    }
};
const attachWebAuthMiddleware = (middlewares) => {
    const handler = async (req, res, next) => {
        const method = req.method?.toUpperCase() ?? "GET";
        const host = req.headers.host;
        const url = new URL(req.url ?? "/", host ? `http://${host}` : "http://localhost");
        const pathname = url.pathname;
        if (pathname === `${API_BASE}/health`) {
            next();
            return;
        }
        if (pathname === AUTH_LOGIN_PATH && method === "GET") {
            if (hasValidAuthCookie(req)) {
                redirect(res, normalizeNextPath(url.searchParams.get("next")));
                return;
            }
            text(res, 200, renderPasswordLoginPage(normalizeNextPath(url.searchParams.get("next"))));
            return;
        }
        if (pathname === AUTH_LOGIN_PATH && method === "POST") {
            const payload = await readLoginPayload(req);
            const nextPath = normalizeNextPath(payload.next);
            if (isSafeStringEqual(payload.password, AUTH_PASSWORD)) {
                appendCookieHeader(res, buildAuthCookie(req));
                if (requestExpectsJson(req, pathname)) {
                    json(res, 200, { ok: true, next: nextPath });
                    return;
                }
                redirect(res, nextPath);
                return;
            }
            appendCookieHeader(res, clearAuthCookie(req));
            if (requestExpectsJson(req, pathname)) {
                json(res, 401, { error: "Invalid password" });
                return;
            }
            text(res, 401, renderPasswordLoginPage(nextPath, "密码错误，请重试。"));
            return;
        }
        if (hasValidAuthCookie(req)) {
            next();
            return;
        }
        const nextPath = normalizeNextPath(`${pathname}${url.search}`);
        const loginUrl = `${AUTH_LOGIN_PATH}?next=${encodeURIComponent(nextPath)}`;
        if (requestExpectsJson(req, pathname) || method !== "GET") {
            json(res, 401, {
                error: "Authentication required",
                login: loginUrl,
            });
            return;
        }
        redirect(res, loginUrl);
    };
    middlewares.use(handler);
};
const inferContentType = (filePath) => {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === ".png")
        return "image/png";
    if (ext === ".jpg" || ext === ".jpeg")
        return "image/jpeg";
    if (ext === ".gif")
        return "image/gif";
    if (ext === ".webp")
        return "image/webp";
    if (ext === ".bmp")
        return "image/bmp";
    if (ext === ".svg")
        return "image/svg+xml";
    if (ext === ".json")
        return "application/json; charset=utf-8";
    return "application/octet-stream";
};
const attachWebPersistenceMiddleware = (middlewares, closeHandlers) => {
    const handler = async (req, res, next) => {
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
                const payload = await readJsonBody(req);
                let titleFromJson = "";
                try {
                    const parsed = JSON.parse(payload.project_json);
                    if (typeof parsed.title === "string") {
                        titleFromJson = parsed.title.trim();
                    }
                }
                catch {
                    titleFromJson = "";
                }
                const projectTitle = titleFromJson ||
                    (typeof payload.project_title === "string" ? payload.project_title.trim() : "") ||
                    payload.project_id;
                const projectDir = await resolveProjectDir(root, payload.project_id, projectTitle);
                const projectFolder = path.basename(projectDir);
                const assetsDir = path.join(projectDir, PROJECT_ASSETS_DIR);
                await fsp.mkdir(assetsDir, { recursive: true });
                const assetReferences = extractProjectAssetReferences(payload.project_json);
                await copyReferencedProjectAssets(root, projectFolder, assetsDir, assetReferences);
                const normalizedProjectJson = normalizeProjectAssetPaths(payload.project_json, projectFolder);
                await fsp.writeFile(path.join(projectDir, PROJECT_JSON_FILE), normalizedProjectJson, "utf8");
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
                const normalizedProjectJson = normalizeProjectAssetPaths(projectJson, folder);
                if (normalizedProjectJson !== projectJson) {
                    await fsp.writeFile(projectFile, normalizedProjectJson, "utf8");
                }
                json(res, 200, { project_json: normalizedProjectJson });
                return;
            }
            if (method === "GET" && pathname === `${API_BASE}/list_project_drafts`) {
                const entries = await fsp.readdir(root, { withFileTypes: true });
                const drafts = [];
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
                    const normalizedProjectJson = normalizeProjectAssetPaths(projectJson, entry.name);
                    if (normalizedProjectJson !== projectJson) {
                        await fsp.writeFile(projectFile, normalizedProjectJson, "utf8");
                    }
                    drafts.push({ modifiedAt: stats.mtimeMs, projectJson: normalizedProjectJson });
                }
                drafts.sort((a, b) => b.modifiedAt - a.modifiedAt);
                json(res, 200, { projects: drafts.map((entry) => entry.projectJson) });
                return;
            }
            if (method === "POST" && pathname === `${API_BASE}/save_imported_image`) {
                const payload = await readJsonBody(req);
                const projectTitle = (typeof payload.project_title === "string" ? payload.project_title.trim() : "") ||
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
                const payload = await readJsonBody(req);
                const projectDir = await findProjectDirById(root, payload.project_id);
                if (projectDir) {
                    await fsp.rm(projectDir, { recursive: true, force: true });
                }
                await syncLatestProjectMeta(root);
                json(res, 200, { ok: true });
                return;
            }
            text(res, 404, "Not Found");
        }
        catch (error) {
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
    configureServer(server) {
        const closeHandlers = [];
        attachWebPersistenceMiddleware(server.middlewares, closeHandlers);
        server.httpServer?.once("close", () => closeHandlers.forEach((close) => close()));
    },
    configurePreviewServer(server) {
        const closeHandlers = [];
        attachWebPersistenceMiddleware(server.middlewares, closeHandlers);
        server.httpServer?.once("close", () => closeHandlers.forEach((close) => close()));
    },
});
const webAuthPlugin = () => ({
    name: "mangamaker-web-auth",
    configureServer(server) {
        attachWebAuthMiddleware(server.middlewares);
    },
    configurePreviewServer(server) {
        attachWebAuthMiddleware(server.middlewares);
    },
});
export default defineConfig({
    plugins: [react(), webAuthPlugin(), webPersistencePlugin()],
    server: {
        allowedHosts: ALLOWED_HOSTS,
    },
    preview: {
        allowedHosts: ALLOWED_HOSTS,
    },
});
