import process from "node:process";
import { spawnSync } from "node:child_process";

const runGit = (args, inherit = true) =>
  spawnSync("git", args, {
    encoding: "utf8",
    stdio: inherit ? "inherit" : ["ignore", "pipe", "pipe"],
  });

const repoCheck = runGit(["rev-parse", "--is-inside-work-tree"], false);
if (repoCheck.status !== 0) {
  console.warn("[sync:projects] git worktree unavailable, skip projects force-sync.");
  process.exit(0);
}

const trackedAtHead = runGit(["ls-tree", "-r", "--name-only", "HEAD", "projects"], false);
if (trackedAtHead.status !== 0) {
  console.error("[sync:projects] failed to inspect projects/ in HEAD.");
  if (trackedAtHead.stderr?.trim()) {
    console.error(trackedAtHead.stderr.trim());
  }
  process.exit(1);
}

const trackedFiles = trackedAtHead.stdout
  .split(/\r?\n/u)
  .map((entry) => entry.trim())
  .filter(Boolean);

if (trackedFiles.length === 0) {
  console.warn("[sync:projects] no tracked projects/ in HEAD, skip force-sync.");
  process.exit(0);
}

const restore = runGit(["restore", "--worktree", "--source=HEAD", "--", "projects"]);
if (restore.status !== 0) {
  const fallback = runGit(["checkout", "--", "projects"]);
  if (fallback.status !== 0) {
    console.error("[sync:projects] failed to restore tracked projects/ from git.");
    process.exit(1);
  }
}

const clean = runGit(["clean", "-fdx", "--", "projects"]);
if (clean.status !== 0) {
  console.error("[sync:projects] failed to remove extra files under projects/.");
  process.exit(1);
}

console.log("[sync:projects] projects/ has been force-synced from tracked git files.");
