import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const outputDir = path.join(rootDir, "src", "assets", "fonts");

/**
 * @typedef {{
 *   packageName: string;
 *   outputName: string;
 *   matcher: RegExp;
 * }} FontCopySpec
 */

/** @type {FontCopySpec[]} */
const FONT_COPY_SPECS = [
  {
    packageName: "@fontpkg/source-han-sans",
    outputName: "SourceHanSans-200.otf",
    matcher: /SourceHanSans-ExtraLight\.otf$/i,
  },
  {
    packageName: "@fontpkg/source-han-sans",
    outputName: "SourceHanSans-300.otf",
    matcher: /SourceHanSans-Light\.otf$/i,
  },
  {
    packageName: "@fontpkg/source-han-sans",
    outputName: "SourceHanSans-400.otf",
    matcher: /SourceHanSans-Regular\.otf$/i,
  },
  {
    packageName: "@fontpkg/source-han-sans",
    outputName: "SourceHanSans-500.otf",
    matcher: /SourceHanSans-Medium\.otf$/i,
  },
  {
    packageName: "@fontpkg/source-han-sans",
    outputName: "SourceHanSans-700.otf",
    matcher: /SourceHanSans-Bold\.otf$/i,
  },
  {
    packageName: "@fontpkg/source-han-sans",
    outputName: "SourceHanSans-900.otf",
    matcher: /SourceHanSans-Heavy\.otf$/i,
  },
  {
    packageName: "@fontpkg/source-han-serif-sc",
    outputName: "SourceHanSerif-200.otf",
    matcher: /SourceHanSerifSC-ExtraLight\.otf$/i,
  },
  {
    packageName: "@fontpkg/source-han-serif-sc",
    outputName: "SourceHanSerif-300.otf",
    matcher: /SourceHanSerifSC-Light\.otf$/i,
  },
  {
    packageName: "@fontpkg/source-han-serif-sc",
    outputName: "SourceHanSerif-400.otf",
    matcher: /SourceHanSerifSC-Regular\.otf$/i,
  },
  {
    packageName: "@fontpkg/source-han-serif-sc",
    outputName: "SourceHanSerif-500.otf",
    matcher: /SourceHanSerifSC-Medium\.otf$/i,
  },
  {
    packageName: "@fontpkg/source-han-serif-sc",
    outputName: "SourceHanSerif-600.otf",
    matcher: /SourceHanSerifSC-SemiBold\.otf$/i,
  },
  {
    packageName: "@fontpkg/source-han-serif-sc",
    outputName: "SourceHanSerif-700.otf",
    matcher: /SourceHanSerifSC-Bold\.otf$/i,
  },
  {
    packageName: "@fontpkg/source-han-serif-sc",
    outputName: "SourceHanSerif-900.otf",
    matcher: /SourceHanSerifSC-Heavy\.otf$/i,
  },
  {
    packageName: "@fontpkg/lxgw-wen-kai",
    outputName: "LXGWWenKai-300.ttf",
    matcher: /LXGWWenKai-Light\.ttf$/i,
  },
  {
    packageName: "@fontpkg/lxgw-wen-kai",
    outputName: "LXGWWenKai-400.ttf",
    matcher: /LXGWWenKai-Regular\.ttf$/i,
  },
  {
    packageName: "@fontpkg/lxgw-wen-kai",
    outputName: "LXGWWenKai-500.ttf",
    matcher: /LXGWWenKai-Medium\.ttf$/i,
  },
  {
    packageName: "@fontpkg/fz-fang-song-z02-s",
    outputName: "FZFangSong-Z02.ttf",
    matcher: /\.ttf$/i,
  },
  {
    packageName: "@fontpkg/yrdzst",
    outputName: "YRDZST-200.ttf",
    matcher: /-Extralight\.ttf$/i,
  },
  {
    packageName: "@fontpkg/yrdzst",
    outputName: "YRDZST-300.ttf",
    matcher: /-Light\.ttf$/i,
  },
  {
    packageName: "@fontpkg/yrdzst",
    outputName: "YRDZST-400.ttf",
    matcher: /-Regular\.ttf$/i,
  },
  {
    packageName: "@fontpkg/yrdzst",
    outputName: "YRDZST-500.ttf",
    matcher: /-Medium\.ttf$/i,
  },
  {
    packageName: "@fontpkg/yrdzst",
    outputName: "YRDZST-600.ttf",
    matcher: /-Semibold\.ttf$/i,
  },
  {
    packageName: "@fontpkg/yrdzst",
    outputName: "YRDZST-700.ttf",
    matcher: /-Bold\.ttf$/i,
  },
  {
    packageName: "@fontpkg/yrdzst",
    outputName: "YRDZST-900.ttf",
    matcher: /-Heavy\.ttf$/i,
  },
  {
    packageName: "@fontpkg/pang-men-zheng-dao-biao-ti-ti-mian-fei-ban",
    outputName: "PangMenZhengDao-700.ttf",
    matcher: /\.ttf$/i,
  },
  {
    packageName: "@fontpkg/zcool-ku-hei",
    outputName: "ZCOOLKuHei-700.ttf",
    matcher: /\.ttf$/i,
  },
  {
    packageName: "@fontpkg/muyao-softbrush",
    outputName: "Muyao-Softbrush-400.ttf",
    matcher: /Muyao-Softbrush\.ttf$/i,
  },
];

const ensureDirectory = (dirPath) => {
  fs.mkdirSync(dirPath, { recursive: true });
};

const findMatchingFile = (packageDir, matcher) => {
  const entries = fs.readdirSync(packageDir, { withFileTypes: true });
  const fileName = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .find((name) => matcher.test(name));

  if (!fileName) {
    const packageLabel = path.relative(rootDir, packageDir);
    throw new Error(`Unable to find font file in ${packageLabel} matching ${String(matcher)}`);
  }

  return path.join(packageDir, fileName);
};

const copyFontFile = (sourcePath, targetPath) => {
  fs.copyFileSync(sourcePath, targetPath);
};

const removeStaleFiles = (expectedOutputNames) => {
  if (!fs.existsSync(outputDir)) {
    return;
  }

  const expected = new Set(expectedOutputNames);
  const existing = fs.readdirSync(outputDir, { withFileTypes: true });

  for (const entry of existing) {
    if (!entry.isFile()) {
      continue;
    }
    if (entry.name === ".gitkeep") {
      continue;
    }
    if (!expected.has(entry.name)) {
      fs.rmSync(path.join(outputDir, entry.name));
    }
  }
};

const main = () => {
  ensureDirectory(outputDir);
  const copiedOutputNames = [];

  for (const spec of FONT_COPY_SPECS) {
    const packageDir = path.join(rootDir, "node_modules", spec.packageName);
    if (!fs.existsSync(packageDir)) {
      throw new Error(
        `Missing package directory: node_modules/${spec.packageName}. Run "pnpm install" first.`,
      );
    }

    const sourcePath = findMatchingFile(packageDir, spec.matcher);
    const targetPath = path.join(outputDir, spec.outputName);

    copyFontFile(sourcePath, targetPath);
    copiedOutputNames.push(spec.outputName);
  }

  removeStaleFiles(copiedOutputNames);
  console.log(`Bundled ${copiedOutputNames.length} font files into src/assets/fonts`);
};

main();
