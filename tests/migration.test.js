const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { DatabaseSync } = require("node:sqlite");
global.SWSearch = require("../src/search.js").SWSearch;
const { SWCorpus } = require("../src/corpus.js");
const { SWSemantic } = require("../src/semantic.js");
const migrationSource = fs.readFileSync(
  path.join(__dirname, "../src/migration.js"),
  "utf8",
);

function database(t) {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  db.exec(`
    CREATE TABLE meta (k TEXT PRIMARY KEY,v TEXT);
    CREATE TABLE docs (key TEXT PRIMARY KEY,hash TEXT);
    CREATE TABLE embeddings (key TEXT PRIMARY KEY,sourceHash TEXT,model TEXT,vector BLOB);
    CREATE TABLE recommendations (cacheKey TEXT PRIMARY KEY,payload TEXT);
    CREATE TABLE fingerprints (key TEXT PRIMARY KEY,counts BLOB);
    CREATE TABLE doc_updates (key TEXT PRIMARY KEY,updatedAt INTEGER);
    CREATE TABLE source_updates (key TEXT PRIMARY KEY,sourceHash TEXT);
    INSERT INTO meta VALUES ('schemaVersion','3'),('signatureModel','preserve-idf');
    INSERT INTO recommendations VALUES ('old-ranking','old-scores');
  `);
  const vector = new Uint8Array(1536).fill(31);
  for (const [key, hash, model] of [
    ["valid", "current", SWSemantic.version],
    ["stale", "old", SWSemantic.version],
    ["retired", "current", "minilm-l6-q8-v1"],
    ["unknown-model", "current", "future-model"],
    ["orphan", "current", SWSemantic.version],
  ]) {
    if (key !== "orphan")
      db.prepare("INSERT INTO docs VALUES (?, 'current')").run(key);
    db.prepare("INSERT INTO embeddings VALUES (?,?,?,?)").run(
      key,
      hash,
      model,
      vector,
    );
    db.prepare("INSERT INTO fingerprints VALUES (?,?)").run(key, vector);
    db.prepare("INSERT INTO doc_updates VALUES (?,123)").run(key);
    db.prepare("INSERT INTO source_updates VALUES (?,'current')").run(key);
  }
  const corpus = new SWCorpus(),
    sqls = [];
  let intercept = () => {};
  corpus._db = {
    async execute(sql, params = []) {
      sqls.push(sql);
      intercept(sql);
      const statement = db.prepare(sql);
      if (sql.startsWith("SELECT "))
        return statement
          .all(...params)
          .map((row) => ({ getResultByName: (name) => row[name] }));
      statement.run(...params);
      return [];
    },
    async executeTransaction(work) {
      db.exec("BEGIN");
      try {
        await work();
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  };
  return {
    db,
    corpus,
    sqls,
    vector,
    intercept: (fn) => {
      intercept = fn;
    },
  };
}

test("cache migration removes retired ranks and orphan rows while preserving valid vectors and fingerprints", async (t) => {
  const { db, corpus, vector, sqls } = database(t);
  await corpus._migrateRetrievalCache();
  assert.deepEqual(
    db
      .prepare("SELECT key FROM embeddings ORDER BY key")
      .all()
      .map((r) => r.key),
    ["unknown-model", "valid"],
  );
  assert.deepEqual(
    new Uint8Array(
      db
        .prepare("SELECT vector FROM embeddings WHERE key='valid'")
        .get().vector,
    ),
    vector,
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) AS n FROM recommendations").get().n,
    0,
  );
  for (const table of ["fingerprints", "doc_updates", "source_updates"])
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 4);
  assert.equal(
    db.prepare("SELECT v FROM meta WHERE k='schemaVersion'").get().v,
    "3",
  );
  assert.equal(
    db.prepare("SELECT v FROM meta WHERE k='signatureModel'").get().v,
    "preserve-idf",
  );
  assert.equal(
    db.prepare("SELECT v FROM meta WHERE k='retrievalCacheVersion'").get().v,
    "1",
  );
  db.prepare(
    "INSERT INTO recommendations VALUES ('new-ranking','fresh')",
  ).run();
  sqls.length = 0;
  await corpus._migrateRetrievalCache();
  assert.equal(sqls.length, 1);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS n FROM recommendations").get().n,
    1,
  );
});

