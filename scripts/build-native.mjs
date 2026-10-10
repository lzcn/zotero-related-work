// Build a universal macOS helper against the pinned official ONNX Runtime SDK.
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import {
  mkdir,
  copyFile,
  writeFile,
  readFile,
  readdir,
  rm,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const version = "1.22.0";
const checksum =
  "cfa6f6584d87555ed9f6e7e8a000d3947554d589efe3723b8bfa358cd263d03c";
const cache = join(root, "build/native-sdk");
const sdk = join(cache, `onnxruntime-osx-universal2-${version}`);
const output = join(root, "build/native");
function run(cmd, args) {
  const result = spawnSync(cmd, args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${cmd} failed: ${result.status}`);
}
export async function prepareNativeSDK() {
  if (process.platform !== "darwin") return false;
  await mkdir(cache, { recursive: true });
  if (!existsSync(join(sdk, "include/onnxruntime_cxx_api.h"))) {
    const url = `https://github.com/microsoft/onnxruntime/releases/download/v${version}/onnxruntime-osx-universal2-${version}.tgz`;
    const response = await globalThis.fetch(url);
    if (!response.ok)
      throw new Error(`ONNX Runtime download failed: ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (createHash("sha256").update(bytes).digest("hex") !== checksum)
      throw new Error("ONNX Runtime SDK checksum mismatch");
    const archive = join(cache, "sdk.tgz");
    await writeFile(archive, bytes);
    run("tar", ["-xzf", archive, "-C", cache]);
  }
  return true;
}

async function digest(paths) {
  const hash = createHash("sha256");
  for (const path of paths) hash.update(await readFile(path));
  return hash.digest("hex");
}

export async function buildNative() {
  if (!(await prepareNativeSDK())) return false;
  const binaries = [
    join(output, "inference"),
    join(output, `libonnxruntime.${version}.dylib`),
  ];
  const headers = (await readdir(join(sdk, "include")))
    .filter((name) => name.endsWith(".h"))
    .sort();
  const input = await digest([
    join(root, "native/inference.mm"),
    fileURLToPath(import.meta.url),
    ...headers.map((name) => join(sdk, "include", name)),
    join(sdk, `lib/libonnxruntime.${version}.dylib`),
  ]);
  const stateFile = join(output, "state.json");
  try {
    const state = JSON.parse(await readFile(stateFile, "utf8"));
    if (state.input === input && state.output === (await digest(binaries)))
      return true;
  } catch {
    /* Missing or corrupt output requires rebuilding. */
  }
  await rm(stateFile, { force: true });
  await mkdir(output, { recursive: true });
  run("xcrun", [
    "clang++",
    "-std=c++17",
    "-O2",
    "-fobjc-arc",
    "-arch",
    "arm64",
    "-arch",
    "x86_64",
    "-mmacosx-version-min=13.3",
    "-I" + join(sdk, "include"),
    join(root, "native/inference.mm"),
    "-L" + join(sdk, "lib"),
    "-lonnxruntime",
    "-framework",
    "Foundation",
    "-Wl,-rpath,@loader_path",
    "-o",
    join(output, "inference"),
  ]);
  await copyFile(
    join(sdk, `lib/libonnxruntime.${version}.dylib`),
    join(output, `libonnxruntime.${version}.dylib`),
  );
  run("codesign", [
    "--force",
    "--sign",
    "-",
    "--timestamp=none",
    join(output, "inference"),
  ]);
  await writeFile(
    stateFile,
    JSON.stringify({ input, output: await digest(binaries) }),
  );
  return true;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await buildNative();
