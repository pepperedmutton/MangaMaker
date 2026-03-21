import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CHARACTERS,
  PAGES,
  PAGE_COUNT,
  PANEL_COUNT,
  PROJECT_FOLDER,
  PROJECT_TITLE,
  PROJECT_TYPE,
  STORY,
  projectPaths,
} from "./psychopassGreyNoiseData.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const paths = projectPaths(projectRoot);

const PAGE_WIDTH = 1200;
const PAGE_HEIGHT = 1700;
const MARGIN = 60;
const GAP = 30;
const PANEL_STYLE = {
  fill: "#fffdf8",
  stroke: "#111111",
  strokeWidth: 4,
  cornerRadius: 12,
};

const LIMIT = Number(process.env.LIMIT ?? "0");
const SKIP_EXISTING = process.env.SKIP_EXISTING === "1";
const MAX_RETRIES = 3;
const FORGE_ROOT = process.env.FORGE_ROOT ?? "D:\\Forge\\stable-diffusion-webui-forge";
const FORGE_API_BASE = process.env.FORGE_API_BASE ?? "http://127.0.0.1:7861/sdapi/v1";
const FORGE_TXT2IMG_URL = `${FORGE_API_BASE}/txt2img`;
const FORGE_OPTIONS_URL = `${FORGE_API_BASE}/options`;
const ANIMA_SAMPLER_NAME = "ER-SDE";
const ANIMA_SCHEDULER = "Simple";
const ANIMA_ALLOWED_RESOLUTIONS = [
  { width: 768, height: 1024 },
  { width: 1024, height: 1024 },
  { width: 1024, height: 768 },
];
const TASK_NEGATIVE_PROMPT = [
  "monochrome",
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
  "polished cel shading",
  "detailed background",
  "expressive lighting",
  "no speech bubbles",
  "no lettering",
  "no comic border",
].join(", ");
const PNG_SIGNATURE = "89504e470d0a1a0a";

const pad2 = (value) => String(value).padStart(2, "0");
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const asNumber = (value, fallback) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;
const asString = (value, fallback = "") => (typeof value === "string" ? value : fallback);
const asBoolean = (value, fallback = false) => (typeof value === "boolean" ? value : fallback);

const mergePromptParts = (parts) =>
  parts
    .flatMap((part) => String(part ?? "").split(","))
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part, index, list) => list.indexOf(part) === index)
    .join(", ");

const rectPanel = (x, y, width, height) => ({
  x,
  y,
  width,
  height,
  rotation: 0,
  points: [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ],
  style: PANEL_STYLE,
  image: null,
});

const layoutRegistry = {
  full: () => [rectPanel(MARGIN, MARGIN, PAGE_WIDTH - MARGIN * 2, PAGE_HEIGHT - MARGIN * 2)],
  stacked: () => {
    const width = PAGE_WIDTH - MARGIN * 2;
    const height = PAGE_HEIGHT - MARGIN * 2;
    const topHeight = Math.floor((height - GAP) / 2);
    const bottomHeight = height - GAP - topHeight;
    return [
      rectPanel(MARGIN, MARGIN, width, topHeight),
      rectPanel(MARGIN, MARGIN + topHeight + GAP, width, bottomHeight),
    ];
  },
  sideBySide: () => {
    const width = PAGE_WIDTH - MARGIN * 2;
    const height = PAGE_HEIGHT - MARGIN * 2;
    const leftWidth = Math.floor((width - GAP) / 2);
    const rightWidth = width - GAP - leftWidth;
    return [
      rectPanel(MARGIN, MARGIN, leftWidth, height),
      rectPanel(MARGIN + leftWidth + GAP, MARGIN, rightWidth, height),
    ];
  },
  topWideBottomTwo: () => {
    const width = PAGE_WIDTH - MARGIN * 2;
    const height = PAGE_HEIGHT - MARGIN * 2;
    const topHeight = 720;
    const bottomHeight = height - GAP - topHeight;
    const leftWidth = Math.floor((width - GAP) / 2);
    const rightWidth = width - GAP - leftWidth;
    return [
      rectPanel(MARGIN, MARGIN, width, topHeight),
      rectPanel(MARGIN, MARGIN + topHeight + GAP, leftWidth, bottomHeight),
      rectPanel(MARGIN + leftWidth + GAP, MARGIN + topHeight + GAP, rightWidth, bottomHeight),
    ];
  },
  leftTallRightTwo: () => {
    const width = PAGE_WIDTH - MARGIN * 2;
    const height = PAGE_HEIGHT - MARGIN * 2;
    const leftWidth = 650;
    const rightWidth = width - GAP - leftWidth;
    const topHeight = Math.floor((height - GAP) / 2);
    const bottomHeight = height - GAP - topHeight;
    return [
      rectPanel(MARGIN, MARGIN, leftWidth, height),
      rectPanel(MARGIN + leftWidth + GAP, MARGIN, rightWidth, topHeight),
      rectPanel(MARGIN + leftWidth + GAP, MARGIN + topHeight + GAP, rightWidth, bottomHeight),
    ];
  },
};

