const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const { SWSearch } = require("../src/search.js");
function fixture() {
  const writes = [];
  const context = vm.createContext({
    SWSearch,
    SWPref: (_key, fallback) => fallback,
    SWIndexer: { _reportStatus() {} },
    SWSection: { _active: [], refreshSemantic() {} },
    Zotero: { logError() {}, isMac: true, Items: {} },
    swYield: async () => {},
    setTimeout,
    clearTimeout,
    TextEncoder,
    TextDecoder,
    Float32Array,
    Uint8Array,
    DataView,
  });
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, "../src/semantic.js"), "utf8"),
    context,
  );
  const semantic = context.SWSemantic;
  semantic.corpus = {
    docs: new Map(),
    progress: { phase: "ready" },
    ready: Promise.resolve(),
    runTask: async (work) => work(),
    _db: {
      execute: async (...args) => {
        writes.push(args);
        return [];
      },
    },
  };
  function put(key, hash, values, weak = false) {
    const vector = new Float32Array(384);
    vector.set(values);
    semantic.corpus.docs.set(key, { hash, weak });
    semantic.vectors.set(key, { hash, vector: semantic.pool([vector], [1]) });
  }
  return { context, semantic, put, writes };
}
test("dense vectors preserve signed values, normalize and reject corruption", () => {
  const { semantic } = fixture();
  const values = new Float32Array(384);
  values[0] = -3;
  values[1] = 4;
  const vector = semantic.pool([values], [3]);
  assert.ok(Math.abs(vector[0] + 0.6) < 1e-6);
  assert.ok(Math.abs(vector[1] - 0.8) < 1e-6);
  assert.deepEqual(semantic.decode(semantic.encode(vector)), vector);
  assert.throws(() => semantic.decode(new Uint8Array(7)), /Invalid/);
  values[0] = NaN;
  assert.throws(() => semantic.pool([values], [1]), /Invalid/);
});
test("semantic Top-K uses valid same-library vectors and respects cancellation", async () => {
  const { semantic, put } = fixture();
  put("1/Q", "q", [1, 0]);
  put("1/A", "a", [0.8, 0.6]);
  put("1/B", "b", [0.1, 0.99]);
  put("2/A", "a", [1, 0]);
  put("1/stale", "old", [1, 0]);
  semantic.corpus.docs.get("1/stale").hash = "new";
  const result = await semantic.search("1/Q", 1, (key) => key.startsWith("1/"));
  assert.equal(result.length, 1);
  assert.equal(result[0].key, "1/A");
  assert.equal((await semantic.search("1/Q", 20, null, () => true)).length, 0);
  semantic.corpus.docs.get("1/Q").hash = "updated";
  assert.equal(await semantic.search("1/Q", 20, null), null);
});
test("source changes invalidate a vector and foreground requests move ahead", () => {
  const { semantic, put } = fixture();
  semantic._enabled = true;
  semantic._running = Promise.resolve();
  put("1/A", "old", [1]);
  semantic.corpus.docs.get("1/A").hash = "new";
  semantic.enqueue("1/A");
  semantic.corpus.docs.set("1/B", { hash: "b" });
  semantic.enqueue("1/B", true);
  assert.equal(semantic.vectors.has("1/A"), false);
  assert.deepEqual(Array.from(semantic._queue), ["1/B", "1/A"]);
});
test("switching away and quitting terminate inference and abort downloads", async () => {
  const { semantic } = fixture();
  let terminated = 0,
    aborted = 0;
  semantic._worker = {
    postMessage() {},
    terminate() {
      terminated++;
    },
  };
  semantic._downloads.set("model", {
    abort() {
      aborted++;
    },
  });
  const pending = semantic._request("encode", { texts: ["hashing"] });
  const rejected = assert.rejects(pending, /paused/);
  semantic.stop();
  await rejected;
  assert.equal(terminated, 1);
  assert.equal(aborted, 1);
  assert.equal(semantic._pending.size, 0);
  assert.equal(semantic._queue.length, 0);
  assert.equal(semantic.status.state, "stopped");
});
test("a source changing during inference never persists an obsolete embedding", async () => {
  const { semantic, context, writes } = fixture();
  semantic._enabled = true;
  semantic.corpus.docs.set("1/A", { hash: "old" });
  context.Zotero.Items.getByLibraryAndKeyAsync = async () => ({
    deleted: false,
    getField: () => "Hashing",
  });
  semantic._init = async () => {};
  semantic._request = async () => {
    semantic.corpus.docs.set("1/A", { hash: "new" });
    const vector = new Float32Array(384);
    vector[0] = 1;
    return { vectors: [vector] };
  };
  await semantic._build("1/A");
  assert.equal(writes.length, 0);
  assert.equal(semantic.vectors.size, 0);
});
test("input chunking stays bounded and removes reference sections", () => {
  const { semantic } = fixture();
  const chunks = semantic.chunks(
    "Spectral hashing",
    "",
    "binary codes ".repeat(10000) + "\nReferences\nSmith 2008",
  );
  assert.ok(chunks.length <= 4);
  assert.ok(chunks[0].includes("spectral hashing"));
  assert.ok(chunks.every((s) => s.length <= 1800 && !s.includes("Smith")));
});

test("model cache deduplicates loads and verifies downloaded bytes", async () => {
  const { semantic, context } = fixture();
  const crypto = require("node:crypto");
  context.Zotero.getMainWindow = () => ({ crypto: crypto.webcrypto });
  const bytes = new TextEncoder().encode("model contents");
  semantic.assets["test"] = crypto
    .createHash("sha256")
    .update(bytes)
    .digest("hex");
  await semantic._validateAsset("test", bytes);
  await assert.rejects(
    semantic._validateAsset("test", new Uint8Array([1])),
    /checksum/,
  );
  let loads = 0;
  semantic._readModelFile = async () => {
    loads++;
    return bytes;
  };
  const [a, b] = await Promise.all([
    semantic._modelFile("test"),
    semantic._modelFile("test"),
  ]);
  assert.equal(loads, 1);
  assert.deepEqual(a, b);
});

test("rapid method switches do not let an old worker failure poison the new queue", async () => {
  const { semantic, context } = fixture();
  semantic._enabled = true;
  semantic._queue = ["1/A"];
  semantic._rest = async () => {};
  let fail;
  semantic._build = () =>
    new Promise((_resolve, reject) => {
      fail = reject;
    });
  const running = semantic._drain();
  await new Promise((resolve) => setImmediate(resolve));
  semantic.pause();
  semantic._enabled = true;
  semantic.status.state = "waiting";
  context.SWSection.refreshSemantic = () => {};
  fail(new Error("Old worker cancelled"));
  await running;
  assert.equal(semantic.status.state, "waiting");
  assert.equal(semantic.status.error, null);
});
