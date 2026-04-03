import process from "node:process";
import { spawnSync } from "node:child_process";

const runGit = (args) =>
  spawnSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

if (process.env.MANGAMAKER_SKIP_PROJECT_GUARD === "1") {
  process.exit(0);
}

const repoCheck = runGit(["rev-parse", "--is-inside-work-tree"]);
if (repoCheck.status !== 0) {
  console.warn("[guard:projects] git worktree unavailable, skip projects tracking guard.");
  process.exit(0);
}

const tracked = runGit(["ls-files", "projects"]);
if (tracked.status !== 0) {
  console.error("[guard:projects] failed to inspect tracked files under projects/.");
  if (tracked.stderr?.trim()) {
    console.error(tracked.stderr.trim());
  }
  process.exit(1);
}

const files = tracked.stdout
  .split(/\r?\n/u)
  .map((entry) => entry.trim())
  .filter(Boolean);

if (files.length === 0) {
  process.exit(0);
}

const preview = files.slice(0, 10).map((entry) => `  - ${entry}`).join("\n");
console.error(
  [
    "[guard:projects] blocked build: files under projects/ are tracked by git.",
    "This can overwrite cloud project data during functional deployments.",
    "Untrack them with:",
    "  git rm -r --cached projects",
    "and keep /projects/ in .gitignore.",
    "",
    `Tracked file count: ${files.length}`,
    preview,
    files.length > 10 ? "  - ..." : "",
  ]
    .filter(Boolean)
    .join("\n"),
);
process.exit(1);