const bubbleLayoutForPanel = (panel, dialogues) => {
  if (dialogues.length === 0) {
    return [];
  }
  const innerPad = clamp(Math.round(Math.min(panel.width, panel.height) * 0.05), 16, 36);
  const usableX = panel.x + innerPad;
  const usableY = panel.y + innerPad;
  const usableWidth = Math.max(120, panel.width - innerPad * 2);
  const usableHeight = Math.max(100, panel.height - innerPad * 2);
  const bubbleHeight = clamp(Math.round(usableHeight * 0.24), 100, 170);
  const fontSize = clamp(Math.round(Math.min(panel.width, panel.height) * 0.07), 20, 30);

  if (dialogues.length === 1) {
    const width = clamp(Math.round(usableWidth * 0.72), 220, usableWidth);
    return [
      {
        x: panel.x + panel.width - innerPad - width,
        y: usableY,
        width,
        height: bubbleHeight,
        fontSize,
        tailTip: {
          x: clamp(panel.x + panel.width * 0.62, panel.x + 24, panel.x + panel.width - 24),
          y: clamp(usableY + bubbleHeight + Math.round(panel.height * 0.16), panel.y + 24, panel.y + panel.height - 24),
        },
      },
    ];
  }

  if (dialogues.length === 2 && usableWidth >= 440) {
    const width = Math.max(180, Math.floor((usableWidth - innerPad) / 2));
    return [
      {
        x: usableX,
        y: usableY,
        width,
        height: bubbleHeight,
        fontSize,
        tailTip: {
          x: clamp(panel.x + panel.width * 0.28, panel.x + 24, panel.x + panel.width - 24),
          y: clamp(usableY + bubbleHeight + Math.round(panel.height * 0.16), panel.y + 24, panel.y + panel.height - 24),
        },
      },
      {
        x: panel.x + panel.width - innerPad - width,
        y: usableY,
        width,
        height: bubbleHeight,
        fontSize,
        tailTip: {
          x: clamp(panel.x + panel.width * 0.72, panel.x + 24, panel.x + panel.width - 24),
          y: clamp(usableY + bubbleHeight + Math.round(panel.height * 0.16), panel.y + 24, panel.y + panel.height - 24),
        },
      },
    ];
  }

  const width = clamp(Math.round(usableWidth * 0.8), 220, usableWidth);
  const gap = 14;
  return dialogues.map((_, index) => {
    const y = usableY + index * (bubbleHeight + gap);
    return {
      x: panel.x + Math.round((panel.width - width) / 2),
      y,
      width,
      height: bubbleHeight,
      fontSize,
      tailTip: {
        x: clamp(panel.x + panel.width * 0.5, panel.x + 24, panel.x + panel.width - 24),
        y: clamp(y + bubbleHeight + Math.round(panel.height * 0.12), panel.y + 24, panel.y + panel.height - 24),
      },
    };
  });
};

