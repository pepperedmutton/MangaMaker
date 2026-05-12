import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const runtimeRoot = path.join(root, ".mangamaker_runtime", "sysml-v2");
const releaseUrl = "https://github.com/Systems-Modeling/SysML-v2-Pilot-Implementation/releases/download/2026-03/jupyter-sysml-kernel-0.58.0.zip";
const zipPath = path.join(runtimeRoot, "jupyter-sysml-kernel-0.58.0.zip");
const extractRoot = path.join(runtimeRoot, "jupyter-sysml-kernel");
const helperRoot = path.join(runtimeRoot, "helper");
const helperSource = path.join(root, "scripts", "sysml", "SysmlPilotValidator.java");
const jarPath = path.join(extractRoot, "sysml", "jupyter-sysml-kernel-0.58.0-all.jar");
const libraryDir = path.join(extractRoot, "sysml", "sysml.library");

const ensureDir = async (dir) => {
  await fsp.mkdir(dir, { recursive: true });
};

const fileExists = (file) => fs.existsSync(file);

const findJavaBin = () => {
  const explicit = process.env.MANGAMAKER_SYSML_JAVA;
  if (explicit) {
    return path.dirname(explicit);
  }
  const localJdk = path.join(root, ".mangamaker_runtime", "java", "jdk-21.0.11+10", "bin");
  if (fileExists(path.join(localJdk, process.platform === "win32" ? "java.exe" : "java"))) {
    return localJdk;
  }
  return "";
};

const sha256 = async (file) => {
  const hash = createHash("sha256");
  const stream = fs.createReadStream(file);
  for await (const chunk of stream) {
    hash.update(chunk);
  }
  return hash.digest("hex");
};

const download = async () => {
  await ensureDir(runtimeRoot);
  if (fileExists(zipPath)) {
    console.log(`Using existing ${zipPath}`);
    return;
  }
  console.log(`Downloading ${releaseUrl}`);
  const response = await fetch(releaseUrl);
  if (!response.ok || !response.body) {
    throw new Error(`Download failed: ${response.status} ${response.statusText}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  await fsp.writeFile(zipPath, buffer);
  console.log(`Downloaded ${zipPath}`);
  console.log(`sha256=${await sha256(zipPath)}`);
};

const extract = () => {
  if (fileExists(jarPath) && fileExists(libraryDir)) {
    console.log(`Using existing ${extractRoot}`);
    return;
  }
  execFileSync("powershell", [
    "-NoProfile",
    "-Command",
    `Expand-Archive -LiteralPath ${JSON.stringify(zipPath)} -DestinationPath ${JSON.stringify(extractRoot)} -Force`,
  ], { stdio: "inherit" });
};

const mirrorEncodedLibraryNames = async () => {
  const pairs = [
    ["Kernel Libraries", "Kernel%20Libraries"],
    ["Systems Library", "Systems%20Library"],
    ["Domain Libraries", "Domain%20Libraries"],
    [path.join("Domain Libraries", "Requirement Derivation"), path.join("Domain%20Libraries", "Requirement%20Derivation")],
    [path.join("Domain Libraries", "Cause and Effect"), path.join("Domain%20Libraries", "Cause%20and%20Effect")],
    [path.join("Domain Libraries", "Quantities and Units"), path.join("Domain%20Libraries", "Quantities%20and%20Units")],
  ];
  for (const [sourceRelative, targetRelative] of pairs) {
    const source = path.join(libraryDir, sourceRelative);
    const target = path.join(libraryDir, targetRelative);
    if (fileExists(source) && !fileExists(target)) {
      await fsp.cp(source, target, { recursive: true });
    }
  }
};

const compileHelper = async () => {
  const javaBin = findJavaBin();
  const javac = javaBin
    ? path.join(javaBin, process.platform === "win32" ? "javac.exe" : "javac")
    : "javac";
  await ensureDir(helperRoot);
  execFileSync(javac, ["-encoding", "UTF-8", "-cp", jarPath, "-d", helperRoot, helperSource], {
    stdio: "inherit",
  });
};

await download();
extract();
await mirrorEncodedLibraryNames();
await compileHelper();

console.log("SysML v2 Pilot runtime is ready.");
console.log(`MANGAMAKER_SYSML_PILOT_JAR=${jarPath}`);
console.log(`MANGAMAKER_SYSML_LIBRARY_DIR=${libraryDir}`);
console.log(`MANGAMAKER_SYSML_HELPER_CLASSES=${helperRoot}`);
