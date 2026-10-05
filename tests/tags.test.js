const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");

function fixture() {
  const tags = new Map([
    ["Deep Learning", [1, 2]],
    ["deep-learning", [2, 3]],
    ["Other", [4]],
  ]);
  const writes = [];
  const item = {
    id: 1,
    libraryID: 1,
    deleted: false,
    names: ["Original"],
    getTags() {
      return this.names.map((tag) => ({ tag }));
    },
    isEditable: () => true,
    hasTag(name) {
      return this.names.includes(name);
    },
    addTag(name) {
      this.names.push(name);
      return true;
    },
    async save() {
      writes.push("save");
    },
    async reload() {
      this.names = ["Original"];
    },
  };
  const context = vm.createContext({
    Zotero: {
      Promise: { delay: async () => {} },
      Libraries: { get: () => ({ editable: true }) },
      Items: { getAsync: async () => item },
      Tags: {
        getAll: async () => [...tags.keys()].map((tag) => ({ tag })),
        getID: (name) => name,
        getTagItems: async (_lib, name) => tags.get(name) || [],
        getColors: () => new Map(),
        getColor: () => ({ color: "#123456", position: 0 }),
        setColor: async (...args) => writes.push(args),
        rename: async (library, from, to) => {
          writes.push([library, from, to]);
          tags.set(to, [
            ...new Set([...(tags.get(to) || []), ...tags.get(from)]),
          ]);
          tags.delete(from);
        },
      },
      DB: { executeTransaction: async (work) => work() },
    },
  });
  for (const file of ["stemmer.js", "tokenizer.js", "tags.js"])
    vm.runInContext(
      fs.readFileSync(path.join(__dirname, "../src/" + file), "utf8"),
      context,
    );
  const catalog = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../data/tag-terms.json"), "utf8"),
  );
  context.SWTags._terms = new Map(Object.entries(catalog.terms));
  context.SWTags._termLength = Math.max(
    ...Object.keys(catalog.terms).map((key) => key.split(" ").length),
  );
  return { api: context.SWTags, context, item, tags, writes };
}

test("tag recommendations weight same-library neighbors, exclude current tags and deduplicate variants per paper", () => {
  const { api, item } = fixture();
  item.names = ["machine-learning"];
  const neighbor = (id, score, names, libraryID = 1) => ({
    score,
    item: { id, libraryID, getTags: () => names.map((tag) => ({ tag })) },
  });
  const result = api.recommend(item, [
    neighbor(2, 0.9, ["Machine Learning", "Deep Learning", "deep-learning"]),
    neighbor(2, 0.9, ["Deep Learning"]),
    neighbor(3, 0.6, ["Deep Learning", "Vision"]),
    neighbor(4, 0.5, ["Vision"]),
    neighbor(5, 1, ["Foreign"], 2),
    neighbor(1, 1, ["Self"]),
  ]);
  assert.deepEqual(
    Array.from(result, (tag) => [tag.name, tag.count]),
    [
      ["Deep Learning", 2],
      ["Vision", 2],
    ],
  );
});

test("duplicate grouping keeps punctuation that distinguishes C++, C# and C", () => {
  const { api } = fixture();
  const groups = api.duplicateGroups([
    "Deep Learning",
    "deep-learning",
    "deep_learning",
    "C++",
    "C#",
    "C",
    "ＡＩ",
    "AI",
  ]);
  assert.deepEqual(
    Array.from(groups, (group) => Array.from(group)),
    [
      ["Deep Learning", "deep-learning", "deep_learning"],
      ["ＡＩ", "AI"],
    ],
  );
});

test("possible duplicates include plural, reordered, dictionary and near-spelling candidates without merging tags", () => {
  const { api, writes } = fixture();
  const groups = api.duplicateGroups([
    "Graph neural network",
    "Neural networks graph",
    "graphneuralnetwork",
    "Representation learning",
    "Representaton learning",
    "GPT-2",
    "GPT-3",
    "C++",
    "C#",
    "Graph classification",
    "Image retrieval",
    "bert-generation",
    "Bert Generation",
  ]);
  assert.deepEqual(
    Array.from(groups, (group) => Array.from(group)),
    [
      ["Graph neural network", "Neural networks graph", "graphneuralnetwork"],
      ["Representation learning", "Representaton learning"],
      ["bert-generation", "Bert Generation"],
    ],
  );
  assert.deepEqual(writes, []);
});