const createBubble = (layout, dialogue, pageNumber, panelNumber, dialogueIndex) => ({
  id: `bubble-p${pad2(pageNumber)}-${pad2(panelNumber)}-${pad2(dialogueIndex + 1)}`,
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
  direction: "vertical",
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

const createPage = (pageEntry) => {
  const layout = layoutRegistry[pageEntry.topology];
  if (!layout) {
    throw new Error(`Unknown layout topology: ${pageEntry.topology}`);
  }
  const panelRects = layout();
  if (panelRects.length !== pageEntry.panels.length) {
    throw new Error(`P${pad2(pageEntry.number)} layout count mismatch: expected ${pageEntry.panels.length}, got ${panelRects.length}`);
  }
  const panels = pageEntry.panels.map((panelEntry, index) => ({
    id: `panel-p${pad2(pageEntry.number)}-${pad2(index + 1)}`,
    ...panelRects[index],
    description: panelEntry.prompt,
  }));
  return {
    id: `page-${pad2(pageEntry.number)}`,
    name: `第 ${pageEntry.number} 页`,
    width: PAGE_WIDTH,
    height: PAGE_HEIGHT,
    background: "#ffffff",
    panels,
    texts: [],
    bubbles: [],
    layers: panels.map((panel) => `panel:${panel.id}`),
  };
};

const buildProject = async () => {
  const existingRaw = await fs.readFile(paths.projectJsonPath, "utf8").catch(() => null);
  const existing = existingRaw ? JSON.parse(existingRaw) : null;
  const timestamp = new Date().toISOString();
  return {
    id: existing?.id ?? "project-psychopass-grey-noise",
    title: PROJECT_TITLE,
    type: PROJECT_TYPE,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
    pages: PAGES.map(createPage),
  };
};

const renderStorySection = () => [
  "## 1. 故事",
  "",
  `- 主题：${STORY.theme}`,
  `- 主角目标：${STORY.protagonistGoal}`,
  `- 核心冲突：${STORY.coreConflict}`,
  `- 转折点：${STORY.turningPoint}`,
  `- 情绪最高点：${STORY.climax}`,
  `- 收束点：${STORY.closure}`,
  "",
  "### 短纲",
  "",
  ...STORY.shortOutline.map((line, index) => `${index + 1}. ${line}`),
].join("\n");

const renderCharacterSection = () =>
  [
    "## 2. 人物设定",
    "",
    ...CHARACTERS.flatMap((character) => [
      `### ${character.name}`,
      "",
      "#### 角色基准",
      "",
      ...character.baseline.map((line) => `- ${line}`),
      "",
      "#### 外观变体",
      "",
      ...character.variants.map((line) => `- ${line}`),
      "",
      "#### 能力或道具规则",
      "",
      ...character.rules.map((line) => `- ${line}`),
      "",
    ]),
  ].join("\n");

const renderStoryboardSection = () =>
  [
    "## 3. 分镜",
    "",
    ...PAGES.flatMap((page) => [
      `### P${pad2(page.number)}`,
      "",
      `- 功能：${page.pageFunction}`,
      `- 情绪作用：${page.emotion}`,
      `- 翻页点或落点：${page.turn}`,
      `- 分镜拓扑：${page.topologyLabel}`,
      `- panel 数量：${page.panels.length}`,
      "",
    ]),
  ].join("\n");

const renderDetailedSection = () =>
  [
    "## 4. 详细分镜描述",
    "",
    ...PAGES.flatMap((page) => [
      `### P${pad2(page.number)}`,
      "",
      `- 功能：${page.pageFunction}`,
      `- 情绪作用：${page.emotion}`,
      `- 翻页点或落点：${page.turn}`,
      `- 分镜拓扑：${page.topologyLabel}`,
      "",
      ...page.panels.map(
        (panelEntry, index) =>
          `${index + 1}. 位置：${panelEntry.position}。${panelEntry.shotLabel}：${panelEntry.detail}`,
      ),
      "",
    ]),
  ].join("\n");

const renderPromptSection = () =>
  [
    "## 5. 提示词",
    "",
    "- 语言约束：全部 `description` 使用英文，自包含、静态、单图描述，不混入对白文字。",
    "",
    ...PAGES.flatMap((page) => [
      `### P${pad2(page.number)}`,
      "",
      ...page.panels.map((panelEntry, index) => `${index + 1}. ${panelEntry.prompt}`),
      "",
    ]),
  ].join("\n");

const renderGenerationSection = (summary = null) => {
  const lines = [
    "## 6. 生成图片",
    "",
    "- 图像生成：按当前 Forge 前端配置与运行中 `/sdapi/v1/options` 读取参数后执行。",
    "- 图像导入：仅使用等比裁切 + viewBox 平移，不做单轴拉伸。",
    `- 项目目录：\`${paths.projectDir}\``,
    `- 资源目录：\`${paths.assetsDir}\``,
  ];
  if (!summary) {
    lines.push("- 当前状态：待执行批量出图。");
    return lines.join("\n");
  }
  lines.push("- 当前状态：已完成。");
  lines.push(`- 生成页数：${summary.pages}`);
  lines.push(`- 生成分镜数：${summary.panels}`);
  lines.push(`- 对白气泡数：${summary.bubbles}`);
  lines.push(`- Forge preset：${summary.workflow.preset}`);
  lines.push(`- checkpoint：${summary.workflow.modelCheckpoint}`);
  lines.push(`- sampler / scheduler：${summary.workflow.samplerName} / ${summary.workflow.scheduler}`);
  lines.push(`- steps / CFG / distilled CFG：${summary.workflow.steps} / ${summary.workflow.cfgScale} / ${summary.workflow.distilledCfgScale}`);
  lines.push(`- 基础分辨率：${summary.workflow.width} x ${summary.workflow.height}`);
  if (summary.workflow.allowedResolutions?.length) {
    lines.push(
      `- anima 固定分辨率集合：${summary.workflow.allowedResolutions
        .map((entry) => `${entry.width}x${entry.height}`)
        .join(", ")}`,
    );
  }
  if (summary.workflow.forcedRules?.length) {
    lines.push(`- 强制覆盖规则：${summary.workflow.forcedRules.join("；")}`);
  }
  return lines.join("\n");
};

const renderWorkflowDoc = (summary = null) =>
  [
    `# ${PROJECT_TITLE}`,
    "",
    renderStorySection(),
    "",
    renderCharacterSection(),
    "",
    renderStoryboardSection(),
    "",
    renderDetailedSection(),
    "",
    renderPromptSection(),
    "",
    renderGenerationSection(summary),
    "",
  ].join("\n");

const ensureDirectories = async () => {
  await fs.mkdir(path.dirname(paths.sourceDocPath), { recursive: true });
  await fs.mkdir(path.dirname(paths.templateProjectPath), { recursive: true });
  await fs.mkdir(paths.projectDir, { recursive: true });
  await fs.mkdir(paths.assetsDir, { recursive: true });
};

const readJsonIfExists = async (filePath) => {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
};

const fetchJson = async (url) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }
  return response.json();
};

