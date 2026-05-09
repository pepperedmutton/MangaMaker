import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import process from "node:process";
import { spawn } from "node:child_process";

const rootDir = process.cwd();
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const pythonCommand = process.platform === "win32" ? "python" : "python3";
const defaultNgrokCommand = process.platform === "win32" ? "ngrok.exe" : "ngrok";
const isRenderRuntime = process.env.RENDER === "true" || Boolean(process.env.RENDER_SERVICE_ID);
const parsePortEnv = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
};
const defaultHost = process.env.HOST?.trim() || (isRenderRuntime ? "0.0.0.0" : "127.0.0.1");
const defaultPreviewPort = 4173;
const defaultDevPort = 5173;
const defaultTtlHours = 72;
const healthPath = "/__mangamaker__/persistence/health";
const defaultShareProvider = "gradio";
const defaultNgrokApiUrl = "http://127.0.0.1:4040";
const envPort = parsePortEnv(process.env.PORT);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const createLineBuffer = (onLine) => {
  let buffer = "";
  return (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      onLine(line);
    }
  };
};

const printShareBanner = (providerLabel, shareUrl, expiresAt) => {
  const lines = [
    "===================================",
    `${providerLabel} Share Link Ready`,
    "===================================",
    `Share URL: ${shareUrl}`,
  ];
  if (expiresAt) {
    lines.push(`Share expires at: ${expiresAt.toLocaleString()}`);
  }
  lines.push("===================================");
  console.log(lines.join("\n"));
};

const quoteWindowsArg = (value) => {
  if (value.length === 0) {
    return '""';
  }
  if (!/[\s"]/u.test(value)) {
    return value;
  }
  return `"${value.replace(/"/g, '\\"')}"`;
};

const parseArgs = (argv) => {
  const options = {
    share: !isRenderRuntime,
    shareProvider: defaultShareProvider,
    host: defaultHost,
    port: null,
    ttlHours: defaultTtlHours,
    rebuild: false,
    devServer: false,
    help: false,
  };
  let portProvided = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      continue;
    }
    if (arg === "--share") {
      options.share = true;
      continue;
    }
    if (arg === "--no-share") {
      options.share = false;
      continue;
    }
    if (arg === "--share-provider") {
      options.shareProvider = argv[index + 1] ?? defaultShareProvider;
      index += 1;
      continue;
    }
    if (arg === "--host") {
      options.host = argv[index + 1] ?? defaultHost;
      index += 1;
      continue;
    }
    if (arg === "--port") {
      options.port = Number(argv[index + 1] ?? defaultPreviewPort);
      portProvided = true;
      index += 1;
      continue;
    }
    if (arg === "--ttl-hours") {
      options.ttlHours = Number(argv[index + 1] ?? defaultTtlHours);
      index += 1;
      continue;
    }
    if (arg === "--rebuild") {
      options.rebuild = true;
      continue;
    }
    if (arg === "--dev-server") {
      options.devServer = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!portProvided) {
    options.port = envPort ?? (options.devServer ? defaultDevPort : defaultPreviewPort);
  }

  if (!Number.isFinite(options.port) || options.port <= 0) {
    throw new Error(`Invalid port: ${options.port}`);
  }
  if (!Number.isFinite(options.ttlHours) || options.ttlHours < 0) {
    throw new Error(`Invalid ttl-hours: ${options.ttlHours}`);
  }
  if (!["gradio", "ngrok"].includes(options.shareProvider)) {
    throw new Error(`Invalid share-provider: ${options.shareProvider}`);
  }

  return options;
};

const printHelp = () => {
  console.log(`Usage: pnpm start -- [--dev-server] [--no-share] [--share-provider gradio|ngrok] [--host 127.0.0.1] [--port 4173] [--ttl-hours 72] [--rebuild]

Starts the web app through vite preview or vite dev server.

Flags:
  --dev-server  Start through vite dev instead of vite preview. Default dev port: 5173
  --share       Explicitly enable a public share link for the local web server.
  --no-share    Disable the public share link. Share mode is enabled by default.
  --share-provider  Select the share provider. Supported values: gradio, ngrok. Default: gradio
  --host        Local bind host for the web server. Default: 127.0.0.1
  --port        Local port for the web server. Default: 4173 for preview, 5173 for dev server
  --ttl-hours   Maximum share-link lifetime before the tunnel is closed. Default: 72
  --rebuild     Force a fresh pnpm build before starting preview.
  --help, -h    Show this help message.

Environment:
  GRADIO_SHARE_SERVER_ADDRESS  Override the share tunnel server address, for example 44.237.78.176:7000
  NGROK_BIN                    Absolute path to the ngrok executable
  NGROK_API_URL                Override the local ngrok API URL. Default: http://127.0.0.1:4040
  PORT                         Default port when --port is omitted. Used by Render.
  HOST                         Default host when --host is omitted. Render defaults to 0.0.0.0.
`);
};

