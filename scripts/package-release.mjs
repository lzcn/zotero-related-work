import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, mkdir, copyFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync, strFromU8 } from "fflate";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const source = join(root, "dist", `${pkg.config.addonRef}.xpi`);
const bytes = await readFile(source);
const files = unzipSync(bytes);
const manifest = JSON.parse(strFromU8(files["manifest.json"]));
assert.equal(
  manifest.version,
  pkg.version,
  "Build version differs from release version.",
);
assert.equal(manifest.name, pkg.config.addonName);
assert.equal(manifest.applications.zotero.id, pkg.config.addonID);
for (const name of [
  "bootstrap.js",
  "prefs.js",
  "LICENSE",
  "THIRD-PARTY-NOTICES",
]) {
  assert.ok(files[name]?.length, `Missing package file: ${name}`);
}

const directory = join(root, "release", `v${pkg.version}`);
const filename = `${pkg.config.addonRef}-${pkg.version}.xpi`;
await mkdir(directory, { recursive: true });
await copyFile(source, join(directory, filename));
for (const name of [
  "README.md",
  "README.zh-CN.md",
  "LICENSE",
  "THIRD-PARTY-NOTICES",
]) {
  await copyFile(join(root, name), join(directory, name));
}
await writeFile(
  join(directory, "SHA256SUMS"),
  `${createHash("sha256").update(bytes).digest("hex")}  ${filename}\n`,
);
console.log(`Local release prepared: release/v${pkg.version}/${filename}`);
