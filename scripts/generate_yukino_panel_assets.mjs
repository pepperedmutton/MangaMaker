import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const workspaceRoot = path.resolve(projectRoot, "..");

const projectPath = path.join(projectRoot, "src", "generated", "yukinoProject.json");
const storyboardPath = path.join(workspaceRoot, "漫画大纲.md");
const publicOutputDir = path.join(projectRoot, "public", "generated", "yukino-panels");

const FORGE_ROOT = process.env.FORGE_ROOT ?? "D:\\Forge\\stable-diffusion-webui-forge";
const FORGE_API_BASE = process.env.FORGE_API_BASE ?? "http://127.0.0.1:7861/sdapi/v1";
const FORGE_TXT2IMG_URL = `${FORGE_API_BASE}/txt2img`;
const FORGE_OPTIONS_URL = `${FORGE_API_BASE}/options`;
const LIMIT = Number(process.env.LIMIT ?? "0");
const SKIP_EXISTING = process.env.SKIP_EXISTING === "1";
const MAX_RETRIES = 3;
const ANIMA_SAMPLER_NAME = "ER-SDE";
const ANIMA_SCHEDULER = "Simple";
const ANIMA_ALLOWED_RESOLUTIONS = [
  { width: 768, height: 1024, label: "portrait" },
  { width: 1024, height: 1024, label: "square" },
  { width: 1024, height: 768, label: "landscape" },
];
const TASK_NEGATIVE_PROMPT = [
  "monochrome",
  "black and white",
  "grayscale",
  "watermark",
  "logo",
  "signature",
  "caption",
  "subtitle",
  "text",
  "letters",
  "words",
  "speech bubble",
  "dialogue balloon",
  "sound effect lettering",
  "comic layout lines",
  "framing border",
  "page border",
  "lowres",
  "blurry",
  "bad hands",
  "extra fingers",
  "malformed anatomy",
  "photorealistic",
].join(", ");
const TASK_PROMPT_SUFFIX = [
  "full color anime illustration",
  "vibrant anime coloring",
  "polished cel shading",
  "detailed background",
  "expressive lighting",
  "no speech bubbles",
  "no lettering",
  "no comic layout lines",
].join(", ");
const PNG_SIGNATURE = "89504e470d0a1a0a";
const PAD = 24;

