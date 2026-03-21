import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { chromium } from "@playwright/test";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const workspaceRoot = path.resolve(projectRoot, "..");
const markdownPath = path.join(workspaceRoot, "漫画大纲.md");
const projectsDir = path.join(projectRoot, "projects");
const appUrl = process.env.MANGAMAKER_URL ?? "http://127.0.0.1:4173/";
const targetTitle = "雪之下雪乃漫画";

const PAGE_WIDTH = 1200;
const PAGE_HEIGHT = 1700;
const PANEL_STYLE = {
  fill: "#fffdf8",
  stroke: "#111111",
  strokeWidth: 4,
  cornerRadius: 12,
};

const oddLayout = {
  "页顶横贯": { x: 60, y: 60, width: 1080, height: 306 },
  "中段左上": { x: 60, y: 406, width: 520, height: 340 },
  "中段右上": { x: 620, y: 406, width: 520, height: 340 },
  "左下": { x: 60, y: 786, width: 420, height: 374 },
  "右下竖大格": { x: 520, y: 786, width: 620, height: 680 },
};

const evenLayout = {
  "上半页横大格": { x: 60, y: 60, width: 1080, height: 578 },
  "中段左格": { x: 60, y: 678, width: 520, height: 340 },
  "中段右格": { x: 620, y: 678, width: 520, height: 340 },
  "底部横格": { x: 60, y: 1058, width: 1080, height: 510 },
};

function createId(prefix) {
  return `${prefix}-${randomUUID().replace(/-/g, "").slice(0, 8)}`;
}

function createPanel(layout, description) {
  return {
    id: createId("panel"),
    x: layout.x,
    y: layout.y,
    width: layout.width,
    height: layout.height,
    rotation: 0,
    points: [
      { x: 0, y: 0 },
      { x: layout.width, y: 0 },
      { x: layout.width, y: layout.height },
      { x: 0, y: layout.height },
    ],
    style: PANEL_STYLE,
    image: null,
    description,
  };
}

function extractPageSections(markdown) {
  const lines = markdown.split(/\r?\n/);
  const sections = [];
  let current = null;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const pageMatch = line.match(/^### P(\d+)$/);
    if (pageMatch) {
      if (current) {
        sections.push(current);
      }
      current = {
        pageNumber: Number(pageMatch[1]),
        bodyLines: [],
      };
      continue;
    }
    if (current) {
      current.bodyLines.push(rawLine);
    }
  }

  if (current) {
    sections.push(current);
  }

  return sections.map((section) => {
    const body = section.bodyLines.join("\n");
    const functionMatch = body.match(/^- 功能：(.+)$/m);
    const pageFunction = functionMatch ? functionMatch[1].trim() : "";
    const panelLines = body
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => /^\d+\.\s*位置：/.test(line));

    return { pageNumber: section.pageNumber, pageFunction, panelLines };
  });
}

function parsePanelLine(line, pageNumber, pageFunction) {
  const match = line.match(/^\d+\.\s*位置：([^。]+)。(.+)$/);
  if (!match) {
    throw new Error(`无法解析分镜行: ${line}`);
  }

  const position = match[1].split("，")[0].trim();
  const content = match[2].trim();
  const description = `P${pageNumber} / ${pageFunction} / ${content}`;
  return { position, content, description };
}

function buildProject(markdown, existingProject = null) {
  const sections = extractPageSections(markdown);
  if (sections.length !== 40) {
    throw new Error(`预期 40 页，实际解析到 ${sections.length} 页。`);
  }

  const createdAt = existingProject?.createdAt ?? new Date().toISOString();
  const projectId = existingProject?.id ?? createId("project");

  const pages = sections.map(({ pageNumber, pageFunction, panelLines }) => {
    const layoutMap = pageNumber % 2 === 1 ? oddLayout : evenLayout;
    const panels = panelLines.map((line) => {
      const parsed = parsePanelLine(line, pageNumber, pageFunction);
      const layout = layoutMap[parsed.position];
      if (!layout) {
        throw new Error(`P${pageNumber} 未知位置: ${parsed.position}`);
      }
      return createPanel(layout, parsed.description);
    });

    return {
      id: createId("page"),
      name: `P${pageNumber}`,
      width: PAGE_WIDTH,
      height: PAGE_HEIGHT,
      background: "#ffffff",
      panels,
      texts: [],
      bubbles: [],
      layers: panels.map((panel) => `panel:${panel.id}`),
    };
  });

  return {
    id: projectId,
    title: targetTitle,
    createdAt,
    updatedAt: new Date().toISOString(),
    pages,
  };
}

async function readExistingProject() {
  try {
    const entries = await fs.readdir(projectsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const projectJsonPath = path.join(projectsDir, entry.name, "project.json");
      try {
        const raw = await fs.readFile(projectJsonPath, "utf8");
        const project = JSON.parse(raw);
        if (project?.title === targetTitle) {
          return project;
        }
      } catch {
        // Ignore invalid project folders.
      }
    }
  } catch {
    // Ignore missing project dir; script will create it.
  }
  return null;
}

async function persistProject(project) {
  const projectDir = path.join(projectsDir, project.id);
  await fs.mkdir(projectDir, { recursive: true });
  await fs.mkdir(path.join(projectDir, "assets"), { recursive: true });
  await fs.writeFile(
    path.join(projectDir, "project.json"),
    `${JSON.stringify(project, null, 2)}\n`,
    "utf8",
  );
  await fs.writeFile(path.join(projectsDir, ".latest_project"), `${project.id}\n`, "utf8");
}

async function loadProjectThroughApi(project) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.goto(appUrl, { waitUntil: "networkidle" });
    await page.waitForFunction(() => Boolean(window.mangaMaker?.project));
    await page.evaluate(async (nextProject) => {
      await window.mangaMaker.project.load(nextProject);
    }, project);
    return await page.evaluate(() => window.mangaMaker.project.get());
  } finally {
    await browser.close();
  }
}

async function main() {
  const markdown = await fs.readFile(markdownPath, "utf8");
  const existingProject = await readExistingProject();
  const project = buildProject(markdown, existingProject);
  const loadedProject = await loadProjectThroughApi(project);
  await persistProject(loadedProject);

  console.log(
    JSON.stringify(
      {
        title: loadedProject.title,
        id: loadedProject.id,
        pages: loadedProject.pages.length,
        panels: loadedProject.pages.reduce((sum, page) => sum + page.panels.length, 0),
        projectFile: path.join(projectsDir, loadedProject.id, "project.json"),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