const readForgeWorkflowConfig = async () => {
  const [uiConfig, config, liveOptions] = await Promise.all([
    readJsonIfExists(path.join(FORGE_ROOT, "ui-config.json")),
    readJsonIfExists(path.join(FORGE_ROOT, "config.json")),
    fetchJson(FORGE_OPTIONS_URL),
  ]);

  const preset = asString(liveOptions?.forge_preset, asString(config?.forge_preset, ""));
  const presetPrefix = preset.trim().toLowerCase();
  const uiValue = (key) => uiConfig?.[key];
  const presetValue = (suffix) => (presetPrefix ? config?.[`${presetPrefix}_${suffix}`] : undefined);

  const workflow = {
    source: {
      uiConfigPath: path.join(FORGE_ROOT, "ui-config.json"),
      configPath: path.join(FORGE_ROOT, "config.json"),
      optionsUrl: FORGE_OPTIONS_URL,
    },
    preset,
    modelCheckpoint: asString(liveOptions?.sd_model_checkpoint, asString(config?.sd_model_checkpoint, "")),
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
    cfgScale: asNumber(uiValue("txt2img/CFG Scale/value"), asNumber(presetValue("t2i_cfg"), 7)),
    distilledCfgScale: asNumber(
      uiValue("txt2img/Distilled CFG Scale/value"),
      asNumber(presetValue("t2i_d_cfg"), 0),
    ),
    seed: asNumber(uiValue("customscript/seed.py/txt2img/Seed/value"), -1),
    batchCount: asNumber(uiValue("txt2img/Batch count/value"), 1),
    batchSize: asNumber(uiValue("txt2img/Batch size/value"), 1),
    width: asNumber(uiValue("txt2img/Width/value"), asNumber(presetValue("t2i_width"), 512)),
    height: asNumber(uiValue("txt2img/Height/value"), asNumber(presetValue("t2i_height"), 512)),
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
    hiresCfgScale: asNumber(uiValue("txt2img/Hires CFG Scale/value"), asNumber(uiValue("txt2img/CFG Scale/value"), 7)),
    hiresDistilledCfgScale: asNumber(
      uiValue("txt2img/Hires Distilled CFG Scale/value"),
      asNumber(uiValue("txt2img/Distilled CFG Scale/value"), 0),
    ),
    hiresSamplerName: asString(uiValue("txt2img/Hires sampling method/value"), "Use same sampler"),
    hiresScheduler: asString(uiValue("txt2img/Hires schedule type/value"), "Use same scheduler"),
    restoreFaces: asBoolean(liveOptions?.face_restoration, false),
    tiling: asBoolean(liveOptions?.tiling, false),
  };

  const usesAnima = /anima/iu.test(workflow.preset) || /anima/iu.test(workflow.modelCheckpoint);
  if (!usesAnima) {
    return {
      ...workflow,
      allowedResolutions: null,
      forcedRules: [],
    };
  }

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
};

