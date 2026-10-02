const test = require("node:test");
const assert = require("node:assert/strict");
global.swPorterStem = require("../src/stemmer.js").swPorterStem;
global.SWTokenizer = { termFreq: require("../src/tokenizer.js").swTermFreq };
const { SWSearch } = require("../src/search.js");
global.SWSearch = SWSearch;
const { SWCorpus } = require("../src/corpus.js");
const noPause = async () => {};
const noCancel = () => false;

test("field counts preserve boundaries and reject truncated storage", async () => {
  const counts = await SWSearch.extract({
    title: "traffic",
    abstract: "learning",
    body: "radar radar",
  });
  const encoded = SWSearch.encodeCounts(counts);
  const decoded = SWSearch.decodeCounts(encoded);
  assert.deepEqual(decoded, counts);
  assert.equal(decoded.fields[0].get(SWSearch.hash("w:traffic")), 1);
  assert.equal(decoded.fields[2].get(SWSearch.hash("w:radar")), 2);
  assert.throws(() => SWSearch.decodeCounts(encoded.slice(0, -1)), /Truncated/);
  assert.deepEqual(
    SWSearch.decodeCounts(SWSearch.encodeCounts(new Map([[123, 2]]))),
    new Map([[123, 2]]),
  );
});

test("BM25F normalizes fields separately before term saturation", async () => {
  const index = new SWSearch.Index();
  index.epochN = 10;
  index.averageFieldLengths = [2, 8, 20];
  const counts = await SWSearch.extract({
    title: "traffic",
    body: "radar radar",
  });
  const vector = index.fingerprint(counts);
  const weights = new Map(vector);
  // Both terms have the same IDF, so it cancels from the normalized ratio.
  const titleTf = 4 / (0.7 + 0.3 / 2);
  // Body contains two unigrams and one bigram.
  const bodyTf = 2 / (0.25 + (0.75 * 3) / 20);
  const expected = titleTf / (titleTf + 1.2) / (bodyTf / (bodyTf + 1.2));
  const actual =
    weights.get(SWSearch.hash("w:traffic")) /
    weights.get(SWSearch.hash("w:radar"));
  assert.ok(Math.abs(actual - expected) < 0.0001);
});

test("epoch rebuild preserves field averages with lazy database counts", async () => {
  const index = new SWSearch.Index();
  const a = await SWSearch.extract({
    title: "traffic radar",
    abstract: "learning",
  });
  const b = await SWSearch.extract({ body: "traffic radar" });
  const stored = new Map([
    ["1/A", SWSearch.encodeCounts(a)],
    ["1/B", SWSearch.encodeCounts(b)],
  ]);
  index.add("1/A", a, true);
  index.add("1/B", b, true);
  for (const doc of index.docs.values()) doc.counts = null;
  await index.rebuild(noPause, noCancel, async (doc) => stored.get(doc.key));
  assert.deepEqual(index.averageFieldLengths, [1.5, 0.5, 1.5]);
  assert.ok(index.docs.get("1/A").vector.length > 0);
  const oldID = index.docs.get("1/A").id;
  index.remove("1/A", stored.get("1/A"));
  assert.equal(index.byID.has(oldID), false);
  assert.equal(index.df.get(SWSearch.hash("w:traffic")), 1);
});

test("restart after a partial migration rebuilds fingerprints from stored counts", async () => {
  const corpus = new SWCorpus();
  const counts = SWSearch.encodeCounts(new Map([[123, 4]]));
  let page = 0;
  corpus._db = {
    async execute(sql) {
      if (sql.startsWith("SELECT COUNT")) return [{ getResultByName: () => 1 }];
      if (sql.startsWith("SELECT d.key"))
        return page++
          ? []
          : [
              {
                getResultByName: (name) =>
                  ({
                    key: "1/A",
                    hash: "a",
                    weak: 1,
                    tf: "{}",
                    counts,
                    signature: null,
                    epoch: 0,
                    simhash: null,
                  })[name],
              },
            ];
      if (sql.startsWith("SELECT counts"))
        return [{ getResultByName: () => counts }];
      return [];
    },
  };
  corpus._persistFingerprints = async () => {};
  corpus._maintainEpoch = async () => {};
  await corpus._loadAll();
  assert.equal(corpus.progress.phase, "ready");
  assert.deepEqual([...corpus.search.docs.get("1/A").vector.ids], [123]);
});

