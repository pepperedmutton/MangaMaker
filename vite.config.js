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
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
var _a;
import fs from "node:fs";
import { promises as fsp } from "node:fs";
import path from "node:path";
import { createHash, timingSafeEqual } from "node:crypto";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
var PROJECTS_DIR_NAME = "projects";
var PROJECT_META_FILE = ".latest_project";
var PROJECT_JSON_FILE = "project.json";
var PROJECT_ASSETS_DIR = "assets";
var API_BASE = "/__mangamaker__/persistence";
var AUTH_PASSWORD = "19260817";
var AUTH_COOKIE_NAME = "mangamaker_auth";
var AUTH_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
var AUTH_LOGIN_PATH = "/__mangamaker__/auth/login";
var AUTH_COOKIE_TOKEN = createHash("sha256")
    .update("mangamaker:".concat(AUTH_PASSWORD))
    .digest("hex");
var SHARE_ALLOWED_HOSTS = [
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
var RENDER_ALLOWED_HOSTS = ["onrender.com", ".onrender.com"];
var renderExternalHostname = (_a = process.env.RENDER_EXTERNAL_HOSTNAME) === null || _a === void 0 ? void 0 : _a.trim();
var ALLOWED_HOSTS = Array.from(new Set(__spreadArray(__spreadArray(__spreadArray([], SHARE_ALLOWED_HOSTS, true), RENDER_ALLOWED_HOSTS, true), (renderExternalHostname ? [renderExternalHostname] : []), true)));
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
    var existingDir, targetFolder;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0: return [4 /*yield*/, findProjectDirById(root, projectId)];
            case 1:
                existingDir = _a.sent();
                if (existingDir) {
                    return [2 /*return*/, existingDir];
                }
                return [4 /*yield*/, pickProjectFolderName(root, projectId, projectTitle)];
            case 2:
                targetFolder = _a.sent();
                return [2 /*return*/, path.join(root, targetFolder)];
        }
    });
}); };
var normalizeProjectAssetPaths = function (projectJson, projectFolder) {
    var parsed;
    try {
        parsed = JSON.parse(projectJson);
    }
    catch (_a) {
        return projectJson;
    }
    if (!parsed || typeof parsed !== "object") {
        return projectJson;
    }
    var draft = parsed;
    if (!Array.isArray(draft.pages)) {
        return projectJson;
    }
    var changed = false;
    for (var _i = 0, _b = draft.pages; _i < _b.length; _i++) {
        var page = _b[_i];
        if (!page || typeof page !== "object" || !Array.isArray(page.panels)) {
            continue;
        }
        for (var _c = 0, _d = page.panels; _c < _d.length; _c++) {
            var panel = _d[_c];
            if (!panel || typeof panel !== "object" || !panel.image || typeof panel.image !== "object") {
                continue;
            }
            var src = panel.image.src;
            if (typeof src !== "string") {
                continue;
            }
            var prefix = "/projects/";
            var assetsSegment = "/".concat(PROJECT_ASSETS_DIR, "/");
            if (!src.startsWith(prefix)) {
                continue;
            }
            var assetsIndex = src.indexOf(assetsSegment, prefix.length);
            if (assetsIndex <= prefix.length) {
                continue;
            }
            var folderInSrc = src.slice(prefix.length, assetsIndex);
            if (!folderInSrc || folderInSrc === projectFolder) {
                continue;
            }
            var assetSuffix = src.slice(assetsIndex + assetsSegment.length);
            panel.image.src = "".concat(prefix).concat(projectFolder).concat(assetsSegment).concat(assetSuffix);
            changed = true;
        }
    }
    return changed ? JSON.stringify(parsed) : projectJson;
};
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
    var trimmed = body.trimStart().toLowerCase();
    var isHtml = trimmed.startsWith("<!doctype html") || trimmed.startsWith("<html");
    res.setHeader("Content-Type", isHtml ? "text/html; charset=utf-8" : "text/plain; charset=utf-8");
    res.end(body);
};
var readRawBody = function (req) { return __awaiter(void 0, void 0, void 0, function () {
    var chunks, chunk, e_1_1;
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
            case 12: return [2 /*return*/, Buffer.concat(chunks).toString("utf8")];
        }
    });
}); };
var readJsonBody = function (req) { return __awaiter(void 0, void 0, void 0, function () {
    var raw;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0: return [4 /*yield*/, readRawBody(req)];
            case 1:
                raw = _a.sent();
                if (!raw) {
                    throw new Error("Empty request body");
                }
                return [2 /*return*/, JSON.parse(raw)];
        }
    });
}); };
var requestExpectsJson = function (req, pathname) {
    var _a, _b;
    var accept = String((_a = req.headers.accept) !== null && _a !== void 0 ? _a : "").toLowerCase();
    var contentType = String((_b = req.headers["content-type"]) !== null && _b !== void 0 ? _b : "").toLowerCase();
    return pathname.startsWith(API_BASE) || accept.includes("application/json") || contentType.includes("application/json");
};
var parseCookies = function (req) {
    var _a;
    var raw = String((_a = req.headers.cookie) !== null && _a !== void 0 ? _a : "");
    if (!raw) {
        return new Map();
    }
    var cookies = new Map();
    var entries = raw.split(";");
    for (var _i = 0, entries_3 = entries; _i < entries_3.length; _i++) {
        var entry = entries_3[_i];
        var separator = entry.indexOf("=");
        if (separator <= 0) {
            continue;
        }
        var name_1 = entry.slice(0, separator).trim();
        var value = entry.slice(separator + 1).trim();
        if (!name_1) {
            continue;
        }
        try {
            cookies.set(name_1, decodeURIComponent(value));
        }
        catch (_b) {
            cookies.set(name_1, value);
        }
    }
    return cookies;
};
var isSecureRequest = function (req) {
    var _a, _b;
    var forwardedProto = (_b = String((_a = req.headers["x-forwarded-proto"]) !== null && _a !== void 0 ? _a : "")
        .split(",")[0]) === null || _b === void 0 ? void 0 : _b.trim().toLowerCase();
    if (forwardedProto === "https") {
        return true;
    }
    var encrypted = req.socket.encrypted;
    return encrypted === true;
};
var buildAuthCookie = function (req) {
    var attributes = [
        "".concat(AUTH_COOKIE_NAME, "=").concat(encodeURIComponent(AUTH_COOKIE_TOKEN)),
        "Path=/",
        "Max-Age=".concat(AUTH_COOKIE_MAX_AGE_SECONDS),
        "HttpOnly",
        "SameSite=Lax",
    ];
    if (isSecureRequest(req)) {
        attributes.push("Secure");
    }
    return attributes.join("; ");
};
var hasValidAuthCookie = function (req) {
    var cookies = parseCookies(req);
    var token = cookies.get(AUTH_COOKIE_NAME);
    if (!token) {
        return false;
    }
    var expected = Buffer.from(AUTH_COOKIE_TOKEN, "utf8");
    var received = Buffer.from(token, "utf8");
    if (received.length !== expected.length) {
        return false;
    }
    return timingSafeEqual(received, expected);
};
var escapeHtml = function (value) {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
};
var normalizeNextPath = function (value) {
    var normalized = String(value !== null && value !== void 0 ? value : "").trim();
    if (!normalized.startsWith("/") || normalized.startsWith("//")) {
        return "/";
    }
    if (normalized.startsWith(AUTH_LOGIN_PATH)) {
        return "/";
    }
    return normalized;
};
var renderPasswordLoginPage = function (nextPath, errorMessage) {
    var errorBlock = errorMessage
        ? "<p class=\"auth-error\">".concat(escapeHtml(errorMessage), "</p>")
        : "";
    var escapedNext = escapeHtml(nextPath);
    return "<!doctype html>\n<html lang=\"zh-CN\">\n  <head>\n    <meta charset=\"UTF-8\" />\n    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\" />\n    <title>MangaMaker \u767B\u5F55</title>\n    <style>\n      :root {\n        color-scheme: light;\n      }\n      * {\n        box-sizing: border-box;\n      }\n      body {\n        margin: 0;\n        min-height: 100vh;\n        display: grid;\n        place-items: center;\n        font-family: \"Source Han Sans\", \"PingFang SC\", \"Microsoft YaHei\", sans-serif;\n        background: radial-gradient(circle at 20% 20%, #efe9dc 0%, #e1d3bd 48%, #cfb18c 100%);\n        color: #2d241b;\n      }\n      .auth-card {\n        width: min(420px, calc(100vw - 32px));\n        padding: 28px;\n        border-radius: 14px;\n        background: rgba(255, 255, 255, 0.92);\n        box-shadow: 0 18px 42px rgba(45, 36, 27, 0.22);\n      }\n      h1 {\n        margin: 0 0 6px;\n        font-size: 26px;\n      }\n      p {\n        margin: 0 0 18px;\n        color: #5c4a3a;\n      }\n      label {\n        display: block;\n        margin: 0 0 10px;\n        font-weight: 600;\n      }\n      input[type=\"password\"] {\n        width: 100%;\n        border: 1px solid #b89a7b;\n        border-radius: 10px;\n        padding: 12px 14px;\n        font-size: 16px;\n        outline: none;\n      }\n      input[type=\"password\"]:focus {\n        border-color: #8f5b2f;\n        box-shadow: 0 0 0 2px rgba(143, 91, 47, 0.15);\n      }\n      button {\n        margin-top: 14px;\n        width: 100%;\n        border: 0;\n        border-radius: 10px;\n        padding: 12px 14px;\n        font-size: 16px;\n        font-weight: 700;\n        color: #fff;\n        background: linear-gradient(135deg, #8f5b2f, #6f4a2c);\n        cursor: pointer;\n      }\n      .auth-error {\n        margin: 0 0 12px;\n        color: #b42318;\n        font-weight: 600;\n      }\n    </style>\n  </head>\n  <body>\n    <main class=\"auth-card\">\n      <h1>MangaMaker</h1>\n      <p>\u8BF7\u8F93\u5165\u8BBF\u95EE\u5BC6\u7801</p>\n      ".concat(errorBlock, "\n      <form method=\"post\" action=\"").concat(AUTH_LOGIN_PATH, "\">\n        <input type=\"hidden\" name=\"next\" value=\"").concat(escapedNext, "\" />\n        <label for=\"password\">\u5BC6\u7801</label>\n        <input id=\"password\" name=\"password\" type=\"password\" autocomplete=\"current-password\" autofocus required />\n        <button type=\"submit\">\u767B\u5F55</button>\n      </form>\n    </main>\n  </body>\n</html>");
};
var readLoginPayload = function (req) { return __awaiter(void 0, void 0, void 0, function () {
    var contentType, raw, parsed, params;
    var _a, _b;
    return __generator(this, function (_c) {
        switch (_c.label) {
            case 0:
                contentType = String((_a = req.headers["content-type"]) !== null && _a !== void 0 ? _a : "").toLowerCase();
                return [4 /*yield*/, readRawBody(req)];
            case 1:
                raw = _c.sent();
                if (!raw) {
                    return [2 /*return*/, { password: "", next: "/" }];
                }
                if (contentType.includes("application/json")) {
                    parsed = JSON.parse(raw);
                    return [2 /*return*/, {
                            password: typeof parsed.password === "string" ? parsed.password : "",
                            next: normalizeNextPath(typeof parsed.next === "string" ? parsed.next : "/"),
                        }];
                }
                params = new URLSearchParams(raw);
                return [2 /*return*/, {
                        password: String((_b = params.get("password")) !== null && _b !== void 0 ? _b : ""),
                        next: normalizeNextPath(params.get("next")),
                    }];
        }
    });
}); };
var appendCookieHeader = function (res, cookie) {
    var current = res.getHeader("Set-Cookie");
    if (!current) {
        res.setHeader("Set-Cookie", cookie);
        return;
    }
    if (Array.isArray(current)) {
        res.setHeader("Set-Cookie", __spreadArray(__spreadArray([], current.map(String), true), [cookie], false));
        return;
    }
    res.setHeader("Set-Cookie", [String(current), cookie]);
};
var clearAuthCookie = function (req) {
    var attributes = [
        "".concat(AUTH_COOKIE_NAME, "="),
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
var redirect = function (res, location) {
    res.statusCode = 302;
    res.setHeader("Location", location);
    res.end();
};
var isSafeStringEqual = function (left, right) {
    var leftBuffer = Buffer.from(left, "utf8");
    var rightBuffer = Buffer.from(right, "utf8");
    if (leftBuffer.length !== rightBuffer.length) {
        return false;
    }
    try {
        return timingSafeEqual(leftBuffer, rightBuffer);
    }
    catch (_a) {
        return false;
    }
};
var attachWebAuthMiddleware = function (middlewares) {
    var handler = function (req, res, next) { return __awaiter(void 0, void 0, void 0, function () {
        var method, host, url, pathname, payload, nextPath_1, nextPath, loginUrl;
        var _a, _b, _c;
        return __generator(this, function (_d) {
            switch (_d.label) {
                case 0:
                    method = (_b = (_a = req.method) === null || _a === void 0 ? void 0 : _a.toUpperCase()) !== null && _b !== void 0 ? _b : "GET";
                    host = req.headers.host;
                    url = new URL((_c = req.url) !== null && _c !== void 0 ? _c : "/", host ? "http://".concat(host) : "http://localhost");
                    pathname = url.pathname;
                    if (pathname === "".concat(API_BASE, "/health")) {
                        next();
                        return [2 /*return*/];
                    }
                    if (pathname === AUTH_LOGIN_PATH && method === "GET") {
                        if (hasValidAuthCookie(req)) {
                            redirect(res, normalizeNextPath(url.searchParams.get("next")));
                            return [2 /*return*/];
                        }
                        text(res, 200, renderPasswordLoginPage(normalizeNextPath(url.searchParams.get("next"))));
                        return [2 /*return*/];
                    }
                    if (!(pathname === AUTH_LOGIN_PATH && method === "POST")) return [3 /*break*/, 2];
                    return [4 /*yield*/, readLoginPayload(req)];
                case 1:
                    payload = _d.sent();
                    nextPath_1 = normalizeNextPath(payload.next);
                    if (isSafeStringEqual(payload.password, AUTH_PASSWORD)) {
                        appendCookieHeader(res, buildAuthCookie(req));
                        if (requestExpectsJson(req, pathname)) {
                            json(res, 200, { ok: true, next: nextPath_1 });
                            return [2 /*return*/];
                        }
                        redirect(res, nextPath_1);
                        return [2 /*return*/];
                    }
                    appendCookieHeader(res, clearAuthCookie(req));
                    if (requestExpectsJson(req, pathname)) {
                        json(res, 401, { error: "Invalid password" });
                        return [2 /*return*/];
                    }
                    text(res, 401, renderPasswordLoginPage(nextPath_1, "密码错误，请重试。"));
                    return [2 /*return*/];
                case 2:
                    if (hasValidAuthCookie(req)) {
                        next();
                        return [2 /*return*/];
                    }
                    nextPath = normalizeNextPath("".concat(pathname).concat(url.search));
                    loginUrl = "".concat(AUTH_LOGIN_PATH, "?next=").concat(encodeURIComponent(nextPath));
                    if (requestExpectsJson(req, pathname) || method !== "GET") {
                        json(res, 401, {
                            error: "Authentication required",
                            login: loginUrl,
                        });
                        return [2 /*return*/];
                    }
                    redirect(res, loginUrl);
                    return [2 /*return*/];
            }
        });
    }); };
    middlewares.use(handler);
};
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
        var method, host, url, pathname, root_1, relative, candidate, rootWithSep, stats, stream, root, payload, titleFromJson, parsed, projectTitle, projectDir, projectFolder, assetsDir, normalizedProjectJson, metaFile, metaExists, latestProject, folder, projectFile, projectExists, projectJson, normalizedProjectJson, entries, drafts, _i, entries_4, entry, projectFile, stats, projectJson, normalizedProjectJson, payload, projectTitle, projectDir, projectFolder, assetsDir, originalPath, stem, ext, timestamp, index, fileName, assetPath, payload, projectDir, error_1, message;
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
                    _d.trys.push([1, 42, , 43]);
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
                    normalizedProjectJson = normalizeProjectAssetPaths(payload.project_json, projectFolder);
                    return [4 /*yield*/, fsp.writeFile(path.join(projectDir, PROJECT_JSON_FILE), normalizedProjectJson, "utf8")];
                case 9:
                    _d.sent();
                    return [4 /*yield*/, fsp.writeFile(path.join(root, PROJECT_META_FILE), projectFolder, "utf8")];
                case 10:
                    _d.sent();
                    json(res, 200, { path: "/projects/".concat(projectFolder, "/").concat(PROJECT_JSON_FILE) });
                    return [2 /*return*/];
                case 11:
                    if (!(method === "GET" && pathname === "".concat(API_BASE, "/read_project_draft"))) return [3 /*break*/, 18];
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
                    normalizedProjectJson = normalizeProjectAssetPaths(projectJson, folder);
                    if (!(normalizedProjectJson !== projectJson)) return [3 /*break*/, 17];
                    return [4 /*yield*/, fsp.writeFile(projectFile, normalizedProjectJson, "utf8")];
                case 16:
                    _d.sent();
                    _d.label = 17;
                case 17:
                    json(res, 200, { project_json: normalizedProjectJson });
                    return [2 /*return*/];
                case 18:
                    if (!(method === "GET" && pathname === "".concat(API_BASE, "/list_project_drafts"))) return [3 /*break*/, 27];
                    return [4 /*yield*/, fsp.readdir(root, { withFileTypes: true })];
                case 19:
                    entries = _d.sent();
                    drafts = [];
                    _i = 0, entries_4 = entries;
                    _d.label = 20;
                case 20:
                    if (!(_i < entries_4.length)) return [3 /*break*/, 26];
                    entry = entries_4[_i];
                    if (!entry.isDirectory()) {
                        return [3 /*break*/, 25];
                    }
                    projectFile = path.join(root, entry.name, PROJECT_JSON_FILE);
                    return [4 /*yield*/, fsp.stat(projectFile).catch(function () { return null; })];
                case 21:
                    stats = _d.sent();
                    if (!(stats === null || stats === void 0 ? void 0 : stats.isFile())) {
                        return [3 /*break*/, 25];
                    }
                    return [4 /*yield*/, fsp.readFile(projectFile, "utf8")];
                case 22:
                    projectJson = _d.sent();
                    normalizedProjectJson = normalizeProjectAssetPaths(projectJson, entry.name);
                    if (!(normalizedProjectJson !== projectJson)) return [3 /*break*/, 24];
                    return [4 /*yield*/, fsp.writeFile(projectFile, normalizedProjectJson, "utf8")];
                case 23:
                    _d.sent();
                    _d.label = 24;
                case 24:
                    drafts.push({ modifiedAt: stats.mtimeMs, projectJson: normalizedProjectJson });
                    _d.label = 25;
                case 25:
                    _i++;
                    return [3 /*break*/, 20];
                case 26:
                    drafts.sort(function (a, b) { return b.modifiedAt - a.modifiedAt; });
                    json(res, 200, { projects: drafts.map(function (entry) { return entry.projectJson; }) });
                    return [2 /*return*/];
                case 27:
                    if (!(method === "POST" && pathname === "".concat(API_BASE, "/save_imported_image"))) return [3 /*break*/, 35];
                    return [4 /*yield*/, readJsonBody(req)];
                case 28:
                    payload = _d.sent();
                    projectTitle = (typeof payload.project_title === "string" ? payload.project_title.trim() : "") ||
                        payload.project_id;
                    return [4 /*yield*/, resolveProjectDir(root, payload.project_id, projectTitle)];
                case 29:
                    projectDir = _d.sent();
                    projectFolder = path.basename(projectDir);
                    assetsDir = path.join(projectDir, PROJECT_ASSETS_DIR);
                    return [4 /*yield*/, fsp.mkdir(assetsDir, { recursive: true })];
                case 30:
                    _d.sent();
                    originalPath = path.parse(payload.original_file_name);
                    stem = sanitizePathComponent(originalPath.name, "image");
                    ext = sanitizePathComponent((originalPath.ext || ".bin").replace(/^\./, ""), "bin").toLowerCase();
                    timestamp = Date.now();
                    index = 0;
                    fileName = "".concat(stem, "-").concat(timestamp, ".").concat(ext);
                    assetPath = path.join(assetsDir, fileName);
                    _d.label = 31;
                case 31: return [4 /*yield*/, fsp.stat(assetPath).then(function () { return true; }).catch(function () { return false; })];
                case 32:
                    if (!_d.sent()) return [3 /*break*/, 33];
                    index += 1;
                    fileName = "".concat(stem, "-").concat(timestamp, "-").concat(index, ".").concat(ext);
                    assetPath = path.join(assetsDir, fileName);
                    return [3 /*break*/, 31];
                case 33: return [4 /*yield*/, fsp.writeFile(assetPath, Buffer.from(payload.bytes))];
                case 34:
                    _d.sent();
                    json(res, 200, { path: "/projects/".concat(projectFolder, "/").concat(PROJECT_ASSETS_DIR, "/").concat(fileName) });
                    return [2 /*return*/];
                case 35:
                    if (!(method === "POST" && pathname === "".concat(API_BASE, "/delete_project_draft"))) return [3 /*break*/, 41];
                    return [4 /*yield*/, readJsonBody(req)];
                case 36:
                    payload = _d.sent();
                    return [4 /*yield*/, findProjectDirById(root, payload.project_id)];
                case 37:
                    projectDir = _d.sent();
                    if (!projectDir) return [3 /*break*/, 39];
                    return [4 /*yield*/, fsp.rm(projectDir, { recursive: true, force: true })];
                case 38:
                    _d.sent();
                    _d.label = 39;
                case 39: return [4 /*yield*/, syncLatestProjectMeta(root)];
                case 40:
                    _d.sent();
                    json(res, 200, { ok: true });
                    return [2 /*return*/];
                case 41:
                    text(res, 404, "Not Found");
                    return [3 /*break*/, 43];
                case 42:
                    error_1 = _d.sent();
                    message = error_1 instanceof Error ? error_1.message : String(error_1);
                    json(res, 500, { error: message });
                    return [3 /*break*/, 43];
                case 43: return [2 /*return*/];
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
var webAuthPlugin = function () { return ({
    name: "mangamaker-web-auth",
    configureServer: function (server) {
        attachWebAuthMiddleware(server.middlewares);
    },
    configurePreviewServer: function (server) {
        attachWebAuthMiddleware(server.middlewares);
    },
}); };
export default defineConfig({
    plugins: [react(), webAuthPlugin(), webPersistencePlugin()],
    server: {
        allowedHosts: ALLOWED_HOSTS,
    },
    preview: {
        allowedHosts: ALLOWED_HOSTS,
    },
});
