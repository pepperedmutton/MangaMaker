import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import process from "node:process";
import { spawn } from "node:child_process";

const rootDir = process.cwd();
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const pythonCommand = process.platform === "win32" ? "python" : "python3";
const defaultHost = "127.0.0.1";
const defaultPreviewPort = 4173;
const defaultDevPort = 5173;
const defaultTtlHours = 72;
const healthPath = "/__mangamaker__/persistence/health";

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

const printShareBanner = (shareUrl, expiresAt) => {
  const lines = [
    "===================================",
    "Gradio Share Link Ready",
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
    share: true,
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
    options.port = options.devServer ? defaultDevPort : defaultPreviewPort;
  }

  if (!Number.isFinite(options.port) || options.port <= 0) {
    throw new Error(`Invalid port: ${options.port}`);
  }
  if (!Number.isFinite(options.ttlHours) || options.ttlHours < 0) {
    throw new Error(`Invalid ttl-hours: ${options.ttlHours}`);
  }

  return options;
};

const printHelp = () => {
  console.log(`Usage: pnpm start -- [--dev-server] [--no-share] [--host 127.0.0.1] [--port 4173] [--ttl-hours 72] [--rebuild]

Starts the web app through vite preview or vite dev server.

Flags:
  --dev-server  Start through vite dev instead of vite preview. Default dev port: 5173
  --share       Explicitly enable a Gradio public share link for the local preview server.
  --no-share    Disable the Gradio public share link. Share mode is enabled by default.
  --host        Local bind host for the web server. Default: 127.0.0.1
  --port        Local port for the web server. Default: 4173 for preview, 5173 for dev server
  --ttl-hours   Maximum share-link lifetime before the tunnel is closed. Default: 72
  --rebuild     Force a fresh pnpm build before starting preview.
  --help, -h    Show this help message.
`);
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

    console.log(`Creating Gradio share link (expires in ${options.ttlHours} hours)...`);
    let currentShareUrl = "";
    let currentExpiresAt = null;
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
        printShareBanner(currentShareUrl, currentExpiresAt);
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

    shareChild.on("exit", (code) => {
      if (code !== 0) {
        console.error(`Gradio share tunnel exited with code ${code ?? "unknown"}.`);
      }
    });
    shareChild.on("error", (error) => {
      console.error(`Failed to start Gradio share tunnel: ${error instanceof Error ? error.message : String(error)}`);
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
    stopChildren();
  }
};

await main();