test("adding tags uses current native tags and refuses obsolete names or selection", async () => {
  const { api, item, writes } = fixture();
  assert.equal(
    await api.addSelected(1, 1, ["Deep Learning", "Deep Learning"]),
    1,
  );
  assert.deepEqual(item.names, ["Original", "Deep Learning"]);
  await assert.rejects(api.addSelected(1, 1, ["Missing"]), /changed/);
  await assert.rejects(
    api.addSelected(1, 1, ["Other"], () => false),
    /cancelled/,
  );
  assert.deepEqual(writes, ["save"]);
});

test("cancelled item save reloads native state instead of leaving unsaved tags", async () => {
  const { api, item } = fixture();
  let active = true;
  item.save = async () => {
    active = false;
  };
  await assert.rejects(
    api.addSelected(1, 1, ["Deep Learning"], () => active),
    /cancelled/,
  );
  assert.deepEqual(item.names, ["Original"]);
});

test("merge previews distinct items, keeps the existing target and uses library-scoped native rename", async () => {
  const { api, tags, writes } = fixture();
  assert.equal(await api.preview(1, ["Deep Learning", "deep-learning"]), 3);
  assert.equal(
    await api.merge(1, ["Deep Learning", "deep-learning"], "Deep Learning"),
    1,
  );
  assert.deepEqual(tags.get("Deep Learning"), [1, 2, 3]);
  assert.equal(tags.has("deep-learning"), false);
  assert.deepEqual(writes, [
    [1, "deep-learning", "Deep Learning"],
    [1, "Deep Learning", "#123456", 0],
  ]);
});

test("read-only and changed tags cannot merge; shutdown stops after the current native write", async () => {
  const { api, context, tags, writes } = fixture();
  context.Zotero.Libraries.get = () => ({ editable: false });
  await assert.rejects(
    api.merge(1, ["Deep Learning", "deep-learning"], "Deep Learning"),
    /readonly/,
  );
  context.Zotero.Libraries.get = () => ({ editable: true });
  await assert.rejects(
    api.merge(1, ["Deep Learning", "Missing"], "Deep Learning"),
    /changed/,
  );
  const rename = context.Zotero.Tags.rename;
  context.Zotero.Tags.rename = async (...args) => {
    await rename(...args);
    api.stop();
  };
  await assert.rejects(
    api.merge(1, ["Deep Learning", "deep-learning", "Other"], "Deep Learning"),
    /cancelled/,
  );
  await api.finishWrites();
  assert.equal(tags.has("Other"), true);
  assert.equal(
    writes.length,
    2,
    "target color restored for the completed write",
  );
});

test("hybrid tags use direct topic coverage and neighbor support, and distinguish extracted new phrases", async () => {
  const { api, item } = fixture();
  item.getField = (field) =>
    field === "title"
      ? "Graph Neural Networks for molecule prediction"
      : "Graph Neural Networks improve molecule prediction. We evaluate molecule prediction.";
  const rows = [
    {
      score: 0.8,
      item: { id: 2, libraryID: 1, getTags: () => [{ tag: "Other" }] },
    },
  ];
  const tags = api.rank(item, rows, [
    "Other",
    "Graph Neural Networks",
    "Unrelated",
  ]);
  assert.equal(
    tags.find((tag) => tag.name === "Graph Neural Networks").isNew,
    false,
  );
  assert.equal(
    tags.find((tag) => tag.name === "Graph Neural Networks").directScore,
    1,
  );
  assert.equal(tags.find((tag) => tag.name === "Other").neighborScore, 0.8);
  assert.equal(
    tags.find((tag) => tag.name === "molecule prediction").isNew,
    true,
  );
  assert.equal(
    tags.some((tag) => tag.name === "Unrelated"),
    false,
  );
  const result = await api.suggest(item, rows);
  assert.ok(result.some((tag) => tag.isNew));
  assert.ok(result.some((tag) => !tag.isNew));
  const supported = api.rank(
    item,
    [
      {
        score: 0.9,
        item: {
          id: 3,
          libraryID: 1,
          getTags: () => [],
          getField: () => "molecule prediction",
        },
      },
    ],
    [],
  );
  assert.ok(
    supported.find((tag) => tag.name === "molecule prediction").neighborScore >
      0,
  );
});

test("new tags require an explicit selected new candidate and validate their names", async () => {
  const { api, item } = fixture();
  await api.addSelected(1, 1, [{ name: "Graph Neural Networks", isNew: true }]);
  assert.ok(item.hasTag("Graph Neural Networks"));
  await assert.rejects(
    api.addSelected(1, 1, [{ name: " bad name ", isNew: true }]),
    /invalid-name/,
  );
  await assert.rejects(
    api.addSelected(1, 1, [{ name: "bad\u0000name", isNew: true }]),
    /invalid-name/,
  );
});

