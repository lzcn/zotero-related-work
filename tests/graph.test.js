const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
global.SWSearch = require("../src/search.js").SWSearch;
const { swGraphNeighborhood } = require("../src/graph-similarity.js");
const { SWSearch } = global;

test("text neighborhood scores match recommendations and remain deterministic", async () => {
  const index = new SWSearch.Index();
  for (const [key, words] of [
    ["1/A", { radar: 1, motion: 1 }],
    ["1/B", { radar: 1 }],
    ["1/C", { motion: 1 }],
  ])
    index.add(key, new Map(Object.entries(words)), false);
  const documents = [...index.docs.values()];
  const graph = await swGraphNeighborhood(documents, "text", "1/A");
  assert.equal(graph.edges.length, 2);
  for (const edge of graph.edges)
    assert.equal(
      edge.score,
      index.similarity(
        index.docs.get(edge.source),
        index.docs.get(edge.target),
      ),
    );
  assert.deepEqual(
    await swGraphNeighborhood(documents.reverse(), "text", "1/A"),
    graph,
  );
});

test("two-hop expansion excludes third-hop and disconnected papers", async () => {
  const docs = [0, 60, 120, 180].map((angle, i) => ({
    key: "1/" + "ABCD"[i],
    vector: new Float32Array([
      Math.cos((angle * Math.PI) / 180),
      Math.sin((angle * Math.PI) / 180),
    ]),
  }));
  docs.push({ key: "1/isolated", vector: new Float32Array([0, 0]) });
  const graph = await swGraphNeighborhood(docs, "semantic", "1/A");
  assert.deepEqual(graph.ids, ["1/A", "1/B", "1/C"]);
  assert.deepEqual(
    graph.edges.map(({ source, target }) => [source, target]),
    [
      ["1/A", "1/B"],
      ["1/B", "1/C"],
    ],
  );
  assert.ok(Math.abs(graph.edges[0].score - 0.5) < 1e-6);
  const reverse = await swGraphNeighborhood(docs, "semantic", "1/D");
  assert.deepEqual(reverse.ids, ["1/D", "1/C", "1/B"]);
});

test("large libraries compare only center and first-hop neighborhoods", async () => {
  const docs = Array.from({ length: 500 }, (_, i) => ({
    key: "1/" + String(i).padStart(4, "0"),
    vector: new Float32Array([1]),
  }));
  const graph = await swGraphNeighborhood(docs, "semantic", docs[0].key);
  assert.equal(graph.ids.length, 11);
  assert.ok(graph.comparisons <= 11 * (docs.length - 1) + 55);
  assert.ok(graph.comparisons < (docs.length * (docs.length - 1)) / 2);
  assert.equal(
    new Set(graph.edges.map(({ source, target }) => source + "/" + target))
      .size,
    graph.edges.length,
  );
  assert.ok(
    graph.edges.every(
      ({ source, target, score }) => source !== target && score === 1,
    ),
  );
});

test("missing center index keeps an isolated center rather than showing a global graph", async () => {
  assert.deepEqual(await swGraphNeighborhood([], "semantic", "1/center"), {
    ids: ["1/center"],
    edges: [],
    hasIndex: false,
    comparisons: 0,
  });
});

test("cancelled comparisons return no partial neighborhood, including after yielding", async () => {
  const docs = Array.from({ length: 80 }, (_, i) => ({
    key: String(i),
    vector: new Float32Array([1]),
  }));
  assert.equal(
    await swGraphNeighborhood(docs, "semantic", "0", () => false),
    null,
  );
  let active = true;
  const context = vm.createContext({
    Date: {
      now: (() => {
        let time = 0;
        return () => (time += 10);
      })(),
    },
    module: { exports: {} },
  });
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, "../src/graph-similarity.js"), "utf8"),
    context,
  );
  assert.equal(
    await context.module.exports.swGraphNeighborhood(
      docs,
      "semantic",
      "0",
      () => active,
      () => {},
      async () => {
        active = false;
      },
    ),
    null,
  );
});

