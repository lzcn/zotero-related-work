const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
function fixture(active = false, entries = []) {
  const files = new Set(entries),
    moves = [],
    prefs = new Map();
  const ctx = vm.createContext({
    ChromeUtils: {
      importESModule: () => ({
        AddonManager: {
          getAddonByID: async (id) => {
            assert.ok(
              ["related-work@zhi.dev", "similar-works@zhi.dev"].includes(id),
            );
            return { isActive: active };
          },
        },
      }),
    },
    PathUtils: path.posix,
    IOUtils: {
      exists: async (p) => files.has(p),
      move: async (a, b, o) => {
        assert.equal(o.noOverwrite, true);
        moves.push([a, b]);
        for (const f of [...files])
          if (f === a || f.startsWith(a + "/")) {
            files.delete(f);
            files.add(b + f.slice(a.length));
          }
      },
    },
    Services: {
      prefs: {
        prefHasUserValue: (p) => prefs.has(p.replace("extensions.zotero.", "")),
        clearUserPref: (p) => prefs.delete(p.replace("extensions.zotero.", "")),
      },
    },
    Zotero: {
      DataDirectory: { dir: "/data" },
      Prefs: { get: (k) => prefs.get(k), set: (k, v) => prefs.set(k, v) },
    },
  });
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, "../src/migration.js"), "utf8"),
    ctx,
  );
  return { run: () => ctx.SWMigration.prepare(), files, moves, prefs };
}
test("active old addon prevents database migration", async () => {
  const h = fixture(true, ["/data/related-work/similarity.sqlite"]);
  await assert.rejects(h.run(), /Disable/);
  assert.equal(h.moves.length, 0);
});
test("moves vectors and WAL together once; never touches Zotero fulltext database", async () => {
  const h = fixture(false, [
    "/data/fulltext.sqlite",
    "/data/related-work",
    "/data/related-work/similarity.sqlite",
    "/data/related-work/similarity.sqlite-wal",
  ]);
  await h.run();
  await h.run();
  assert.equal(h.moves.length, 1);
  assert.ok(h.files.has("/data/similar-works/similarity.sqlite-wal"));
  assert.ok(h.files.has("/data/fulltext.sqlite"));
  assert.ok(!h.files.has("/data/related-work"));
});
test("existing destination stops migration without overwriting either database", async () => {
  const h = fixture(false, [
    "/data/related-work/similarity.sqlite",
    "/data/similar-works",
    "/data/similar-works/similarity.sqlite",
  ]);
  await assert.rejects(h.run(), /Both/);
  assert.equal(h.moves.length, 0);
});
test("preferences migrate and old names are cleaned; new values survive", async () => {
  const h = fixture();
  h.prefs.set("relatedwork.recommendationCount", 12);
  h.prefs.set("relatedwork.indexDelayMs", 1500);
  h.prefs.set("similarworks.indexDelayMs", 2000);
  await h.run();
  assert.equal(h.prefs.get("similarworks.recommendationCount"), 12);
  assert.equal(h.prefs.get("similarworks.indexDelayMs"), 2000);
  assert.ok(!h.prefs.has("relatedwork.recommendationCount"));
});