test("normalization supports one native rename to a new name while preserving color and item identities", async () => {
  const { api, tags, writes } = fixture();
  assert.equal(api.normalizeName("  Graph   Networks  "), "Graph Networks");
  assert.equal(await api.preview(1, ["Other"]), 1);
  assert.equal(await api.merge(1, ["Other"], "Standard Name"), 1);
  assert.deepEqual(tags.get("Standard Name"), [4]);
  assert.equal(tags.has("Other"), false);
  assert.deepEqual(writes[0], [1, "Other", "Standard Name"]);
});

test("fixed-space naming preserves scientific and unknown mixed-case names", () => {
  const { api } = fixture();
  const format = (name, style = "sentence", hashtag = false) =>
    api.formatName(name, { style, hashtag });
  assert.equal(
    format("deep_learning GAN co-attention"),
    "Deep learning GAN co-attention",
  );
  assert.equal(
    format("deep learning GAN co-attention", "title"),
    "Deep Learning GAN Co-attention",
  );
  assert.equal(format("gan yolo openai pytorch"), "GAN YOLO OpenAI PyTorch");
  assert.equal(
    format("MyBrand X42 C++ C# .NET", "sentence", true),
    "#MyBrand X42 C++ C# .NET",
  );
  assert.equal(format("DeepLearning"), "DeepLearning");
  assert.equal(format("self-supervised learning"), "Self-supervised learning");
  assert.equal(format("zero-shot learning"), "Zero-shot learning");
  assert.equal(format("zero-shot learning", "title"), "Zero-shot Learning");
  assert.equal(format("deep-learning"), "Deep-learning");
  assert.equal(format("神经网络", "sentence", true), "#神经网络");
  const group = api.duplicateGroups([
    "#DeepLearning",
    "deep_learning",
    "deep-learning",
    "C++",
    "C#",
    "C",
  ]);
  assert.deepEqual(
    Array.from(group, (g) => Array.from(g)),
    [["#DeepLearning", "deep_learning", "deep-learning"]],
  );
});

test("configured naming applies to new suggestions while preserving existing native tag names", async () => {
  const { api, context, item } = fixture();
  context.SWPref = (key, fallback) =>
    ({ tagNameStyle: "sentence", tagHashtag: true })[key] ?? fallback;
  item.getField = (field) =>
    field === "title"
      ? "Graph Neural Networks for molecule prediction"
      : "Graph Neural Networks improve molecule prediction.";
  const rows = [
    {
      score: 0.9,
      item: { id: 2, libraryID: 1, getTags: () => [{ tag: "Deep Learning" }] },
    },
  ];
  const tags = await api.suggest(item, rows);
  assert.ok(
    tags.some((tag) => tag.isNew && tag.name === "#Graph neural networks"),
  );
  assert.ok(tags.some((tag) => !tag.isNew && tag.name === "Deep Learning"));
  item.names = ["#MoleculePrediction"];
  assert.equal(
    (await api.suggest(item, rows)).some(
      (tag) => tag.isNew && tag.name === "#Molecule prediction",
    ),
    false,
  );
});

test("colored tags and aliases are protected in their library, including merge destinations and new-tag creation", async () => {
  const { api, context, item, writes } = fixture();
  context.Zotero.Tags.getColors = (library) =>
    library === 1
      ? new Map([["Deep Learning", { color: "#123456", position: 0 }]])
      : new Map();
  assert.deepEqual(Array.from(await api.catalog(1, true)), ["Other"]);
  assert.equal((await api.catalog(2, true)).length, 3);
  const rows = [
    {
      score: 1,
      item: { id: 2, libraryID: 1, getTags: () => [{ tag: "deep-learning" }] },
    },
  ];
  assert.equal((await api.suggest(item, rows)).length, 0);
  await assert.rejects(api.preview(1, ["Deep Learning"]), /protected/);
  await assert.rejects(api.merge(1, ["deep-learning"], "Topic"), /protected/);
  await assert.rejects(api.merge(1, ["Other"], "#DeepLearning"), /protected/);
  await assert.rejects(
    api.addSelected(1, 1, [{ name: "#deep_learning", isNew: true }]),
    /protected/,
  );
  assert.deepEqual(writes, []);
  assert.deepEqual(item.names, ["Original"]);
  context.SWPref = (key, fallback) =>
    key === "excludeColoredTags" ? false : fallback;
  assert.equal((await api.catalog(1, true)).length, 3);
});

