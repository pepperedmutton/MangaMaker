import { defineConfig } from "@playwright/test";

process.env.MANGAMAKER_DISABLE_AUTH = "1";
process.env.MANGAMAKER_PROJECTS_DIR = ".mangamaker_runtime/e2e-projects";
process.env.MANGAMAKER_AGENT_TEST_MODE = "1";

const webServerCommand =
  process.platform === "win32"
    ? "cmd /c \"set MANGAMAKER_DISABLE_AUTH=1&& set MANGAMAKER_PROJECTS_DIR=.mangamaker_runtime/e2e-projects&& set MANGAMAKER_AGENT_TEST_MODE=1&& npm exec vite -- --config vite.config.ts --host 127.0.0.1 --port 4173\""
    : "MANGAMAKER_DISABLE_AUTH=1 MANGAMAKER_PROJECTS_DIR=.mangamaker_runtime/e2e-projects MANGAMAKER_AGENT_TEST_MODE=1 npm exec vite -- --config vite.config.ts --host 127.0.0.1 --port 4173";

export default defineConfig({
  testDir: "./tests/e2e",
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:4173",
    headless: true,
  },
  webServer: {
    command: webServerCommand,
    env: {
      ...process.env,
      MANGAMAKER_DISABLE_AUTH: "1",
      MANGAMAKER_PROJECTS_DIR: ".mangamaker_runtime/e2e-projects",
      MANGAMAKER_AGENT_TEST_MODE: "1",
    },
    port: 4173,
    reuseExistingServer: false,
    timeout: 120000,
  },
});
