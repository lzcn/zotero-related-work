import { readFile, readdir, mkdir, writeFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";
import assert from "node:assert/strict";
import { Script } from "node:vm";
import { validatePackage } from "./validate-package.mjs";
import { build } from "esbuild";
import { requiredFiles } from "./package-files.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const readJSON = async (name) =>
  JSON.parse(await readFile(join(root, name), "utf8"));
const manifest = await readJSON("manifest.json");
const pkg = await readJSON("package.json");
const app = manifest.applications?.zotero;
if (pkg.version !== manifest.version)
  throw new Error("Package and manifest versions must match.");
assert.equal(
  manifest.name,
  pkg.config.addonName,
  "Plugin name differs from package config.",
);
assert.equal(
  app?.id,
  pkg.config.addonID,
  "Plugin ID differs from package config.",
);
assert.match(
  pkg.version,
  /^\d+\.\d+\.\d+$/,
  "Use a three-part release version.",
);
for (const key of [
  "id",
  "update_url",
  "strict_min_version",
  "strict_max_version",
]) {
  if (!app?.[key])
    throw new Error(`Missing manifest field: applications.zotero.${key}`);
}

const files = {};
async function add(path) {
  files[path] = await readFile(join(root, path));
  if (path.endsWith(".js"))
    new Script(files[path].toString("utf8"), { filename: path });
}
async function addDirectory(path) {
  const entries = await readdir(join(root, path), { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith(".")) continue;
    if (path === "icons" && ["icon.png", "icon-256.png"].includes(entry.name))
      continue;
    const child = `${path}/${entry.name}`;
    if (entry.isDirectory()) await addDirectory(child);
    else if (entry.isFile()) await add(child);
  }
}
for (const name of [
  "manifest.json",
  "bootstrap.js",
  "prefs.js",
  "LICENSE",
  "THIRD-PARTY-NOTICES",
])
  await add(name);
for (const name of ["src", "icons", "locale", "content"])
  await addDirectory(name);
// Validate the same script paths that Zotero's bootstrap loads.
const bootstrap = files["bootstrap.js"].toString("utf8");
const scriptList = bootstrap.match(/var files = \[([^\]]+)\]/);
assert.ok(scriptList, "Missing bootstrap script list.");
for (const match of scriptList[1].matchAll(/"([^"]+\.js)"/g)) {
  assert.ok(files[`src/${match[1]}`], `Missing bootstrap script: ${match[1]}`);
}
for (const locale of ["en-US", "zh-CN"]) {
  assert.ok(
    files[`locale/${locale}/${pkg.config.addonRef}.ftl`],
    `Missing locale: ${locale}`,
  );
}

// Bundle the browser runtime; no Node.js or Python is required by Zotero.
const worker = await build({
  entryPoints: [join(root, "ml/worker.js")],
  bundle: true,
  write: false,
  platform: "browser",
  format: "iife",
  target: "firefox140",
  minify: true,
  legalComments: "inline",
  alias: { "onnxruntime-web": "onnxruntime-web/wasm" },
});
files["runtime/worker.js"] = worker.outputFiles[0].contents;
for (const name of [
  "ort-wasm-simd-threaded.mjs",
  "ort-wasm-simd-threaded.wasm",
])
  files[`runtime/${name}`] = await readFile(
    join(root, "node_modules/onnxruntime-web/dist", name),
  );
for (const [name, packageName] of [
  ["transformers", "@huggingface/transformers"],
  ["jinja", "@huggingface/jinja"],
])
  files[`runtime/${name}-LICENSE`] = await readFile(
    join(root, "node_modules", packageName, "LICENSE"),
  );

files["runtime/onnxruntime-LICENSE"] = await readFile(
  join(root, "licenses/onnxruntime.txt"),
);

files["runtime/onnxruntime-NOTICES"] = await readFile(
  join(root, "licenses/onnxruntime-notices.txt"),
);

const output = join(root, "dist", `${pkg.name}.xpi`);
const bytes = zipSync(files, {
  level: 9,
  mtime: new Date("2020-01-01T00:00:00Z"),
});
validatePackage(bytes, pkg, requiredFiles);
await rm(dirname(output), { recursive: true, force: true });
await mkdir(dirname(output), { recursive: true });
await writeFile(output, bytes);
console.log(`Built dist/${pkg.name}.xpi`);
