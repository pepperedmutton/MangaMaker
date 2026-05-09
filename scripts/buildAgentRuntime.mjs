import path from "node:path";
import process from "node:process";
import { build } from "vite";

const rootDir = process.cwd();

await build({
  configFile: false,
  root: rootDir,
  logLevel: "warn",
  build: {
    ssr: path.resolve(rootDir, "src/agent/agentResponseSchema.ts"),
    outDir: path.resolve(rootDir, "dist/agent-runtime"),
    emptyOutDir: true,
    target: "node22",
    rollupOptions: {
      output: {
        entryFileNames: "agentResponseSchema.mjs",
        format: "es",
      },
    },
  },
});