test("manual exclusions remain protected with color exclusion off, and are reread before a write", async () => {
  const { api, context, item, writes } = fixture();
  let excluded = " Other \n#DeepLearning\r\n";
  context.SWPref = (key, fallback) =>
    ({ excludeColoredTags: false, excludedTags: excluded })[key] ?? fallback;
  assert.deepEqual(Array.from(await api.catalog(1, true)), []);
  await assert.rejects(api.merge(1, ["Other"], "Unblocked"), /protected/);
  await assert.rejects(api.addSelected(1, 1, ["Other"]), /protected/);
  excluded = "";
  assert.equal(await api.preview(1, ["Other"]), 1);
  excluded = "Other";
  await assert.rejects(api.merge(1, ["Other"], "Unblocked"), /protected/);
  assert.deepEqual(writes, []);
  excluded = "";
  item.save = async () => {
    excluded = "Other";
  };
  await assert.rejects(api.addSelected(1, 1, ["Other"]), /protected/);
  assert.deepEqual(
    item.names,
    ["Original"],
    "failed save reloads the native item",
  );
});

test("bulk formatting keeps unrelated tags separate, previews collisions and skips unchanged names", async () => {
  const { api, context, tags, writes } = fixture();
  context.SWPref = (key, fallback) =>
    ({ tagNameStyle: "sentence", tagHashtag: true })[key] ?? fallback;
  tags.set("deep_learning", tags.get("deep-learning"));
  tags.delete("deep-learning");
  const plan = await api.planFormat(1, [
    "Deep Learning",
    "deep_learning",
    "Other",
  ]);
  assert.equal(plan.changes.length, 3);
  assert.equal(plan.collisions, 1);
  assert.equal(plan.itemCount, 4);
  assert.equal(await api.applyFormat(1, plan), 3);
  assert.deepEqual(tags.get("#Deep learning"), [1, 2, 3]);
  assert.deepEqual(tags.get("#Other"), [4]);
  const unchanged = await api.planFormat(1, ["#Other"]);
  assert.equal(unchanged.changes.length, 0);
  assert.equal(unchanged.itemCount, 0);
  assert.equal(
    writes.filter((value) => Array.isArray(value) && value.length === 3).length,
    3,
  );
});

test("bulk formatting refuses protected destinations or a changed preview, and stops after the current native write", async () => {
  const { api, context, tags } = fixture();
  let style = "sentence";
  context.SWPref = (key, fallback) =>
    ({ tagNameStyle: style, tagHashtag: true })[key] ?? fallback;
  const plan = await api.planFormat(1, ["Other"]);
  style = "title";
  await assert.rejects(api.applyFormat(1, plan), /changed/);
  style = "sentence";
  tags.set("#Other", [9]);
  await assert.rejects(api.applyFormat(1, plan), /changed/);
  context.Zotero.Tags.getColors = () =>
    new Map([["#Other", { color: "#123456" }]]);
  await assert.rejects(api.planFormat(1, ["Other"]), /protected/);
  context.Zotero.Tags.getColors = () => new Map();
  let active = true;
  const current = await api.planFormat(1, ["Deep Learning", "Other"]);
  const rename = context.Zotero.Tags.rename;
  context.Zotero.Tags.rename = async (...args) => {
    await rename(...args);
    active = false;
  };
  await assert.rejects(
    api.applyFormat(1, current, () => active),
    /cancelled/,
  );
  assert.ok(tags.has("#Deep learning"));
  assert.ok(tags.has("Other"));
  await api.finishWrites();
});

test("both case styles remain idempotent across dictionary aliases and protected spellings", () => {
  const { api } = fixture();
  for (const style of ["sentence", "title"])
    for (const name of [
      "gan yolo co-attention",
      "deep_learning NLP",
      "MyBrand self-supervised",
      ...api._terms.keys(),
    ]) {
      const result = api.formatName(name, { style, hashtag: true });
      assert.equal(
        api.formatName(result, { style, hashtag: true }),
        result,
        name,
      );
    }
});

test("bulk removal uses the native host operation, preserves protected tags and stops between writes", async () => {
  const { api, context, tags } = fixture();
  const names = Array.from({ length: 51 }, (_, i) => "Tag " + i);
  for (const name of names) tags.set(name, [4]);
  let active = true;
  const removed = [];
  context.Zotero.Tags.removeFromLibrary = async (libraryID, ids) => {
    assert.equal(libraryID, 1);
    removed.push(...ids);
    for (const id of ids) tags.delete(id);
    active = false;
  };
  await assert.rejects(
    api.remove(1, names, () => active),
    /cancelled/,
  );
  assert.deepEqual(removed, names.slice(0, 50));
  assert.ok(tags.has(names[50]));
  assert.ok(tags.has("Deep Learning"));
  context.Zotero.Tags.getColors = () => new Map([["Deep Learning", {}]]);
  await assert.rejects(api.remove(1, ["Deep Learning"]), /protected/);
  await api.finishWrites();
});