function fixture() {
  const preferences = new Map(),
    reads = [];
  const items = [1, 2, 3, 4, 5, 6].map((id) => ({
    id,
    libraryID: id === 4 ? 2 : 1,
    deleted: id === 3,
    key: String(id),
    isFeedItem: id === 5,
    isRegularItem: () => id !== 6,
    getField: (field) =>
      field === "date" ? (id === 1 ? "2008" : id === 2 ? "2026" : "") : "Paper",
    getDisplayTitle: () => "Paper",
    getTags: () => [{ tag: "Radar" }],
  }));
  const corpus = {
    ready: Promise.resolve(),
    progress: { phase: "ready" },
    docs: new Map([
      ["1/1", { hash: "current", weak: false }],
      ["1/2", { hash: "weak", weak: true }],
      ["1/3", { hash: "trash", weak: false }],
      ["2/4", { hash: "other", weak: false }],
    ]),
    search: new SWSearch.Index(),
  };
  for (const key of corpus.docs.keys())
    corpus.search.add(key, new Map([["radar", 1]]), key === "1/2");
  const semantic = {
    vectors: new Map([
      ["1/1", { hash: "old", vector: new Float32Array([1]) }],
      ["1/2", { hash: "weak", vector: new Float32Array([1]) }],
    ]),
    start: async () => {},
  };
  const context = vm.createContext({
    Zotero: {
      DB: { columnQueryAsync: async () => ["1", "2", "5", "6"] },
      Items: {
        getByLibraryAndKeyAsync: async (lib, key) => {
          reads.push(key);
          return items.find(
            (item) => item.libraryID === lib && item.key === key,
          );
        },
      },
    },
    SWIndexer: { corpus, docKey: (item) => item.libraryID + "/" + item.key },
    SWSemantic: semantic,
    SWPref: (name, fallback) => preferences.get(name) ?? fallback,
  });
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, "../src/graph.js"), "utf8"),
    context,
  );
  return {
    api: context.SWGraph,
    color: context.swGraphYearColor,
    corpus,
    preferences,
    host: context.Zotero,
    reads,
  };
}

test("snapshots avoid native metadata reads, filter Trash and libraries, and clone fingerprints", async () => {
  const { api, corpus, reads } = fixture();
  const snapshot = await api.snapshot(1, "1/1");
  assert.deepEqual(
    Array.from(snapshot.documents, (doc) => doc.key),
    ["1/1", "1/2"],
  );
  assert.equal(reads.length, 0);
  corpus.search.docs.get("1/1").vector.weights[0] = 0;
  assert.equal(snapshot.documents[0].vector.weights[0], 1);
  assert.equal(await api.snapshot(1, "1/1", () => false), null);
  await assert.rejects(api.snapshot(1, "2/4"), /unavailable/);
});

test("only visible valid papers load metadata; colors reflect publication age, not tags", async () => {
  const { api, color, reads } = fixture();
  const nodes = await api.describe(1, [
    "1/1",
    "1/2",
    "1/3",
    "2/4",
    "1/5",
    "1/6",
  ]);
  assert.deepEqual(
    Array.from(nodes, (node) => node.id),
    ["1/1", "1/2"],
  );
  assert.equal(reads.length, 5);
  assert.equal(nodes[0].year, 2008);
  assert.equal(nodes[1].year, 2026);
  assert.notEqual(nodes[0].color, nodes[1].color);
  assert.equal(color(2026, 2026), "hsl(215 70% 42.0%)");
  assert.equal(color(null, 2026), "#9aa0a6");
  assert.equal(color(2027, 2026), color(2026, 2026));
  assert.ok(parseFloat(color(2008, 2026).split("70% ")[1]) > 42);
});

test("semantic snapshots reject stale vectors and honor metadata eligibility", async () => {
  const { api, preferences, host } = fixture();
  host.isMac = true;
  const snapshot = await api.snapshot(1, "1/1");
  assert.equal(snapshot.documents.length, 1);
  assert.equal(snapshot.documents[0].key, "1/2");
  assert.equal(snapshot.documents[0].fieldVectors, undefined);
  preferences.set("allowMetadataOnlyRecommendations", false);
  assert.equal((await api.snapshot(1, "1/1")).documents.length, 0);
  api.stop();
  assert.equal(await api.snapshot(1, "1/1"), null);
});

test("unfinished graph is unavailable even through its direct opening API", () => {
  const { api } = fixture();
  let opened = 0;
  const win = {
    openDialog: () => {
      opened++;
    },
  };
  assert.equal(api.enabled, false);
  assert.equal(api.open(win, 1, "1/1"), null);
  assert.equal(opened, 0);
  assert.equal(api._dialogs.size, 0);
  assert.equal(api._subscriptions.size, 0);
});