const fetchJson = async (url, timeoutMs = 5_000) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
};

const waitForNgrokTunnel = async (apiUrl, timeoutMs = 30_000) => {
  const startedAt = Date.now();
  const tunnelApiUrl = `${apiUrl.replace(/\/$/, "")}/api/tunnels`;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const payload = await fetchJson(tunnelApiUrl, 2_000);
      const tunnels = Array.isArray(payload.tunnels) ? payload.tunnels : [];
      const httpsTunnel = tunnels.find(
        (entry) => typeof entry.public_url === "string" && entry.public_url.startsWith("https://"),
      );
      if (httpsTunnel?.public_url) {
        return httpsTunnel.public_url;
      }
      if (typeof tunnels[0]?.public_url === "string") {
        return tunnels[0].public_url;
      }
    } catch {
      // Keep polling until timeout.
    }
    await sleep(500);
  }
  throw new Error(`Timed out while waiting for ngrok tunnel at ${tunnelApiUrl}`);
};

const spawnChild = (command, args, options = {}) =>
  process.platform === "win32" && command.toLowerCase().endsWith(".cmd")
    ? spawn(
        process.env.ComSpec ?? "cmd.exe",
        ["/d", "/s", "/c", [command, ...args].map(quoteWindowsArg).join(" ")],
        {
          cwd: rootDir,
          stdio: options.stdio ?? "inherit",
          env: {
            ...process.env,
            ...(options.env ?? {}),
          },
          windowsHide: true,
        },
      )
    : spawn(command, args, {
        cwd: rootDir,
        stdio: options.stdio ?? "inherit",
        env: {
          ...process.env,
          ...(options.env ?? {}),
        },
        windowsHide: true,
      });

const killChild = (child) => {
  if (!child || child.killed) {
    return;
  }
  if (process.platform === "win32" && child.pid) {
    const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    killer.unref();
    return;
  }
  child.kill("SIGTERM");
};

const distExists = () => fs.existsSync(path.join(rootDir, "dist", "index.html"));

const runBuild = async () => {
  await new Promise((resolve, reject) => {
    const child = spawnChild(pnpmCommand, ["build"]);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`pnpm build failed with exit code ${code ?? "unknown"}`));
    });
    child.on("error", reject);
  });
};

const waitForHealth = async (host, port, timeoutMs = 30_000) => {
  const startedAt = Date.now();
  const url = `http://${host}:${port}${healthPath}`;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Keep polling until timeout.
    }
    await sleep(500);
  }
  throw new Error(`Timed out while waiting for preview server health at ${url}`);
};

const isPortFree = async (host, port) =>
  new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, host);
  });

