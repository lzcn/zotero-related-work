// Test the packaged plugin against an isolated Zotero profile and database.
import { spawn } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  open,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync, unzipSync, strFromU8, strToU8 } from "fflate";
import process from "node:process";
import { URL } from "node:url";
import { setTimeout, clearTimeout } from "node:timers";

const root = await mkdtemp(join(tmpdir(), "similar-works-host-"));
const profile = join(root, "profile");
const dataDirectory = join(root, "data");
const marker = join(root, "result.json");
await mkdir(join(profile, "extensions"), { recursive: true });
await mkdir(dataDirectory);
const prefs = {
  "extensions.zotero.dataDir": dataDirectory,
  "extensions.zotero.useDataDir": true,
  "extensions.zotero.firstRun2": false,
  "extensions.zotero.firstRun.skipFirefoxProfileAccessCheck": true,
  "extensions.autoDisableScopes": 0,
  "extensions.enabledScopes": 15,
  "extensions.zotero.automaticScraperUpdates": false,
  "extensions.zotero.similar-works.backgroundStartupDelayMs": 0,
  "extensions.zotero.similar-works.recommendationMethod": "text",
  "app.update.auto": false,
  "extensions.update.enabled": false,
};
await writeFile(
  join(profile, "user.js"),
  Object.entries(prefs)
    .map(
      ([key, value]) =>
        `user_pref(${JSON.stringify(key)}, ${JSON.stringify(value)});`,
    )
    .join("\n"),
);
const files = unzipSync(
  await readFile(new URL("../dist/zotero-similar-works.xpi", import.meta.url)),
);
files["bootstrap.js"] = strToU8(
  strFromU8(files["bootstrap.js"]) +
    `
var SWOriginalStartup = startup;
startup = async function(data) {
  await SWOriginalStartup(data);
  setTimeout(async () => {
    const result = {};
    try {
      if (!SWReady || !SWScope.SWSection._registered) throw new Error("Sidebar did not register");
      await SWScope.SWIndexer.corpus.ready;
      for (let i = 0; i < 100 && !SWScope.SWSection._preferencePane; i++)
        await new Promise(resolve => setTimeout(resolve, 50));
      if (!SWScope.SWSection._preferencePane) throw new Error("Settings did not register");
      const registered = SWScope.SWSection._registered;
      await startup(data);
      if (SWScope.SWSection._registered !== registered) throw new Error("Duplicate registration");
      const doc = Zotero.getMainWindow().document;
      if (doc.querySelectorAll("#similar-works-style").length !== 1) throw new Error("Duplicate stylesheet");
      const body = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
      doc.documentElement.appendChild(body);
      SWScope.SWSection.ensureSkeleton(body);
      await doc.l10n.translateFragment(body);
      if (!body.querySelector("progress").getAttribute("aria-label")) throw new Error("Missing localized progress label");
      body.remove();
      const corpus = SWScope.SWIndexer.corpus;
      if (!corpus._db) throw new Error("Index did not open");
      await shutdown(data, 2);
      if (corpus._db || SWScope.SWSection._registered || SWScope.SWSection._preferencePane)
        throw new Error("Shutdown leaked resources");
      result.ok = true;
    } catch (error) { result.error = String(error) + "\\n" + error.stack; }
    await IOUtils.writeUTF8(${JSON.stringify(marker)}, JSON.stringify(result));
    Services.startup.quit(Components.interfaces.nsIAppStartup.eAttemptQuit);
  }, 1000);
};
`,
);
await writeFile(
  join(profile, "extensions/similar-works@lzcn.xpi"),
  zipSync(files),
);
const log = await open(join(root, "zotero.log"), "w");
const child = spawn(
  process.env.ZOTERO_BINARY || "/Applications/Zotero.app/Contents/MacOS/zotero",
  ["-no-remote", "-profile", profile, "-ZoteroDebugText"],
  { stdio: ["ignore", log.fd, log.fd] },
);
const exited = new Promise((resolve, reject) => {
  child.once("exit", (code) => resolve(code));
  child.once("error", reject);
});
let timeout;
let passed = false;
try {
  const code = await Promise.race([
    exited,
    new Promise((_, reject) => {
      timeout = setTimeout(
        () => reject(new Error("Zotero host test timed out")),
        45000,
      );
    }),
  ]);
  const result = JSON.parse(await readFile(marker, "utf8"));
  if (code !== 0 || !result.ok)
    throw new Error(JSON.stringify({ code, result }));
  console.log(
    "PASS Packaged startup, single registration, localized progress and shutdown cleanup.",
  );
  passed = true;
} finally {
  clearTimeout(timeout);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGTERM");
    const killTimer = setTimeout(() => child.kill("SIGKILL"), 5000);
    await exited.catch(() => {});
    clearTimeout(killTimer);
  }
  await log.close();
  if (passed) await rm(root, { recursive: true, force: true });
  else console.error(`Host test profile and logs retained at ${root}`);
}