const roundToStep = (value, step) => {
  const actualStep = Math.max(1, step);
  return Math.max(actualStep, Math.round(value / actualStep) * actualStep);
};

const scaleToBounds = (width, height, bounds) => {
  let nextWidth = width;
  let nextHeight = height;
  const maxScale = Math.min(bounds.maxWidth / nextWidth, bounds.maxHeight / nextHeight, 1);
  nextWidth *= maxScale;
  nextHeight *= maxScale;
  const minScale = Math.max(bounds.minWidth / nextWidth, bounds.minHeight / nextHeight, 1);
  nextWidth *= minScale;
  nextHeight *= minScale;
  return { width: nextWidth, height: nextHeight };
};

const chooseClosestResolution = (targetRatio, resolutions) =>
  resolutions.reduce((best, candidate) => {
    const delta = Math.abs(candidate.width / candidate.height - targetRatio);
    if (!best || delta < best.delta) {
      return { candidate, delta };
    }
    return best;
  }, null)?.candidate ?? null;

const getGenerationSize = (panel, workflow) => {
  if (workflow.allowedResolutions?.length) {
    const chosen = chooseClosestResolution(panel.width / panel.height, workflow.allowedResolutions);
    if (!chosen) {
      throw new Error("No allowed resolution could be selected for the current workflow.");
    }
    return chosen;
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
};

const buildTxt2ImgPayload = (prompt, workflow, width, height) => {
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
    if (workflow.resizeWidthTo > 0) payload.hr_resize_x = workflow.resizeWidthTo;
    if (workflow.resizeHeightTo > 0) payload.hr_resize_y = workflow.resizeHeightTo;
    if (workflow.hiresSamplerName && workflow.hiresSamplerName !== "Use same sampler") {
      payload.hr_sampler_name = workflow.hiresSamplerName;
    }
    if (workflow.hiresScheduler && workflow.hiresScheduler !== "Use same scheduler") {
      payload.hr_scheduler = workflow.hiresScheduler;
    }
  }
  return payload;
};

const generateImage = async (prompt, workflow, width, height) => {
  const response = await fetch(FORGE_TXT2IMG_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildTxt2ImgPayload(prompt, workflow, width, height)),
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
};

const generateImageWithRetry = async (prompt, workflow, width, height) => {
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      return await generateImage(prompt, workflow, width, height);
    } catch (error) {
      lastError = error;
      console.warn(`Forge generation failed on attempt ${attempt}/${MAX_RETRIES}: ${error instanceof Error ? error.message : String(error)}`);
      if (attempt < MAX_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
      }
    }
  }
  throw lastError;
};

const readPngDimensions = (buffer) => {
  if (buffer.length < 24 || buffer.subarray(0, 8).toString("hex") !== PNG_SIGNATURE) {
    throw new Error("Only PNG output is supported for panel import.");
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(16 + 4),
  };
};

const readImageDimensions = async (filePath) => readPngDimensions(await fs.readFile(filePath));

const createInitialPanelViewBox = (panel, sourceWidth, sourceHeight) => {
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
};

const assetFile = (pageNumber, panelNumber) => {
  const fileName = `p${pad2(pageNumber)}-panel${pad2(panelNumber)}.png`;
  return {
    fileName,
    absolutePath: path.join(paths.assetsDir, fileName),
    publicSrc: `/projects/${PROJECT_FOLDER}/assets/${fileName}`,
  };
};