const main = async () => {
  let previewChild = null;
  let shareChild = null;

  const stopChildren = () => {
    killChild(shareChild);
    killChild(previewChild);
  };

  process.on("SIGINT", () => {
    stopChildren();
  });
  process.on("SIGTERM", () => {
    stopChildren();
  });
  process.on("exit", () => {
    stopChildren();
  });

  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      printHelp();
      return;
    }

    if (!(await isPortFree(options.host, options.port))) {
      throw new Error(`Port ${options.port} on ${options.host} is already in use.`);
    }

    if (!options.devServer && (options.rebuild || !distExists())) {
      console.log("Building web app...");
      await runBuild();
    }

    previewChild = options.devServer
      ? spawnChild(pnpmCommand, [
          "exec",
          "vite",
          "--config",
          "vite.config.ts",
          "--host",
          options.host,
          "--port",
          String(options.port),
          "--strictPort",
        ])
      : spawnChild(pnpmCommand, [
          "exec",
          "vite",
          "preview",
          "--config",
          "vite.config.ts",
          "--host",
          options.host,
          "--port",
          String(options.port),
          "--strictPort",
        ]);

    previewChild.on("exit", (code) => {
      if (code !== 0) {
        console.error(`Preview server exited with code ${code ?? "unknown"}.`);
      }
      killChild(shareChild);
      process.exit(code ?? 0);
    });
    previewChild.on("error", (error) => {
      console.error(`Failed to start preview server: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    });

    await waitForHealth(options.host, options.port);
    const localUrl = `http://${options.host}:${options.port}`;
    console.log(`Local URL: ${localUrl}`);

    if (!options.share) {
      return;
    }

    const shareProviderLabel = options.shareProvider === "ngrok" ? "ngrok" : "Gradio";
    console.log(`Creating ${shareProviderLabel} share link${options.ttlHours > 0 ? ` (expires in ${options.ttlHours} hours)` : ""}...`);
    let currentShareUrl = "";
    let currentExpiresAt = null;
    if (options.shareProvider === "ngrok") {
      const ngrokCommand = process.env.NGROK_BIN || defaultNgrokCommand;
      const ngrokApiUrl = process.env.NGROK_API_URL || defaultNgrokApiUrl;
      shareChild = spawnChild(
        ngrokCommand,
        ["http", String(options.port)],
        {
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      shareChild.stdout.setEncoding("utf8");
      shareChild.stderr.setEncoding("utf8");
      shareChild.stdout.on(
        "data",
        createLineBuffer((line) => {
          const text = line.trim();
          if (!text) {
            return;
          }
          if (/err(or)?/i.test(text)) {
            console.error(text);
          }
        }),
      );
      shareChild.stderr.on(
        "data",
        createLineBuffer((line) => {
          const text = line.trim();
          if (!text) {
            return;
          }
          console.error(text);
        }),
      );

      currentShareUrl = await waitForNgrokTunnel(ngrokApiUrl);
      currentExpiresAt =
        options.ttlHours > 0 ? new Date(Date.now() + options.ttlHours * 60 * 60 * 1000) : null;
      printShareBanner("ngrok", currentShareUrl, currentExpiresAt);
      if (currentExpiresAt) {
        console.log(`Share expires at: ${currentExpiresAt.toLocaleString()}`);
        setTimeout(() => {
          console.log("ngrok share tunnel TTL reached. Stopping tunnel.");
          killChild(shareChild);
        }, options.ttlHours * 60 * 60 * 1000);
      }
    } else {
      shareChild = spawnChild(
        pythonCommand,
        [
          "-u",
          path.join("scripts", "gradio_share_tunnel.py"),
          "--host",
          options.host,
          "--port",
          String(options.port),
          "--ttl-hours",
          String(options.ttlHours),
        ],
        {
          stdio: ["ignore", "pipe", "pipe"],
          env: {
            PYTHONUNBUFFERED: "1",
          },
        },
      );

      shareChild.stdout.setEncoding("utf8");
      shareChild.stderr.setEncoding("utf8");

      const handleShareStdoutLine = (line) => {
        if (!line) {
          return;
        }
        if (line.startsWith("SHARE_URL=")) {
          currentShareUrl = line.slice("SHARE_URL=".length);
          printShareBanner("Gradio", currentShareUrl, currentExpiresAt);
          return;
        }
        if (line.startsWith("SHARE_EXPIRES_AT=")) {
          const timestamp = Number(line.slice("SHARE_EXPIRES_AT=".length));
          currentExpiresAt = Number.isFinite(timestamp) ? new Date(timestamp * 1000) : null;
          if (currentExpiresAt) {
            console.log(`Share expires at: ${currentExpiresAt.toLocaleString()}`);
          }
          return;
        }
        if (line === "SHARE_STOPPED=1") {
          console.log("Gradio share tunnel stopped.");
          return;
        }
        console.log(line);
      };

      const handleShareStderrLine = (line) => {
        const text = line.trim();
        if (!text) {
          return;
        }
        if (text.startsWith("SHARE_STATUS=")) {
          console.log(text.slice("SHARE_STATUS=".length));
          return;
        }
        if (text.startsWith("SHARE_ERROR=")) {
          console.error(text.slice("SHARE_ERROR=".length));
          return;
        }
        console.error(text);
      };

      shareChild.stdout.on("data", createLineBuffer(handleShareStdoutLine));
      shareChild.stderr.on("data", createLineBuffer(handleShareStderrLine));
    }

    shareChild.on("exit", (code) => {
      if (code !== 0) {
        console.error(
          `${shareProviderLabel} share tunnel exited with code ${code ?? "unknown"}. Local preview remains available at ${localUrl}.`,
        );
      }
    });
    shareChild.on("error", (error) => {
      console.error(
        `Failed to start ${shareProviderLabel} share tunnel: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
    stopChildren();
  }
};

await main();