test("binary counts and quantized signatures round-trip; feature cap is enforced", async () => {
  const counts = new Map(Array.from({ length: 800 }, (_, i) => [i, i + 1]));
  assert.deepEqual(
    SWSearch.decodeCounts(SWSearch.encodeCounts(counts)),
    counts,
  );
  const index = new SWSearch.Index();
  index.add("1/A", counts, true);
  await index.rebuild();
  const vector = index.docs.get("1/A").vector;
  assert.equal(vector.length, 256);
  assert.equal(SWSearch.encodeSignature(vector).length, 1536);
  assert.ok(Math.abs(SWSearch.cosine(vector, vector) - 1) < 1e-12);
  assert.throws(() => SWSearch.decodeSignature(new Uint8Array(7)));
});

test("cleaning, fields, English bigrams and CJK features", async () => {
  const title = await SWSearch.extract({ title: "traffic forecasting" });
  const body = await SWSearch.extract({ body: "traffic forecasting" });
  assert.equal(
    title.get(SWSearch.hash("w:traffic")),
    body.get(SWSearch.hash("w:traffic")) * 4,
  );
  assert.ok(body.has(SWSearch.hash("b:traffic forecast")));
  const cjk = await SWSearch.extract({ body: "交通拥堵预测" });
  assert.ok(cjk.has(SWSearch.hash("c:交通拥")));
  const text = "paper body ".repeat(40) + "\nReferences\nSmith 2020";
  assert.ok(!SWSearch.clean(text).includes("smith"));
});

test("Block-Max WAND preserves the exhaustive Top-300 threshold", async () => {
  const index = new SWSearch.Index();
  for (let i = 0; i < 700; i++) {
    const counts = new Map();
    for (let t = 0; t < 70; t++)
      if ((i * 17 + t * 11) % 9 < 3)
        counts.set(t, (((i + 3) * (t + 7)) % 23) + 1);
    index.add(`1/${i}`, counts, true);
  }
  await index.rebuild();
  const query = index.docs.get("1/0"),
    top = new SWSearch.Heap(48);
  for (const pair of query.vector) top.add(pair);
  const queryWeights = new Map(top.sorted());
  const exhaustive = [...index.docs.values()]
    .filter((d) => d !== query)
    .map((d) => [
      d.id,
      d.vector.reduce((s, [id, w]) => s + (queryWeights.get(id) || 0) * w, 0),
      d.key,
    ]);
  exhaustive.sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  const actual = await index.retrieve(query, () => true, noPause, noCancel);
  const scores = new Map(exhaustive.map((pair) => [pair[2], pair[1]]));
  const threshold = exhaustive
    .filter((pair) => pair[1] > 0)
    .slice(0, 300)
    .at(-1)[1];
  assert.equal(actual.length, 300);
  assert.equal(new Set(actual).size, 300);
  assert.ok(actual.every((key) => scores.get(key) + 1e-12 >= threshold));
  index.remove("1/7");
  assert.ok(
    !(await index.retrieve(query, () => true, noPause, noCancel)).includes(
      "1/7",
    ),
  );
  assert.deepEqual(await index.retrieve(query, null, noPause, () => true), []);
});

test("SimHash excludes duplicate full text but keeps identical short metadata", async () => {
  const index = new SWSearch.Index(),
    tf = new Map([
      [1, 90],
      [2, 30],
      [3, 20],
    ]);
  index.add("1/A", tf, false);
  index.add("1/B", tf, false);
  index.add("1/C", tf, true);
  await index.rebuild();
  assert.equal(
    SWSearch.distance(
      index.docs.get("1/A").simhash,
      index.docs.get("1/B").simhash,
    ),
    0,
  );
  const result = await index.search(
    "1/A",
    50,
    null,
    noCancel,
    noPause,
    () => {},
  );
  assert.deepEqual(
    result.map((m) => m.key),
    ["1/C"],
  );
});

