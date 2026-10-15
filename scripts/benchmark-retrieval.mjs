// Use the production lexical scorer and chunking on a private corpus snapshot.
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import process from "node:process";
import { setImmediate } from "node:timers/promises";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
globalThis.swPorterStem = require("../src/stemmer.js").swPorterStem;
const tokenizer = require("../src/tokenizer.js");
globalThis.SWTokenizer = { isStopword: tokenizer.swIsStopword };
const { SWSearch } = require("../src/search.js");
globalThis.SWSearch = SWSearch;
globalThis.swYield = () => setImmediate();
const { SWSemantic } = require("../src/semantic.js");
const root = process.argv[2] || "build/retrieval-benchmark";
const read = async (name) =>
  JSON.parse(await readFile(`${root}/${name}`, "utf8"));
const docs = await read("corpus.json");
const queries = await read("queries.json");
const index = new SWSearch.Index();
const started = performance.now();
const chunks = {};
for (const doc of docs) {
  const counts = await SWSearch.extract(doc);
  index.add(doc.id, counts, true);
  chunks[doc.id] = SWSemantic.chunks(doc.title, doc.abstract, "");
}
await index.rebuild();
const indexMs = performance.now() - started;
const rankings = { lexical: {} };
for (const query of queries)
  rankings.lexical[query.id] = await index.search(
    query.id,
    100,
    null,
    () => false,
    async () => {},
    () => {},
  );
const times = [];
for (let round = 0; round < 6; round++)
  for (const query of queries) {
    const start = performance.now();
    await index.search(
      query.id,
      10,
      null,
      () => false,
      setImmediate,
      () => {},
    );
    if (round) times.push(performance.now() - start);
  }
times.sort((a, b) => a - b);
await writeFile(`${root}/chunks.json`, JSON.stringify(chunks));
await writeFile(
  `${root}/lexical.json`,
  JSON.stringify({
    rankings,
    indexMs,
    queries: times.length,
    queryP50Ms: times[Math.floor(times.length * 0.5)],
    queryP95Ms: times[Math.floor(times.length * 0.95)],
    note: "Production scorer, title/abstract only; no cached PDF body.",
  }),
);
console.log(JSON.stringify({ papers: docs.length, indexMs }));

// After encoding, verify and time the shipped JavaScript hybrid implementation.
if (process.argv.includes("--verify")) {
  const bytes = await readFile(`${root}/minilm.npy`);
  const headerSize = bytes[6] === 1 ? 8 : 12;
  const headerLength =
    bytes[6] === 1 ? bytes.readUInt16LE(8) : bytes.readUInt32LE(8);
  const offset = (bytes[6] === 1 ? 10 : headerSize) + headerLength;
  const vectors = new Float32Array(
    bytes.buffer.slice(
      bytes.byteOffset + offset,
      bytes.byteOffset + bytes.length,
    ),
  );
  assert.equal(vectors.length, docs.length * 384);
  SWSemantic.corpus = {
    docs: new Map(
      docs.map((doc) => [doc.id, { hash: "benchmark", weak: true }]),
    ),
    search: index,
    revision: 1,
    runTask: async (work) => work(),
  };
  docs.forEach((doc, i) =>
    SWSemantic.vectors.set(doc.id, {
      hash: "benchmark",
      vector: vectors.subarray(i * 384, (i + 1) * 384),
    }),
  );
  const expected = (await read("rankings.json"))["minilm-rrf"];
  const excluded = new Set(Object.keys(await read("ranking-exclusions.json")));
  const timings = { dense: [], hybrid: [] };
  for (let round = 0; round < 6; round++)
    for (const query of queries) {
      const filter = (key) => !excluded.has(key);
      let start = performance.now();
      await SWSemantic.search(query.id, 100, filter);
      if (round) timings.dense.push(performance.now() - start);
      start = performance.now();
      const result = await SWSemantic.recommend(query.id, 50, filter);
      if (round) timings.hybrid.push(performance.now() - start);
      assert.deepEqual(
        result.matches.slice(0, 10).map((match) => match.key),
        expected[query.id].slice(0, 10).map((match) => match.key),
        `Production/benchmark ranking mismatch: ${query.id}`,
      );
    }
  const measured = {};
  for (const [name, samples] of Object.entries(timings)) {
    samples.sort((a, b) => a - b);
    measured[name] = {
      p50Ms: samples[Math.floor(samples.length * 0.5)],
      p95Ms: samples[Math.floor(samples.length * 0.95)],
      queries: samples.length,
    };
  }
  await writeFile(
    `${root}/production-timing.json`,
    JSON.stringify(
      { measured, rankingParity: "24/24 Top-10 identical" },
      null,
      2,
    ),
  );
  console.log(JSON.stringify(measured));
}
