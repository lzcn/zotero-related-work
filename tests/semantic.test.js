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
test("native SQLite byte arrays and unaligned views retain cached embeddings", async () => {
  const { semantic } = fixture();
  const vector = new Float32Array(384);
  vector[0] = -0.6;
  vector[1] = 0.8;
  const bytes = semantic.encode(vector);
  const nativeBytes = Array.from(bytes);
  assert.deepEqual(semantic.decode(nativeBytes), semantic.decode(bytes));
  const unaligned = new Uint8Array(bytes.length + 1);
  unaligned.set(bytes, 1);
  assert.deepEqual(
    semantic.decode(unaligned.subarray(1)),
    semantic.decode(bytes),
  );
  semantic.corpus.docs.set("1/A", { hash: "unchanged" });
  semantic.corpus._db.execute = async () => [
    {
      getResultByName: (name) =>
        ({ key: "1/A", sourceHash: "unchanged", vector: nativeBytes })[name],
    },
  ];
  await semantic.start(semantic.corpus);
  assert.equal(semantic.status.indexedItems, 1);
  semantic.enable();
  assert.equal(semantic._queue.length, 0);
  assert.equal(semantic._running, null);
  assert.equal((await semantic.search("1/A", 20)).length, 0);
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

test("semantic Top-K cache updates incrementally and invalidates on removal", () => {
  const { semantic, put } = fixture();
  put("1/Q", "q", [1, 0]);
  put("1/A", "a", [1, 0]);
  semantic.saveRecommendations("1/Q", true, [
    { key: "1/A", score: 1, weak: false },
  ]);
  const cached = semantic.getRecommendations("1/Q", true);
  assert.ok(cached);
  assert.ok(semantic.recommendationsFresh(cached, "1/Q"));
  // A newly built vector is inserted without rescanning the whole corpus.
  put("1/B", "b", [0.8, 0.6]);
  semantic._applyVectorChange("1/B");
  assert.deepEqual(
    cached.matches.map((m) => m.key),
    ["1/A", "1/B"],
  );
  // Deleting a present match frees a slot that cannot be refilled in place.
  semantic.forget("1/A");
  assert.ok(!cached.matches.some((m) => m.key === "1/A"));
  assert.equal(cached.dirty, true);
  assert.ok(!semantic.recommendationsFresh(cached, "1/Q"));
  // A changed query vector drops its own cached ranking.
  semantic._applyVectorChange("1/Q");
  assert.equal(semantic.getRecommendations("1/Q", true), null);
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

test("foreground selection interrupts background delay and runs before queued work", async () => {
  const { context, semantic } = fixture();
  semantic._enabled = true;
  semantic.corpus.docs.set("1/B", { hash: "background" });
  semantic.corpus.docs.set("1/Q", { hash: "selected" });
  let resume;
  let waits = 0;
  context.swYield = () => {
    waits++;
    return new Promise((resolve) => {
      resume = resolve;
    });
  };
  const built = [];
  semantic._build = async (key) => {
    built.push(key);
    if (key === "1/B") semantic.pause();
  };
  semantic.enqueue("1/B");
  assert.equal(waits, 1);
  semantic.enqueue("1/Q", true);
  resume();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(built, ["1/Q"]);
  assert.equal(waits, 2);
  semantic.enqueue("1/B", true);
  resume();
  await semantic._running;
  assert.deepEqual(built, ["1/Q", "1/B"]);
  assert.equal(waits, 2);
  assert.equal(semantic._priority.size, 0);
});

test("a foreground request skips startup delay", async () => {
  const { context, semantic } = fixture();
  semantic._enabled = true;
  semantic.corpus.docs.set("1/Q", { hash: "selected" });
  let waits = 0;
  context.swYield = async () => {
    waits++;
  };
  semantic._build = async () => semantic.pause();
  semantic.enqueue("1/Q", true);
  await semantic._running;
  assert.equal(waits, 0);
});

test("tag-name inference reuses the paper vector and cached tags, serializes with document encoding, and cancels stale results", async () => {
  const { semantic, context, put } = fixture();
  context.SWIndexer.docKey = () => "1/A";
  put("1/A", "one", [1, 0]);
  semantic._worker = {};
  semantic._enabled = true;
  let running = 0,
    peak = 0,
    requests = 0;
  semantic._request = async (_type, { texts }) => {
    running++;
    peak = Math.max(peak, running);
    requests++;
    await new Promise((resolve) => setImmediate(resolve));
    running--;
    return {
      vectors: texts.map((text) => {
        const v = Array(384).fill(0);
        v[text === "Relevant" ? 0 : 1] = 1;
        return v;
      }),
    };
  };
  const [scores] = await Promise.all([
    semantic.tagSimilarity({}, ["Relevant", "Other"]),
    semantic._encode(["Document"]),
  ]);
  assert.deepEqual(Array.from(scores), [1, 0]);
  assert.equal(peak, 1);
  assert.equal(requests, 2);
  await semantic.tagSimilarity({}, ["Relevant", "Other"]);
  assert.equal(requests, 2, "tag names should not be encoded again");
  assert.equal(
    await semantic.tagSimilarity({}, ["Missing"], () => false),
    null,
  );
  semantic._request = async (_type, { texts }) => {
    semantic.corpus.docs.get("1/A").hash = "changed";
    return { vectors: texts.map(() => Array(384).fill(0)) };
  };
  assert.equal(await semantic.tagSimilarity({}, ["New"]), null);
});

test("background inference waits for host idle time and foreground selection releases that wait", async () => {
  const { semantic, context } = fixture();
  let idleCallback,
    cancelled = 0;
  context.Zotero.getMainWindow = () => ({
    requestIdleCallback(callback) {
      idleCallback = callback;
      return 7;
    },
    cancelIdleCallback(id) {
      assert.equal(id, 7);
      cancelled++;
    },
  });
  let done = false;
  const idle = semantic._idle().then(() => {
    done = true;
  });
  await Promise.resolve();
  assert.equal(done, false);
  semantic._enabled = true;
  semantic._running = Promise.resolve();
  semantic.corpus.docs.set("1/FOREGROUND", { hash: "selected" });
  semantic.enqueue("1/FOREGROUND", true);
  await idle;
  assert.equal(done, true);
  assert.equal(cancelled, 1);
  assert.equal(semantic._idleWait, null);
  const shutdownIdle = semantic._idle();
  semantic.pause();
  await shutdownIdle;
  assert.equal(cancelled, 2);
  assert.equal(semantic._idleWait, null);
  assert.ok(idleCallback);
});

test("worker microbatches similar lengths and transfers normalized vectors in input order", async () => {
  const source = fs
    .readFileSync(path.join(__dirname, "../ml/worker.js"), "utf8")
    .replace('import { env, pipeline } from "@huggingface/transformers";', "");
  const messages = [],
    batches = [];
  const context = vm.createContext({
    env: { backends: { onnx: { wasm: {} } } },
    Response: globalThis.Response,
    Float32Array,
    pipeline: async () => async (texts) => {
      batches.push(texts);
      const data = new Float32Array(texts.length * 384);
      texts.forEach((text, index) => {
        data[index * 384 + Number(text[0])] = 1;
      });
      return { data, dims: [texts.length, 384] };
    },
    self: {
      setTimeout(callback) {
        callback();
      },
      postMessage(message, transfer) {
        messages.push({ message, transfer });
      },
    },
  });
  vm.runInContext(source, context);
  await context.self.onmessage({
    data: { type: "init", id: 1, runtime: "local/", model: "fixture" },
  });
  const texts = ["1" + "a".repeat(100), "2tiny", "3" + "b".repeat(110)];
  await context.self.onmessage({ data: { type: "encode", id: 2, texts } });
  const result = messages.at(-1);
  assert.deepEqual(
    batches.map((batch) => batch.length),
    [1, 2],
  );
  assert.equal(result.message.vectors.length, 3);
  assert.equal(result.transfer.length, 3);
  result.message.vectors.forEach((vector, index) => {
    assert.equal(vector[index + 1], 1);
    assert.equal(vector.length, 384);
  });
});