const populateProjectAssets = async (project, workflow) => {
  const pages = structuredClone(project.pages);
  let processed = 0;
  let generated = 0;
  const total = PANEL_COUNT;

  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    const page = pages[pageIndex];
    const sourcePage = PAGES[pageIndex];
    const bubbles = [];

    for (let panelIndex = 0; panelIndex < page.panels.length; panelIndex += 1) {
      if (LIMIT > 0 && generated >= LIMIT) {
        break;
      }
      const panel = page.panels[panelIndex];
      const sourcePanel = sourcePage.panels[panelIndex];
      const requestedSize = getGenerationSize(panel, workflow);
      const asset = assetFile(sourcePage.number, panelIndex + 1);
      const exists = await fs.stat(asset.absolutePath).then(() => true).catch(() => false);
      let sourceWidth = requestedSize.width;
      let sourceHeight = requestedSize.height;

      if (SKIP_EXISTING && exists) {
        const dimensions = await readImageDimensions(asset.absolutePath);
        sourceWidth = dimensions.width;
        sourceHeight = dimensions.height;
        console.log(`[${processed + 1}/${total}] reusing ${asset.fileName}`);
      } else {
        console.log(`[${processed + 1}/${total}] generating ${asset.fileName} (${requestedSize.width}x${requestedSize.height})`);
        const buffer = await generateImageWithRetry(sourcePanel.prompt, workflow, requestedSize.width, requestedSize.height);
        await fs.writeFile(asset.absolutePath, buffer);
        const dimensions = readPngDimensions(buffer);
        sourceWidth = dimensions.width;
        sourceHeight = dimensions.height;
        generated += 1;
      }

      panel.image = {
        src: asset.publicSrc,
        prompt: sourcePanel.prompt,
        sourceWidth,
        sourceHeight,
        viewBox: createInitialPanelViewBox(panel, sourceWidth, sourceHeight),
      };

      const layouts = bubbleLayoutForPanel(panel, sourcePanel.dialogues);
      sourcePanel.dialogues.forEach((dialogue, index) => {
        bubbles.push(createBubble(layouts[index], dialogue, sourcePage.number, panelIndex + 1, index));
      });

      processed += 1;
    }

    page.bubbles = bubbles;
    page.layers = [
      ...page.panels.map((panel) => `panel:${panel.id}`),
      ...bubbles.map((bubble) => `bubble:${bubble.id}`),
    ];

    if (LIMIT > 0 && generated >= LIMIT) {
      break;
    }
  }

  return {
    ...project,
    updatedAt: new Date().toISOString(),
    pages,
  };
};

const main = async () => {
  if (PAGE_COUNT !== 40) {
    throw new Error(`Expected 40 pages but got ${PAGE_COUNT}.`);
  }
  if (PANEL_COUNT !== 60) {
    throw new Error(`Expected 60 panels but got ${PANEL_COUNT}.`);
  }

  await ensureDirectories();

  const sourceDoc = renderWorkflowDoc();
  await fs.writeFile(paths.sourceDocPath, `${sourceDoc}\n`, "utf8");
  await fs.writeFile(paths.outputDocPath, `${sourceDoc}\n`, "utf8");

  const templateProject = await buildProject();
  await fs.writeFile(paths.templateProjectPath, `${JSON.stringify(templateProject, null, 2)}\n`, "utf8");

  const workflow = await readForgeWorkflowConfig();
  console.log(
    JSON.stringify(
      {
        title: PROJECT_TITLE,
        pages: PAGE_COUNT,
        panels: PANEL_COUNT,
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
          allowedResolutions: workflow.allowedResolutions,
          forcedRules: workflow.forcedRules,
        },
      },
      null,
      2,
    ),
  );

  const finalProject = await populateProjectAssets(templateProject, workflow);
  await fs.writeFile(paths.templateProjectPath, `${JSON.stringify(finalProject, null, 2)}\n`, "utf8");
  await fs.writeFile(paths.projectJsonPath, `${JSON.stringify(finalProject, null, 2)}\n`, "utf8");
  await fs.writeFile(paths.metaPath, `${PROJECT_FOLDER}\n`, "utf8");

  const summary = {
    pages: finalProject.pages.length,
    panels: finalProject.pages.reduce((sum, page) => sum + page.panels.length, 0),
    bubbles: finalProject.pages.reduce((sum, page) => sum + page.bubbles.length, 0),
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
      allowedResolutions: workflow.allowedResolutions,
      forcedRules: workflow.forcedRules,
    },
  };

  await fs.writeFile(paths.outputDocPath, `${renderWorkflowDoc(summary)}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        sourceDoc: paths.sourceDocPath,
        outputDoc: paths.outputDocPath,
        templateProject: paths.templateProjectPath,
        projectFile: paths.projectJsonPath,
        assetsDir: paths.assetsDir,
        ...summary,
      },
      null,
      2,
    ),
  );
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
