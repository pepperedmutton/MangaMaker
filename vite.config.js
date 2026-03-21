var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var __asyncValues = (this && this.__asyncValues) || function (o) {
    if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
    var m = o[Symbol.asyncIterator], i;
    return m ? m.call(o) : (o = typeof __values === "function" ? __values(o) : o[Symbol.iterator](), i = {}, verb("next"), verb("throw"), verb("return"), i[Symbol.asyncIterator] = function () { return this; }, i);
    function verb(n) { i[n] = o[n] && function (v) { return new Promise(function (resolve, reject) { v = o[n](v), settle(resolve, reject, v.done, v.value); }); }; }
    function settle(resolve, reject, d, v) { Promise.resolve(v).then(function(v) { resolve({ value: v, done: d }); }, reject); }
};
import fs from "node:fs";
import { promises as fsp } from "node:fs";
import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
var PROJECTS_DIR_NAME = "projects";
var PROJECT_META_FILE = ".latest_project";
var PROJECT_JSON_FILE = "project.json";
var PROJECT_ASSETS_DIR = "assets";
var API_BASE = "/__mangamaker__/persistence";
var SHARE_ALLOWED_HOSTS = [
    "gradio.live",
    ".gradio.live",
    "gradio-live.com",
    ".gradio-live.com",
];
var sanitizePathComponent = function (value, fallback) {
    var sanitized = value
        .split("")
        .map(function (char) { return (/^[a-zA-Z0-9_-]$/.test(char) ? char : "_"); })
        .join("")
        .replace(/^_+|_+$/g, "");
    return sanitized.length > 0 ? sanitized : fallback;
};
var ensureProjectsRoot = function () { return __awaiter(void 0, void 0, void 0, function () {
    var root;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                root = path.resolve(process.cwd(), PROJECTS_DIR_NAME);
                return [4 /*yield*/, fsp.mkdir(root, { recursive: true })];
            case 1:
                _a.sent();
                return [2 /*return*/, root];
        }
    });
}); };
var readProjectIdFromDir = function (projectDir) { return __awaiter(void 0, void 0, void 0, function () {
    var projectFile, raw, parsed;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                projectFile = path.join(projectDir, PROJECT_JSON_FILE);
                return [4 /*yield*/, fsp.readFile(projectFile, "utf8").catch(function () { return null; })];
            case 1:
                raw = _a.sent();
                if (!raw) {
                    return [2 /*return*/, null];
                }
                try {
                    parsed = JSON.parse(raw);
                    if (typeof parsed.id === "string" && parsed.id.trim().length > 0) {
                        return [2 /*return*/, parsed.id];
                    }
                    return [2 /*return*/, null];
                }
                catch (_b) {
                    return [2 /*return*/, null];
                }
                return [2 /*return*/];
        }
    });
}); };
var findProjectDirById = function (root, projectId) { return __awaiter(void 0, void 0, void 0, function () {
    var entries, _i, entries_1, entry, candidateDir, candidateProjectId;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0: return [4 /*yield*/, fsp.readdir(root, { withFileTypes: true })];
            case 1:
                entries = _a.sent();
                _i = 0, entries_1 = entries;
                _a.label = 2;
            case 2:
                if (!(_i < entries_1.length)) return [3 /*break*/, 5];
                entry = entries_1[_i];
                if (!entry.isDirectory()) {
                    return [3 /*break*/, 4];
                }
                candidateDir = path.join(root, entry.name);
                return [4 /*yield*/, readProjectIdFromDir(candidateDir)];
            case 3:
                candidateProjectId = _a.sent();
                if (candidateProjectId === projectId) {
                    return [2 /*return*/, candidateDir];
                }
                _a.label = 4;
            case 4:
                _i++;
                return [3 /*break*/, 2];
            case 5: return [2 /*return*/, null];
        }
    });
}); };
var pickProjectFolderName = function (root, projectId, preferredName) { return __awaiter(void 0, void 0, void 0, function () {
    var baseName, index, candidateName, candidateDir, stats, candidateProjectId;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                baseName = sanitizePathComponent(preferredName, "project");
                index = 1;
                _a.label = 1;
            case 1:
                if (!true) return [3 /*break*/, 4];
                candidateName = index === 1 ? baseName : "".concat(baseName, "-").concat(index);
                candidateDir = path.join(root, candidateName);
                return [4 /*yield*/, fsp.stat(candidateDir).catch(function () { return null; })];
            case 2:
                stats = _a.sent();
                if (!stats) {
                    return [2 /*return*/, candidateName];
                }
                if (!stats.isDirectory()) {
                    index += 1;
                    return [3 /*break*/, 1];
                }
                return [4 /*yield*/, readProjectIdFromDir(candidateDir)];
            case 3:
                candidateProjectId = _a.sent();
                if (candidateProjectId === projectId) {
                    return [2 /*return*/, candidateName];
                }
                index += 1;
                return [3 /*break*/, 1];
            case 4: return [2 /*return*/];
        }
    });
}); };
var resolveProjectDir = function (root, projectId, projectTitle) { return __awaiter(void 0, void 0, void 0, function () {
    var existingDir, targetFolder, targetDir, targetStats;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0: return [4 /*yield*/, findProjectDirById(root, projectId)];
            case 1:
                existingDir = _a.sent();
                return [4 /*yield*/, pickProjectFolderName(root, projectId, projectTitle)];
            case 2:
                targetFolder = _a.sent();
                targetDir = path.join(root, targetFolder);
                if (!(existingDir && path.resolve(existingDir) !== path.resolve(targetDir))) return [3 /*break*/, 6];
                return [4 /*yield*/, fsp.stat(targetDir).catch(function () { return null; })];
            case 3:
                targetStats = _a.sent();
                if (!!targetStats) return [3 /*break*/, 5];
                return [4 /*yield*/, fsp.rename(existingDir, targetDir)];
            case 4:
                _a.sent();
                _a.label = 5;
            case 5: return [2 /*return*/, targetDir];
            case 6:
                if (existingDir) {
                    return [2 /*return*/, existingDir];
                }
                return [2 /*return*/, targetDir];
        }
    });
}); };
var findLatestProjectFolder = function (root) { return __awaiter(void 0, void 0, void 0, function () {
    var entries, latestFolder, latestModifiedAt, _i, entries_2, entry, projectFile, stats;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0: return [4 /*yield*/, fsp.readdir(root, { withFileTypes: true })];
            case 1:
                entries = _a.sent();
                latestFolder = null;
                latestModifiedAt = 0;
                _i = 0, entries_2 = entries;
                _a.label = 2;
            case 2:
                if (!(_i < entries_2.length)) return [3 /*break*/, 5];
                entry = entries_2[_i];
                if (!entry.isDirectory()) {
                    return [3 /*break*/, 4];
                }
                projectFile = path.join(root, entry.name, PROJECT_JSON_FILE);
                return [4 /*yield*/, fsp.stat(projectFile).catch(function () { return null; })];
            case 3:
                stats = _a.sent();
                if (!(stats === null || stats === void 0 ? void 0 : stats.isFile())) {
                    return [3 /*break*/, 4];
                }
                if (stats.mtimeMs > latestModifiedAt) {
                    latestModifiedAt = stats.mtimeMs;
                    latestFolder = entry.name;
                }
                _a.label = 4;
            case 4:
                _i++;
                return [3 /*break*/, 2];
            case 5: return [2 /*return*/, latestFolder];
        }
    });
}); };
var syncLatestProjectMeta = function (root) { return __awaiter(void 0, void 0, void 0, function () {
    var latestFolder, metaFile;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0: return [4 /*yield*/, findLatestProjectFolder(root)];
            case 1:
                latestFolder = _a.sent();
                metaFile = path.join(root, PROJECT_META_FILE);
                if (!latestFolder) return [3 /*break*/, 3];
                return [4 /*yield*/, fsp.writeFile(metaFile, latestFolder, "utf8")];
            case 2:
                _a.sent();
                return [2 /*return*/];
            case 3: return [4 /*yield*/, fsp.rm(metaFile, { force: true })];
            case 4:
                _a.sent();
                return [2 /*return*/];
        }
    });
}); };
var json = function (res, status, payload) {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(payload));
};
var text = function (res, status, body) {
    res.statusCode = status;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end(body);
};
var readJsonBody = function (req) { return __awaiter(void 0, void 0, void 0, function () {
    var chunks, chunk, e_1_1, raw;
    var _a, req_1, req_1_1;
    var _b, e_1, _c, _d;
    return __generator(this, function (_e) {
        switch (_e.label) {
            case 0:
                chunks = [];
                _e.label = 1;
            case 1:
                _e.trys.push([1, 6, 7, 12]);
                _a = true, req_1 = __asyncValues(req);
                _e.label = 2;
            case 2: return [4 /*yield*/, req_1.next()];
            case 3:
                if (!(req_1_1 = _e.sent(), _b = req_1_1.done, !_b)) return [3 /*break*/, 5];
                _d = req_1_1.value;
                _a = false;
                chunk = _d;
                chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
                _e.label = 4;
            case 4:
                _a = true;
                return [3 /*break*/, 2];
            case 5: return [3 /*break*/, 12];
            case 6:
                e_1_1 = _e.sent();
                e_1 = { error: e_1_1 };
                return [3 /*break*/, 12];
            case 7:
                _e.trys.push([7, , 10, 11]);
                if (!(!_a && !_b && (_c = req_1.return))) return [3 /*break*/, 9];
                return [4 /*yield*/, _c.call(req_1)];
            case 8:
                _e.sent();
                _e.label = 9;
            case 9: return [3 /*break*/, 11];
            case 10:
                if (e_1) throw e_1.error;
                return [7 /*endfinally*/];
            case 11: return [7 /*endfinally*/];
            case 12:
                raw = Buffer.concat(chunks).toString("utf8");
                if (!raw) {
                    throw new Error("Empty request body");
                }
                return [2 /*return*/, JSON.parse(raw)];
        }
    });
}); };
var inferContentType = function (filePath) {
    var ext = path.extname(filePath).toLowerCase();
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
var attachWebPersistenceMiddleware = function (middlewares, closeHandlers) {
    var handler = function (req, res, next) { return __awaiter(void 0, void 0, void 0, function () {
        var method, host, url, pathname, root_1, relative, candidate, rootWithSep, stats, stream, root, payload, titleFromJson, parsed, projectTitle, projectDir, projectFolder, assetsDir, metaFile, metaExists, latestProject, folder, projectFile, projectExists, projectJson, entries, drafts, _i, entries_3, entry, projectFile, stats, projectJson, payload, projectTitle, projectDir, projectFolder, assetsDir, originalPath, stem, ext, timestamp, index, fileName, assetPath, payload, projectDir, error_1, message;
        var _a, _b, _c;
        return __generator(this, function (_d) {
            switch (_d.label) {
                case 0:
                    method = (_b = (_a = req.method) === null || _a === void 0 ? void 0 : _a.toUpperCase()) !== null && _b !== void 0 ? _b : "GET";
                    host = req.headers.host;
                    url = new URL((_c = req.url) !== null && _c !== void 0 ? _c : "/", host ? "http://".concat(host) : "http://localhost");
                    pathname = url.pathname;
                    _d.label = 1;
                case 1:
                    _d.trys.push([1, 38, , 39]);
                    if (!(method === "GET" && pathname.startsWith("/projects/"))) return [3 /*break*/, 4];
                    return [4 /*yield*/, ensureProjectsRoot()];
                case 2:
                    root_1 = _d.sent();
                    relative = decodeURIComponent(pathname.slice("/projects/".length));
                    candidate = path.resolve(root_1, relative);
                    rootWithSep = root_1.endsWith(path.sep) ? root_1 : "".concat(root_1).concat(path.sep);
                    if (!candidate.startsWith(rootWithSep)) {
                        text(res, 403, "Forbidden");
                        return [2 /*return*/];
                    }
                    return [4 /*yield*/, fsp.stat(candidate).catch(function () { return null; })];
                case 3:
                    stats = _d.sent();
                    if (!stats || !stats.isFile()) {
                        next();
                        return [2 /*return*/];
                    }
                    stream = fs.createReadStream(candidate);
                    res.statusCode = 200;
                    res.setHeader("Content-Type", inferContentType(candidate));
                    stream.pipe(res);
                    return [2 /*return*/];
                case 4:
                    if (!pathname.startsWith(API_BASE)) {
                        next();
                        return [2 /*return*/];
                    }
                    return [4 /*yield*/, ensureProjectsRoot()];
                case 5:
                    root = _d.sent();
                    if (method === "GET" && pathname === "".concat(API_BASE, "/health")) {
                        json(res, 200, { ok: true });
                        return [2 /*return*/];
                    }
                    if (!(method === "POST" && pathname === "".concat(API_BASE, "/write_project_draft"))) return [3 /*break*/, 11];
                    return [4 /*yield*/, readJsonBody(req)];
                case 6:
                    payload = _d.sent();
                    titleFromJson = "";
                    try {
                        parsed = JSON.parse(payload.project_json);
                        if (typeof parsed.title === "string") {
                            titleFromJson = parsed.title.trim();
                        }
                    }
                    catch (_e) {
                        titleFromJson = "";
                    }
                    projectTitle = titleFromJson ||
                        (typeof payload.project_title === "string" ? payload.project_title.trim() : "") ||
                        payload.project_id;
                    return [4 /*yield*/, resolveProjectDir(root, payload.project_id, projectTitle)];
                case 7:
                    projectDir = _d.sent();
                    projectFolder = path.basename(projectDir);
                    assetsDir = path.join(projectDir, PROJECT_ASSETS_DIR);
                    return [4 /*yield*/, fsp.mkdir(assetsDir, { recursive: true })];
                case 8:
                    _d.sent();
                    return [4 /*yield*/, fsp.writeFile(path.join(projectDir, PROJECT_JSON_FILE), payload.project_json, "utf8")];
                case 9:
                    _d.sent();
                    return [4 /*yield*/, fsp.writeFile(path.join(root, PROJECT_META_FILE), projectFolder, "utf8")];
                case 10:
                    _d.sent();
                    json(res, 200, { path: "/projects/".concat(projectFolder, "/").concat(PROJECT_JSON_FILE) });
                    return [2 /*return*/];
                case 11:
                    if (!(method === "GET" && pathname === "".concat(API_BASE, "/read_project_draft"))) return [3 /*break*/, 16];
                    metaFile = path.join(root, PROJECT_META_FILE);
                    return [4 /*yield*/, fsp.stat(metaFile).catch(function () { return null; })];
                case 12:
                    metaExists = _d.sent();
                    if (!(metaExists === null || metaExists === void 0 ? void 0 : metaExists.isFile())) {
                        json(res, 200, { project_json: null });
                        return [2 /*return*/];
                    }
                    return [4 /*yield*/, fsp.readFile(metaFile, "utf8")];
                case 13:
                    latestProject = (_d.sent()).trim();
                    folder = sanitizePathComponent(latestProject, "project");
                    projectFile = path.join(root, folder, PROJECT_JSON_FILE);
                    return [4 /*yield*/, fsp.stat(projectFile).catch(function () { return null; })];
                case 14:
                    projectExists = _d.sent();
                    if (!(projectExists === null || projectExists === void 0 ? void 0 : projectExists.isFile())) {
                        json(res, 200, { project_json: null });
                        return [2 /*return*/];
                    }
                    return [4 /*yield*/, fsp.readFile(projectFile, "utf8")];
                case 15:
                    projectJson = _d.sent();
                    json(res, 200, { project_json: projectJson });
                    return [2 /*return*/];
                case 16:
                    if (!(method === "GET" && pathname === "".concat(API_BASE, "/list_project_drafts"))) return [3 /*break*/, 23];
                    return [4 /*yield*/, fsp.readdir(root, { withFileTypes: true })];
                case 17:
                    entries = _d.sent();
                    drafts = [];
                    _i = 0, entries_3 = entries;
                    _d.label = 18;
                case 18:
                    if (!(_i < entries_3.length)) return [3 /*break*/, 22];
                    entry = entries_3[_i];
                    if (!entry.isDirectory()) {
                        return [3 /*break*/, 21];
                    }
                    projectFile = path.join(root, entry.name, PROJECT_JSON_FILE);
                    return [4 /*yield*/, fsp.stat(projectFile).catch(function () { return null; })];
                case 19:
                    stats = _d.sent();
                    if (!(stats === null || stats === void 0 ? void 0 : stats.isFile())) {
                        return [3 /*break*/, 21];
                    }
                    return [4 /*yield*/, fsp.readFile(projectFile, "utf8")];
                case 20:
                    projectJson = _d.sent();
                    drafts.push({ modifiedAt: stats.mtimeMs, projectJson: projectJson });
                    _d.label = 21;
                case 21:
                    _i++;
                    return [3 /*break*/, 18];
                case 22:
                    drafts.sort(function (a, b) { return b.modifiedAt - a.modifiedAt; });
                    json(res, 200, { projects: drafts.map(function (entry) { return entry.projectJson; }) });
                    return [2 /*return*/];
                case 23:
                    if (!(method === "POST" && pathname === "".concat(API_BASE, "/save_imported_image"))) return [3 /*break*/, 31];
                    return [4 /*yield*/, readJsonBody(req)];
                case 24:
                    payload = _d.sent();
                    projectTitle = (typeof payload.project_title === "string" ? payload.project_title.trim() : "") ||
                        payload.project_id;
                    return [4 /*yield*/, resolveProjectDir(root, payload.project_id, projectTitle)];
                case 25:
                    projectDir = _d.sent();
                    projectFolder = path.basename(projectDir);
                    assetsDir = path.join(projectDir, PROJECT_ASSETS_DIR);
                    return [4 /*yield*/, fsp.mkdir(assetsDir, { recursive: true })];
                case 26:
                    _d.sent();
                    originalPath = path.parse(payload.original_file_name);
                    stem = sanitizePathComponent(originalPath.name, "image");
                    ext = sanitizePathComponent((originalPath.ext || ".bin").replace(/^\./, ""), "bin").toLowerCase();
                    timestamp = Date.now();
                    index = 0;
                    fileName = "".concat(stem, "-").concat(timestamp, ".").concat(ext);
                    assetPath = path.join(assetsDir, fileName);
                    _d.label = 27;
                case 27: return [4 /*yield*/, fsp.stat(assetPath).then(function () { return true; }).catch(function () { return false; })];
                case 28:
                    if (!_d.sent()) return [3 /*break*/, 29];
                    index += 1;
                    fileName = "".concat(stem, "-").concat(timestamp, "-").concat(index, ".").concat(ext);
                    assetPath = path.join(assetsDir, fileName);
                    return [3 /*break*/, 27];
                case 29: return [4 /*yield*/, fsp.writeFile(assetPath, Buffer.from(payload.bytes))];
                case 30:
                    _d.sent();
                    json(res, 200, { path: "/projects/".concat(projectFolder, "/").concat(PROJECT_ASSETS_DIR, "/").concat(fileName) });
                    return [2 /*return*/];
                case 31:
                    if (!(method === "POST" && pathname === "".concat(API_BASE, "/delete_project_draft"))) return [3 /*break*/, 37];
                    return [4 /*yield*/, readJsonBody(req)];
                case 32:
                    payload = _d.sent();
                    return [4 /*yield*/, findProjectDirById(root, payload.project_id)];
                case 33:
                    projectDir = _d.sent();
                    if (!projectDir) return [3 /*break*/, 35];
                    return [4 /*yield*/, fsp.rm(projectDir, { recursive: true, force: true })];
                case 34:
                    _d.sent();
                    _d.label = 35;
                case 35: return [4 /*yield*/, syncLatestProjectMeta(root)];
                case 36:
                    _d.sent();
                    json(res, 200, { ok: true });
                    return [2 /*return*/];
                case 37:
                    text(res, 404, "Not Found");
                    return [3 /*break*/, 39];
                case 38:
                    error_1 = _d.sent();
                    message = error_1 instanceof Error ? error_1.message : String(error_1);
                    json(res, 500, { error: message });
                    return [3 /*break*/, 39];
                case 39: return [2 /*return*/];
            }
        });
    }); };
    middlewares.use(handler);
    closeHandlers.push(function () {
        // connect does not expose remove; process lifetime cleanup is sufficient.
    });
};
var webPersistencePlugin = function () { return ({
    name: "mangamaker-web-persistence",
    configureServer: function (server) {
        var _a;
        var closeHandlers = [];
        attachWebPersistenceMiddleware(server.middlewares, closeHandlers);
        (_a = server.httpServer) === null || _a === void 0 ? void 0 : _a.once("close", function () { return closeHandlers.forEach(function (close) { return close(); }); });
    },
    configurePreviewServer: function (server) {
        var _a;
        var closeHandlers = [];
        attachWebPersistenceMiddleware(server.middlewares, closeHandlers);
        (_a = server.httpServer) === null || _a === void 0 ? void 0 : _a.once("close", function () { return closeHandlers.forEach(function (close) { return close(); }); });
    },
}); };
export default defineConfig({
    plugins: [react(), webPersistencePlugin()],
    server: {
        allowedHosts: SHARE_ALLOWED_HOSTS,
    },
    preview: {
        allowedHosts: SHARE_ALLOWED_HOSTS,
    },
});
