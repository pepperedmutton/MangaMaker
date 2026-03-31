import { promises as fsp } from "node:fs";
import path from "node:path";
import process from "node:process";

const seedRoot = path.resolve(process.cwd(), "seed", "projects");
const projectsRoot = path.resolve(process.cwd(), "projects");

const statOrNull = async (targetPath) => fsp.stat(targetPath).catch(() => null);

const copyMissingEntries = async (sourceDir, targetDir, stats) => {
  await fsp.mkdir(targetDir, { recursive: true });
  const entries = await fsp.readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);

    if (entry.isDirectory()) {
      await copyMissingEntries(sourcePath, targetPath, stats);
      continue;
    }

    if (!entry.isFile()) {
      stats.skipped += 1;
      continue;
    }

    const targetExists = await statOrNull(targetPath);
    if (targetExists) {
      stats.skipped += 1;
      continue;
    }

    await fsp.mkdir(path.dirname(targetPath), { recursive: true });
    await fsp.copyFile(sourcePath, targetPath);
    stats.copied += 1;
  }
};

const main = async () => {
  if (process.env.SKIP_PROJECT_SEED === "1") {
    console.log("[seed-projects] skipped by SKIP_PROJECT_SEED=1");
    return;
  }

  const seedStats = await statOrNull(seedRoot);
  if (!seedStats?.isDirectory()) {
    console.log("[seed-projects] no seed directory found, skipping.");
    return;
  }

  const stats = { copied: 0, skipped: 0 };
  await copyMissingEntries(seedRoot, projectsRoot, stats);
  console.log(
    `[seed-projects] sync finished: copied=${stats.copied}, skipped=${stats.skipped}`,
  );
};

await main();