function asNumber(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asString(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function asBoolean(value, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function roundToStep(value, step) {
  const normalizedStep = Math.max(1, step);
  return Math.max(normalizedStep, Math.round(value / normalizedStep) * normalizedStep);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function mergePromptParts(parts) {
  return parts
    .flatMap((part) => String(part ?? "").split(","))
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part, index, array) => array.indexOf(part) === index)
    .join(", ");
}

function scaleToBounds(width, height, bounds) {
  let nextWidth = width;
  let nextHeight = height;

  const maxScale = Math.min(
    bounds.maxWidth / nextWidth,
    bounds.maxHeight / nextHeight,
    1,
  );
  nextWidth *= maxScale;
  nextHeight *= maxScale;

  const minScale = Math.max(
    bounds.minWidth / nextWidth,
    bounds.minHeight / nextHeight,
    1,
  );
  nextWidth *= minScale;
  nextHeight *= minScale;

  return {
    width: nextWidth,
    height: nextHeight,
  };
}

function chooseClosestResolution(targetRatio, resolutions) {
  return resolutions.reduce((best, candidate) => {
    const candidateRatio = candidate.width / candidate.height;
    const candidateDelta = Math.abs(candidateRatio - targetRatio);

    if (!best) {
      return { candidate, delta: candidateDelta };
    }

    if (candidateDelta < best.delta) {
      return { candidate, delta: candidateDelta };
    }

    return best;
  }, null)?.candidate;
}

function getGenerationSize(panel, workflow) {
  if (workflow.allowedResolutions?.length) {
    const chosen = chooseClosestResolution(panel.width / panel.height, workflow.allowedResolutions);
    if (!chosen) {
      throw new Error("No allowed resolution could be selected for the current workflow.");
    }

    return {
      width: chosen.width,
      height: chosen.height,
    };
  }

  const baseArea = Math.max(64 * 64, workflow.width * workflow.height);
  const targetRatio = panel.width / panel.height;
  const initialWidth = Math.sqrt(baseArea * targetRatio);
  const initialHeight = initialWidth / targetRatio;
  const bounded = scaleToBounds(initialWidth, initialHeight, {
    minWidth: workflow.widthMinimum,
    maxWidth: workflow.widthMaximum,
    minHeight: workflow.heightMinimum,
    maxHeight: workflow.heightMaximum,
  });

  return {
    width: clamp(roundToStep(bounded.width, workflow.widthStep), workflow.widthMinimum, workflow.widthMaximum),
    height: clamp(roundToStep(bounded.height, workflow.heightStep), workflow.heightMinimum, workflow.heightMaximum),
  };
}

function slugPanelPath(pageIndex, panelIndex) {
  const page = String(pageIndex + 1).padStart(2, "0");
  const panel = String(panelIndex + 1).padStart(2, "0");
  const fileName = `p${page}-panel${panel}.png`;
  return {
    fileName,
    publicSrc: `/generated/yukino-panels/${fileName}`,
    absolutePath: path.join(publicOutputDir, fileName),
  };
}

function createInitialPanelViewBox(panel, sourceWidth, sourceHeight) {
  const panelRatio = panel.width / panel.height;
  const sourceRatio = sourceWidth / sourceHeight;

  if (sourceRatio > panelRatio) {
    const width = sourceHeight * panelRatio;
    return {
      x: (sourceWidth - width) * 0.5,
      y: 0,
      width,
      height: sourceHeight,
    };
  }

  const height = sourceWidth / panelRatio;
  return {
    x: 0,
    y: (sourceHeight - height) * 0.5,
    width: sourceWidth,
    height,
  };
}

async function readJsonIfExists(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function fetchJson(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.warn(`Failed to read ${url}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

async function readForgeWorkflowConfig() {
  const [uiConfig, config, liveOptions] = await Promise.all([
    readJsonIfExists(path.join(FORGE_ROOT, "ui-config.json")),
    readJsonIfExists(path.join(FORGE_ROOT, "config.json")),
    fetchJson(FORGE_OPTIONS_URL),
  ]);

  const preset = asString(liveOptions?.forge_preset, asString(config?.forge_preset, ""));
  const presetPrefix = preset.trim().toLowerCase();
  const uiValue = (key) => uiConfig?.[key];
  const presetValue = (suffix) =>
    presetPrefix ? config?.[`${presetPrefix}_${suffix}`] : undefined;

  const workflow = {
    source: {
      uiConfigPath: path.join(FORGE_ROOT, "ui-config.json"),
      configPath: path.join(FORGE_ROOT, "config.json"),
      optionsUrl: FORGE_OPTIONS_URL,
    },
    preset,
    modelCheckpoint: asString(
      liveOptions?.sd_model_checkpoint,
      asString(config?.sd_model_checkpoint, ""),
    ),
    samplerName: asString(
      uiValue("customscript/sampler.py/txt2img/Sampling method/value"),
      asString(presetValue("t2i_sampler"), "Euler"),
    ),
    scheduler: asString(
      uiValue("customscript/sampler.py/txt2img/Schedule type/value"),
      asString(presetValue("t2i_scheduler"), "Automatic"),
    ),
    steps: asNumber(
      uiValue("customscript/sampler.py/txt2img/Sampling steps/value"),
      asNumber(presetValue("t2i_steps"), 20),
    ),
    cfgScale: asNumber(
      uiValue("txt2img/CFG Scale/value"),
      asNumber(presetValue("t2i_cfg"), 7),
    ),
    distilledCfgScale: asNumber(
      uiValue("txt2img/Distilled CFG Scale/value"),
      asNumber(presetValue("t2i_d_cfg"), 0),
    ),
    seed: asNumber(
      uiValue("customscript/seed.py/txt2img/Seed/value"),
      -1,
    ),
    batchCount: asNumber(uiValue("txt2img/Batch count/value"), 1),
    batchSize: asNumber(uiValue("txt2img/Batch size/value"), 1),
    width: asNumber(
      uiValue("txt2img/Width/value"),
      asNumber(presetValue("t2i_width"), 512),
    ),
    height: asNumber(
      uiValue("txt2img/Height/value"),
      asNumber(presetValue("t2i_height"), 512),
    ),
    widthMinimum: asNumber(uiValue("txt2img/Width/minimum"), 64),
    widthMaximum: asNumber(uiValue("txt2img/Width/maximum"), 2048),
    widthStep: asNumber(uiValue("txt2img/Width/step"), 8),
    heightMinimum: asNumber(uiValue("txt2img/Height/minimum"), 64),
    heightMaximum: asNumber(uiValue("txt2img/Height/maximum"), 2048),
    heightStep: asNumber(uiValue("txt2img/Height/step"), 8),
    enableHr: asNumber(uiValue("txt2img/Hires steps/value"), 0) > 0,
    hiresSteps: asNumber(uiValue("txt2img/Hires steps/value"), 0),
    denoisingStrength: asNumber(uiValue("txt2img/Denoising strength/value"), 0.7),
    upscaleBy: asNumber(uiValue("txt2img/Upscale by/value"), 2),
    resizeWidthTo: asNumber(uiValue("txt2img/Resize width to/value"), 0),
    resizeHeightTo: asNumber(uiValue("txt2img/Resize height to/value"), 0),
    hiresUpscaler: asString(uiValue("txt2img/Upscaler/value"), "Latent"),
    hiresCfgScale: asNumber(
      uiValue("txt2img/Hires CFG Scale/value"),
      asNumber(uiValue("txt2img/CFG Scale/value"), 7),
    ),
    hiresDistilledCfgScale: asNumber(
      uiValue("txt2img/Hires Distilled CFG Scale/value"),
      asNumber(uiValue("txt2img/Distilled CFG Scale/value"), 0),
    ),
    hiresSamplerName: asString(
      uiValue("txt2img/Hires sampling method/value"),
      "Use same sampler",
    ),
    hiresScheduler: asString(
      uiValue("txt2img/Hires schedule type/value"),
      "Use same scheduler",
    ),
    restoreFaces: asBoolean(liveOptions?.face_restoration, false),
    tiling: asBoolean(liveOptions?.tiling, false),
  };

  const usesAnima =
    /anima/iu.test(workflow.preset) ||
    /anima/iu.test(workflow.modelCheckpoint);

  if (usesAnima) {
    return {
      ...workflow,
      samplerName: ANIMA_SAMPLER_NAME,
      scheduler: ANIMA_SCHEDULER,
      enableHr: false,
      allowedResolutions: ANIMA_ALLOWED_RESOLUTIONS,
      forcedRules: [
        "anima sampler forced to ER-SDE",
        "anima scheduler forced to Simple",
        "anima resolution forced to one of 768x1024, 1024x1024, 1024x768",
        "anima hires disabled to keep output inside the allowed resolution set",
      ],
    };
  }

  return {
    ...workflow,
    allowedResolutions: null,
    forcedRules: [],
  };
}

function buildTxt2ImgPayload(prompt, workflow, width, height) {
  const payload = {
    prompt: mergePromptParts([prompt, TASK_PROMPT_SUFFIX]),
    negative_prompt: mergePromptParts([TASK_NEGATIVE_PROMPT]),
    steps: workflow.steps,
    cfg_scale: workflow.cfgScale,
    distilled_cfg_scale: workflow.distilledCfgScale,
    sampler_name: workflow.samplerName,
    scheduler: workflow.scheduler,
    width,
    height,
    batch_size: workflow.batchSize,
    n_iter: workflow.batchCount,
    seed: workflow.seed,
    restore_faces: workflow.restoreFaces,
    tiling: workflow.tiling,
    do_not_save_grid: true,
    save_images: false,
    send_images: true,
  };

  if (workflow.enableHr) {
    payload.enable_hr = true;
    payload.hr_upscaler = workflow.hiresUpscaler;
    payload.hr_second_pass_steps = workflow.hiresSteps;
    payload.denoising_strength = workflow.denoisingStrength;
    payload.hr_scale = workflow.upscaleBy;
    payload.hr_cfg = workflow.hiresCfgScale;
    payload.hr_distilled_cfg = workflow.hiresDistilledCfgScale;
    if (workflow.resizeWidthTo > 0) {
      payload.hr_resize_x = workflow.resizeWidthTo;
    }
    if (workflow.resizeHeightTo > 0) {
      payload.hr_resize_y = workflow.resizeHeightTo;
    }
    if (workflow.hiresSamplerName && workflow.hiresSamplerName !== "Use same sampler") {
      payload.hr_sampler_name = workflow.hiresSamplerName;
    }
    if (workflow.hiresScheduler && workflow.hiresScheduler !== "Use same scheduler") {
      payload.hr_scheduler = workflow.hiresScheduler;
    }
  }

  return payload;
}

async function generateImage(prompt, workflow, width, height) {
  const payload = buildTxt2ImgPayload(prompt, workflow, width, height);
  const response = await fetch(FORGE_TXT2IMG_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Forge request failed with ${response.status}: ${await response.text()}`);
  }

  const data = await response.json();
  const first = data.images?.[0];
  if (!first) {
    throw new Error("Forge response did not contain an image.");
  }

  return Buffer.from(first, "base64");
}

async function generateImageWithRetry(prompt, workflow, width, height) {
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      return await generateImage(prompt, workflow, width, height);
    } catch (error) {
      lastError = error;
      console.warn(
        `Forge generation failed on attempt ${attempt}/${MAX_RETRIES}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      if (attempt < MAX_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
      }
    }
  }
  throw lastError;
}

function readPngDimensions(buffer) {
  if (buffer.length < 24 || buffer.subarray(0, 8).toString("hex") !== PNG_SIGNATURE) {
    throw new Error("Only PNG output is supported for panel import.");
  }

  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

async function readImageDimensions(filePath) {
  const buffer = await fs.readFile(filePath);
  return readPngDimensions(buffer);
}

function parseStoryboardPages(markdown) {
  const pages = new Map();
  let currentPageNumber = null;

  for (const rawLine of markdown.split(/\r?\n/u)) {
    const line = rawLine.trim();
    const headingMatch = line.match(/^###\s+P(\d+)$/u);
    if (headingMatch) {
      currentPageNumber = Number(headingMatch[1]);
      pages.set(currentPageNumber, []);
      continue;
    }

    if (!currentPageNumber) {
      continue;
    }

    if (/^\d+\.\s*位置：/u.test(line)) {
      pages.get(currentPageNumber).push(line);
    }
  }

  return pages;
}

function extractDialoguesFromLine(line) {
  const content = line.replace(/^\d+\.\s*位置：[^。]+。/u, "");
  const dialogues = [];
  const regex = /[“「『]([^”」』]+)[”」』]/gu;
  let match;

  while ((match = regex.exec(content)) !== null) {
    const text = match[1].trim();
    const context = content.slice(Math.max(0, match.index - 24), match.index);
    const bubbleType = /心里|心中|内心/u.test(context) ? "thought" : "round";
    dialogues.push({
      text,
      bubbleType,
    });
  }

  return dialogues;
}

function createBubbleLayout(panel, dialogues) {
  const count = dialogues.length;
  if (count === 0) {
    return [];
  }

  const innerPad = clamp(Math.round(Math.min(panel.width, panel.height) * 0.05), 16, 36);
  const usableX = panel.x + innerPad;
  const usableY = panel.y + innerPad;
  const usableWidth = Math.max(120, panel.width - innerPad * 2);
  const usableHeight = Math.max(100, panel.height - innerPad * 2);
  const bubbleHeight = clamp(Math.round(usableHeight * 0.24), 100, 170);
  const fontSize = clamp(Math.round(Math.min(panel.width, panel.height) * 0.07), 20, 30);

  if (count === 1) {
    const width = clamp(Math.round(usableWidth * 0.7), 220, Math.max(220, usableWidth));
    return [
      {
        x: clamp(
          panel.x + panel.width - innerPad - width,
          panel.x + innerPad,
          panel.x + panel.width - innerPad - width,
        ),
        y: usableY,
        width,
        height: bubbleHeight,
        fontSize,
        tailTip: {
          x: clamp(panel.x + panel.width * 0.62, panel.x + PAD, panel.x + panel.width - PAD),
          y: clamp(
            usableY + bubbleHeight + Math.round(panel.height * 0.16),
            panel.y + PAD,
            panel.y + panel.height - PAD,
          ),
        },
      },
    ];
  }

  if (count === 2 && usableWidth >= 440) {
    const width = Math.max(180, Math.floor((usableWidth - innerPad) / 2));
    return [
      {
        x: usableX,
        y: usableY,
        width,
        height: bubbleHeight,
        fontSize,
        tailTip: {
          x: clamp(panel.x + panel.width * 0.3, panel.x + PAD, panel.x + panel.width - PAD),
          y: clamp(
            usableY + bubbleHeight + Math.round(panel.height * 0.16),
            panel.y + PAD,
            panel.y + panel.height - PAD,
          ),
        },
      },
      {
        x: panel.x + panel.width - innerPad - width,
        y: usableY,
        width,
        height: bubbleHeight,
        fontSize,
        tailTip: {
          x: clamp(panel.x + panel.width * 0.72, panel.x + PAD, panel.x + panel.width - PAD),
          y: clamp(
            usableY + bubbleHeight + Math.round(panel.height * 0.16),
            panel.y + PAD,
            panel.y + panel.height - PAD,
          ),
        },
      },
    ];
  }

  const layouts = [];
  const width = clamp(Math.round(usableWidth * 0.8), 220, usableWidth);
  const gap = 14;
  for (let index = 0; index < count; index += 1) {
    const y = usableY + index * (bubbleHeight + gap);
    layouts.push({
      x: panel.x + Math.round((panel.width - width) / 2),
      y,
      width,
      height: bubbleHeight,
      fontSize,
      tailTip: {
        x: clamp(panel.x + panel.width * 0.5, panel.x + PAD, panel.x + panel.width - PAD),
        y: clamp(
          y + bubbleHeight + Math.round(panel.height * 0.12),
          panel.y + PAD,
          panel.y + panel.height - PAD,
        ),
      },
    });
  }

  return layouts;
}

function buildPageBubbles(page, pageLines) {
  if (page.panels.length !== pageLines.length) {
    throw new Error(
      `Dialogue parse mismatch on ${page.name}: ${page.panels.length} panels vs ${pageLines.length} lines.`,
    );
  }

  const bubbles = [];

  for (let panelIndex = 0; panelIndex < page.panels.length; panelIndex += 1) {
    const panel = page.panels[panelIndex];
    const dialogues = extractDialoguesFromLine(pageLines[panelIndex]);
    const layouts = createBubbleLayout(panel, dialogues);

    dialogues.forEach((dialogue, dialogueIndex) => {
      const layout = layouts[dialogueIndex];
      const id = `bubble-${page.id}-${panel.id}-${String(dialogueIndex + 1).padStart(2, "0")}`;
      bubbles.push({
        id,
        x: layout.x,
        y: layout.y,
        width: layout.width,
        height: layout.height,
        tailTip: layout.tailTip,
        tailBaseAngle: 90,
        tailWidth: 24,
        text: dialogue.text,
        fontSize: layout.fontSize,
        fontFamily: "system-ui",
        textAlign: "center",
        verticalAlign: "middle",
        bubbleType: dialogue.bubbleType,
        strokeWidth: 2,
        backgroundColor: "#ffffff",
        strokeColor: "#111111",
        cornerRadius: 12,
        bumpiness: 0.5,
        spikeCount: 8,
        spikeDepth: 0.5,
        spikeDepths: [],
        spikePositions: [],
        activeSpikeIndex: -1,
        jaggedness: 6,
        thoughtCircles: dialogue.bubbleType === "thought" ? 4 : 3,
      });
    });
  }

  return bubbles;
}

async function main() {
  await fs.mkdir(publicOutputDir, { recursive: true });

  const workflow = await readForgeWorkflowConfig();
  console.log(
    JSON.stringify(
      {
        workflow: {
          preset: workflow.preset,
          modelCheckpoint: workflow.modelCheckpoint,
          samplerName: workflow.samplerName,
          scheduler: workflow.scheduler,
          steps: workflow.steps,
          cfgScale: workflow.cfgScale,
          distilledCfgScale: workflow.distilledCfgScale,
          width: workflow.width,
          height: workflow.height,
          enableHr: workflow.enableHr,
          allowedResolutions: workflow.allowedResolutions,
          forcedRules: workflow.forcedRules,
        },
        source: workflow.source,
      },
      null,
      2,
    ),
  );

  const [projectRaw, storyboardRaw] = await Promise.all([
    fs.readFile(projectPath, "utf8"),
    fs.readFile(storyboardPath, "utf8"),
  ]);

  const project = JSON.parse(projectRaw);
  const storyboardPages = parseStoryboardPages(storyboardRaw);

  const total = project.pages.reduce((sum, page) => sum + page.panels.length, 0);
  let done = 0;
  let generatedPanels = 0;

  for (let pageIndex = 0; pageIndex < project.pages.length; pageIndex += 1) {
    const page = project.pages[pageIndex];
    for (let panelIndex = 0; panelIndex < page.panels.length; panelIndex += 1) {
      if (LIMIT > 0 && generatedPanels >= LIMIT) {
        break;
      }

      const panel = page.panels[panelIndex];
      const requestedSize = getGenerationSize(panel, workflow);
      const asset = slugPanelPath(pageIndex, panelIndex);
      const shouldReuse =
        SKIP_EXISTING &&
        (await fs
          .stat(asset.absolutePath)
          .then(() => true)
          .catch(() => false));

      let sourceWidth = requestedSize.width;
      let sourceHeight = requestedSize.height;

      if (shouldReuse) {
        console.log(`[${done + 1}/${total}] reusing ${page.name} panel ${panelIndex + 1} -> ${asset.fileName}`);
        const existingDimensions = await readImageDimensions(asset.absolutePath);
        sourceWidth = existingDimensions.width;
        sourceHeight = existingDimensions.height;
      } else {
        console.log(
          `[${done + 1}/${total}] generating ${page.name} panel ${panelIndex + 1} -> ${asset.fileName} (${requestedSize.width}x${requestedSize.height})`,
        );
        const imageBuffer = await generateImageWithRetry(
          panel.description,
          workflow,
          requestedSize.width,
          requestedSize.height,
        );
        await fs.writeFile(asset.absolutePath, imageBuffer);
        const generatedDimensions = readPngDimensions(imageBuffer);
        sourceWidth = generatedDimensions.width;
        sourceHeight = generatedDimensions.height;
      }

      panel.image = {
        src: asset.publicSrc,
        prompt: panel.description,
        sourceWidth,
        sourceHeight,
        viewBox: createInitialPanelViewBox(panel, sourceWidth, sourceHeight),
      };

      done += 1;
      generatedPanels += 1;
    }

    if (LIMIT > 0 && generatedPanels >= LIMIT) {
      break;
    }

    const pageNumberMatch = page.name.match(/^P(\d+)$/u);
    if (!pageNumberMatch) {
      throw new Error(`Failed to infer page number from ${page.name}`);
    }

    const pageNumber = Number(pageNumberMatch[1]);
    const pageLines = storyboardPages.get(pageNumber) ?? [];
    const bubbles = buildPageBubbles(page, pageLines);
    page.bubbles = bubbles;
    page.layers = [
      ...page.panels.map((panel) => `panel:${panel.id}`),
      ...bubbles.map((bubble) => `bubble:${bubble.id}`),
    ];
  }

  const timestamp = new Date().toISOString();
  project.updatedAt = timestamp;
  if (!project.createdAt) {
    project.createdAt = timestamp;
  }

  await fs.writeFile(projectPath, `${JSON.stringify(project, null, 2)}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        projectPath,
        publicOutputDir,
        pages: project.pages.length,
        panels: total,
        bubbles: project.pages.reduce((sum, page) => sum + (page.bubbles?.length ?? 0), 0),
        updatedAt: project.updatedAt,
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