test("failed or cancelled cache migration rolls back both deletes and marker, then retries", async (t) => {
  for (const cancel of [false, true]) {
    const { db, corpus, intercept } = database(t);
    intercept((sql) => {
      if (sql.startsWith("DELETE FROM fingerprints")) {
        if (cancel) corpus._stopped = true;
        else throw new Error("Simulated disk failure");
      }
    });
    await assert.rejects(
      corpus._migrateRetrievalCache(),
      cancel ? /cancelled/ : /disk failure/,
    );
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM embeddings").get().n, 5);
    assert.equal(
      db.prepare("SELECT COUNT(*) AS n FROM recommendations").get().n,
      1,
    );
    assert.equal(
      db.prepare("SELECT v FROM meta WHERE k='retrievalCacheVersion'").get(),
      undefined,
    );
    corpus._stopped = false;
    intercept(() => {});
    await corpus._migrateRetrievalCache();
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM embeddings").get().n, 2);
  }
});

test("a newer cache migration marker is preserved on downgrade", async (t) => {
  const { db, corpus, sqls } = database(t);
  db.prepare("INSERT INTO meta VALUES ('retrievalCacheVersion','2')").run();
  await corpus._migrateRetrievalCache();
  assert.equal(sqls.length, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM embeddings").get().n, 5);
});

function files(t, initialPrefs = {}) {
  const data = fs.mkdtempSync(
    path.join(os.tmpdir(), "related-work-migration-"),
  );
  t.after(() => fs.rmSync(data, { recursive: true, force: true }));
  const root = path.join(data, "related-work"),
    models = path.join(root, "models"),
    runtime = path.join(root, "runtime");
  const current = path.join(models, SWSemantic.version),
    retired = path.join(models, "minilm-l6-q8-v1");
  const keepHash = "a".repeat(64),
    oldHash = "b".repeat(64);
  const write = (name, text = "preserve") => {
    fs.mkdirSync(path.dirname(name), { recursive: true });
    fs.writeFileSync(name, text);
  };
  write(path.join(current, "onnx-model.onnx"));
  write(path.join(current, "coreml-cache", "compiled.bin"));
  write(path.join(current, "onnx-model.onnx.tmp"), "partial");
  write(path.join(current, "research.tmp"), "unknown-user-file");
  write(path.join(retired, "onnx-model_quantized.onnx"), "obsolete");
  write(path.join(models, "unknown-model", "keep"));
  write(path.join(runtime, keepHash, "inference"));
  write(path.join(runtime, keepHash, "inference.tmp"), "partial");
  write(path.join(runtime, oldHash, "inference"), "obsolete");
  write(path.join(runtime, "unknown-directory", "keep"));
  const userPrefs = new Map(
    Object.entries(initialPrefs).map(([k, v]) => ["similar-works." + k, v]),
  );
  const defaults = new Map([["similar-works.tagNameStyle", "sentence"]]);
  const removed = [];
  const context = vm.createContext({
    Zotero: {
      DataDirectory: { dir: data },
      isMac: true,
      Prefs: {
        get: (k) => userPrefs.get(k) ?? defaults.get(k),
        set: (k, v) => userPrefs.set(k, v),
        prefHasUserValue: (k) => userPrefs.has(k),
        clear: (k) => userPrefs.delete(k),
      },
      File: {
        pathToFile: (name) => ({
          isSymlink: () => fs.lstatSync(name).isSymbolicLink(),
          isDirectory: () => fs.lstatSync(name).isDirectory(),
          isFile: () => fs.lstatSync(name).isFile(),
        }),
      },
    },
    IOUtils: {
      exists: async (name) => fs.existsSync(name),
      getChildren: async (name) =>
        fs.readdirSync(name).map((child) => path.join(name, child)),
      remove: async (name, options) => {
        removed.push(name);
        fs.rmSync(name, { recursive: options?.recursive ?? false });
      },
    },
    PathUtils: { join: path.join, filename: path.basename },
    TextDecoder,
    SWSemantic: {
      version: SWSemantic.version,
      assets: SWSemantic.assets,
      _packageFile: async () =>
        new TextEncoder().encode(
          JSON.stringify({ files: { inference: keepHash } }),
        ),
    },
    swYield: async () => {},
  });
  vm.runInContext(migrationSource, context);
  return {
    api: context.SWMigration,
    context,
    data,
    root,
    models,
    current,
    retired,
    runtime,
    keepHash,
    oldHash,
    removed,
    userPrefs,
    write,
  };
}

test("obsolete preferences migrate title case before clearing retired controls and preserve current settings", (t) => {
  const { api, userPrefs } = files(t, {
    tagSpaceCase: "title",
    tagPreserveHyphens: false,
    recommendationMethod: "semantic",
    tagHashtag: true,
    maxRecommendations: 15,
    excludedTags: "Keep me",
  });
  api.preferences();
  api.preferences();
  assert.equal(userPrefs.get("similar-works.tagNameStyle"), "title");
  for (const name of [
    "tagSpaceCase",
    "tagPreserveHyphens",
    "recommendationMethod",
  ])
    assert.equal(userPrefs.has("similar-works." + name), false);
  assert.equal(userPrefs.get("similar-works.tagHashtag"), true);
  assert.equal(userPrefs.get("similar-works.maxRecommendations"), 15);
  assert.equal(userPrefs.get("similar-works.excludedTags"), "Keep me");
  userPrefs.set("similar-works.tagNameStyle", "sentence");
  userPrefs.set("similar-works.tagSpaceCase", "title");
  api.preferences();
  assert.equal(userPrefs.get("similar-works.tagNameStyle"), "sentence");
});

test("file cleanup retires only known model/runtime caches, retains Core ML and is repeatable", async (t) => {
  const h = files(t);
  await h.api.files(() => true);
  assert.equal(fs.existsSync(h.retired), false);
  assert.equal(fs.existsSync(path.join(h.runtime, h.oldHash)), false);
  assert.equal(
    fs.existsSync(path.join(h.current, "onnx-model.onnx.tmp")),
    false,
  );
  assert.equal(
    fs.existsSync(path.join(h.runtime, h.keepHash, "inference.tmp")),
    false,
  );
  for (const name of [
    path.join(h.current, "onnx-model.onnx"),
    path.join(h.current, "coreml-cache", "compiled.bin"),
    path.join(h.models, "unknown-model", "keep"),
    path.join(h.current, "research.tmp"),
    path.join(h.runtime, h.keepHash, "inference"),
    path.join(h.runtime, "unknown-directory", "keep"),
  ])
    assert.equal(fs.existsSync(name), true, name);
  const count = h.removed.length;
  await h.api.files(() => true);
  assert.equal(h.removed.length, count);
});

test("cleanup refuses symlinked cache trees and never follows retired-cache links", async (t) => {
  const h = files(t),
    outside = path.join(h.data, "outside");
  h.write(path.join(outside, "keep"));
  fs.rmSync(h.retired, { recursive: true });
  fs.symlinkSync(outside, h.retired, "junction");
  fs.rmSync(path.join(h.runtime, h.oldHash), { recursive: true });
  fs.symlinkSync(outside, path.join(h.runtime, h.oldHash), "junction");
  await h.api.files(() => true);
  assert.equal(fs.readFileSync(path.join(outside, "keep"), "utf8"), "preserve");
  assert.equal(fs.lstatSync(h.retired).isSymbolicLink(), true);
  fs.rmSync(h.models, { recursive: true });
  fs.symlinkSync(outside, h.models, "junction");
  h.api._files = null;
  await h.api.files(() => true);
  assert.equal(fs.readFileSync(path.join(outside, "keep"), "utf8"), "preserve");
});

test("cancelled cleanup leaves files alone and a failed removal retries safely", async (t) => {
  const h = files(t);
  await h.api.files(() => false);
  assert.equal(h.removed.length, 0);
  h.api._files = null;
  const remove = h.context.IOUtils.remove;
  let fail = true;
  h.context.IOUtils.remove = async (...args) => {
    if (fail) {
      fail = false;
      throw new Error("Busy cache file");
    }
    return remove(...args);
  };
  await assert.rejects(
    h.api.files(() => true),
    /cleanup failed/,
  );
  assert.equal(fs.existsSync(h.retired), true);
  await h.api.files(() => true);
  assert.equal(fs.existsSync(h.retired), false);
  assert.equal(
    fs.existsSync(path.join(h.current, "coreml-cache", "compiled.bin")),
    true,
  );
});

test("restart finishes interrupted file cleanup while current model and compiled cache survive", async (t) => {
  const h = files(t);
  let active = true;
  h.context.swYield = async () => {
    active = false;
  };
  await h.api.files(() => active);
  assert.equal(fs.existsSync(h.retired), false);
  assert.equal(fs.existsSync(path.join(h.runtime, h.oldHash)), true);
  assert.equal(
    fs.existsSync(path.join(h.current, "coreml-cache", "compiled.bin")),
    true,
  );
  vm.runInContext(migrationSource, h.context);
  h.context.swYield = async () => {};
  await h.context.SWMigration.files(() => true);
  assert.equal(fs.existsSync(path.join(h.runtime, h.oldHash)), false);
  assert.equal(fs.existsSync(path.join(h.current, "onnx-model.onnx")), true);
  assert.equal(
    fs.existsSync(path.join(h.current, "coreml-cache", "compiled.bin")),
    true,
  );
});
