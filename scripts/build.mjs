import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const readJSON = async name => JSON.parse(await readFile(join(root, name), "utf8"));
const manifest = await readJSON("manifest.json");
const pkg = await readJSON("package.json");
const app = manifest.applications?.zotero;
if (pkg.version !== manifest.version) throw new Error("Package and manifest versions must match.");
for (const key of ["id", "update_url", "strict_min_version", "strict_max_version"]) {
  if (!app?.[key]) throw new Error(`Missing manifest field: applications.zotero.${key}`);
}

const files = {};
async function add(path) {
  files[path] = await readFile(join(root, path));
}
async function addDirectory(path) {
  const entries = await readdir(join(root, path), { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith(".")) continue;
    const child = `${path}/${entry.name}`;
    if (entry.isDirectory()) await addDirectory(child);
    else if (entry.isFile()) await add(child);
  }
}
for (const name of ["manifest.json", "bootstrap.js", "prefs.js", "LICENSE", "THIRD-PARTY-NOTICES"]) await add(name);
for (const name of ["src", "icons", "locale"]) await addDirectory(name);

const output = join(root, "dist", "similar-works.xpi");
await mkdir(dirname(output), { recursive: true });
await writeFile(output, zipSync(files, { level: 9, mtime: new Date("2020-01-01T00:00:00Z") }));
console.log("Built dist/similar-works.xpi");