test("reverse Top-K adds a new neighbor without invalidating an unrelated cache", async () => {
  const corpus = new SWCorpus();
  corpus.search.epoch = 1; // Freeze one model so this test exercises incremental cache updates.
  await corpus.upsertDoc(
    "1/A",
    "a",
    true,
    new Map([
      [1, 3],
      [2, 1],
    ]),
  );
  await corpus.upsertDoc(
    "1/B",
    "b",
    true,
    new Map([
      [1, 1],
      [3, 2],
    ]),
  );
  const original = await corpus.scoreTopKAsync("1/A", 50);
  await corpus.saveRecommendations("1/A", true, original, corpus.revision, "a");
  await corpus.upsertDoc(
    "1/C",
    "c",
    true,
    new Map([
      [1, 3],
      [2, 1],
    ]),
  );
  const cached = await corpus.getRecommendations("1/A", true);
  assert.equal(cached.matches[0].key, "1/C");
  assert.ok(corpus.recommendationsFresh(cached, "1/A"));
  await corpus.removeDoc("1/C");
  assert.ok(
    !(await corpus.getRecommendations("1/A", true)).matches.some(
      (m) => m.key === "1/C",
    ),
  );
  assert.ok(!corpus.recommendationsFresh(cached, "1/A"));
});

test("epoch rebuild aborts if foreground indexing changes feature statistics", async () => {
  const index = new SWSearch.Index();
  for (let i = 0; i < 8; i++)
    index.add(
      `1/${i}`,
      new Map([
        [i, 2],
        [9, 1],
      ]),
      true,
    );
  const oldEpoch = index.epoch;
  const rebuilt = await index.rebuild(async () => {
    index.add("1/new", new Map([[99, 4]]), true);
  });
  assert.equal(rebuilt, false);
  assert.equal(index.epoch, oldEpoch);
  assert.ok(index.docs.has("1/new"));
});

test("failed vector writes restore the in-memory index", async () => {
  const corpus = new SWCorpus();
  corpus.search.epoch = 1;
  await corpus.upsertDoc("1/A", "old", true, new Map([[1, 3]]));
  corpus._db = {
    executeTransaction: async () => {
      throw new Error("disk unavailable");
    },
  };
  await assert.rejects(
    corpus.upsertDoc("1/A", "new", true, new Map([[2, 4]])),
    /persist doc failed/,
  );
  assert.equal(corpus.docs.get("1/A").hash, "old");
  assert.ok(corpus.search.docs.get("1/A").vector.ids.includes(1));
  assert.ok(!corpus.search.docs.get("1/A").vector.ids.includes(2));
});

test("results computed before an IDF epoch switch cannot be cached as new", async () => {
  const corpus = new SWCorpus();
  corpus.search.epoch = 1;
  await corpus.upsertDoc("1/A", "a", true, new Map([[1, 3]]));
  corpus.search.epoch = 2;
  await corpus.saveRecommendations("1/A", true, [], corpus.revision, "a", 1);
  assert.equal(await corpus.getRecommendations("1/A", true), null);
});

test("stored fingerprints bind BLOBs without being interpreted as batch parameters", async () => {
  const corpus = new SWCorpus();
  corpus.search.epoch = 3;
  const doc = { key: "1/A", vector: [[1148, 1]], counts: null };
  let persisted;
  corpus._db = {
    async execute(sql, params) {
      // Gecko's Sqlite.sys.mjs interprets an object in position zero as a batch.
      assert.notEqual(typeof params[0], "object");
      assert.match(sql, /signature = \?2, epoch = \?3 WHERE key = \?1/);
      assert.equal(params[0], doc.key);
      assert.ok(params[1] instanceof Uint8Array);
      assert.equal(params[2], 3);
      persisted = SWSearch.decodeSignature(params[1]);
    },
  };
  await corpus._writeFingerprint(doc);
  assert.deepEqual([...persisted], doc.vector);
});

test("close waits for an in-progress open and transaction, then closes only once", async () => {
  const corpus = new SWCorpus();
  let finishOpen, finishTransaction;
  let closes = 0,
    removals = 0;
  corpus._ready = new Promise((r) => {
    finishOpen = r;
  });
  corpus._taskDrain = new Promise((r) => {
    finishTransaction = r;
  });
  corpus._shutdownClient = { removeBlocker: () => removals++ };
  const first = corpus.close();
  assert.equal(corpus._stopped, true);
  assert.equal(corpus.close(), first);
  corpus._db = {
    close: async () => {
      closes++;
    },
  };
  finishOpen();
  await new Promise((r) => setImmediate(r));
  assert.equal(closes, 0);
  finishTransaction();
  await first;
  assert.equal(closes, 1);
  assert.equal(removals, 1);
  assert.equal(corpus._db, null);
});
