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
    SWPref: (name, fallback) => {
      const value = context.Zotero.Prefs.get("similar-works." + name);
      return value === undefined ? fallback : value;
    },
    Zotero: {
      Promise: { delay: async () => {} },
      Libraries: { get: () => ({ editable: true }) },
      Items: { getAsync: async () => item },
      Prefs: { get: () => undefined },
      locale: "en-US",
      HTTP: {
        request: async () => {
          throw new Error("Unexpected HTTP request");
        },
      },
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
      DB: {
        executeTransaction: async (work) => work(),
        queryAsync: async () => [],
      },
    },
    URL,
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
  return {
    api: context.SWTags,
    context,
    item,
    tags,
    writes,
  };
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

test("duplicates separate related and opposite concepts while suggesting spelling variants", () => {
  const { api, writes } = fixture();
  const names = [
    "#Convex Optimization",
    "#Nonconvex Optimization",
    "#Graph Representation Learning",
    "#Representation Learning",
    "#Self-supervised Learning",
    "#Semi-supervised Learning",
    "#Supervised Learning",
    "#Unsupervised Learning",
    "#Weakly Supervised Learning",
    "Graph neural network",
    "Neural networks graph",
    "graphneuralnetwork",
    "GPT-2",
    "GPT-3",
    "C++",
    "C#",
  ];
  assert.deepEqual(Array.from(api.duplicateGroups(names)), []);
  const variants = api.duplicateGroups([
    ...names,
    "convex_optimization",
    "#GraphRepresentationLearning",
  ]);
  assert.deepEqual(
    Array.from(variants, (group) => Array.from(group)),
    [
      ["#Convex Optimization", "convex_optimization"],
      ["#Graph Representation Learning", "#GraphRepresentationLearning"],
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

test("new suggestions can come from the paper without neighboring support", async () => {
  const { api, context, item } = fixture();
  item.getField = (field) =>
    field === "title"
      ? "Graph Neural Networks for molecule prediction"
      : "Graph Neural Networks improve molecule prediction. Neural features form a network.";
  const neighbor = (id) => ({
    score: 0.8,
    item: {
      id,
      libraryID: 1,
      getTags: () => [{ tag: "Other" }],
      getField: () => "molecule prediction",
    },
  });
  context.Zotero.Tags.getAll = async () =>
    ["Other", "Graph Neural Networks", "Neural network"].map((tag) => ({
      tag,
    }));
  const one = await api.suggest(item, [neighbor(2), neighbor(2)]);
  assert.ok(one.some((tag) => tag.name === "Graph Neural Networks"));
  assert.ok(one.some((tag) => tag.isNew));
  const rows = [neighbor(2), neighbor(3)];
  const tags = await api.suggest(item, rows);
  assert.ok(
    tags.some((tag) => tag.name === "Graph Neural Networks" && !tag.isNew),
  );
  assert.ok(
    tags.some((tag) => tag.name === "Molecule prediction" && tag.isNew),
  );
  assert.ok(tags.some((tag) => tag.name === "Other"));
  assert.ok(!tags.some((tag) => tag.name === "Learning"));
  assert.ok(tags.filter((tag) => /deep/i.test(tag.name)).length <= 1);
  item.getField = () => "";
  assert.deepEqual(Array.from(await api.suggest(item, [])), []);
});

test("suggested tag application rejects missing tags and invalid names", async () => {
  const { api, item } = fixture();
  await assert.rejects(
    api.addSelected(1, 1, ["Graph Neural Networks"]),
    /changed/,
  );
  await assert.rejects(
    api.addSelected(1, 1, ["bad\u0000name"]),
    /invalid-name/,
  );
  assert.deepEqual(item.names, ["Original"]);
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

test("suggestions preserve existing names and format supported new phrases", async () => {
  const { api, context, item } = fixture();
  context.SWPref = (key, fallback) =>
    ({ tagNameStyle: "sentence", tagHashtag: true })[key] ?? fallback;
  item.getField = () =>
    "Deep Learning for Graph Neural Networks and molecule prediction";
  const rows = [2, 3].map((id) => ({
    score: 0.9,
    item: {
      id,
      libraryID: 1,
      getTags: () => [{ tag: "Deep Learning" }],
      getField: () => item.getField(),
    },
  }));
  const suggestions = await api.suggest(item, rows);
  assert.ok(
    suggestions.some((tag) => tag.name === "Deep Learning" && !tag.isNew),
  );
  assert.ok(suggestions.some((tag) => tag.isNew && tag.name.startsWith("#")));
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
  await assert.rejects(api.addSelected(1, 1, ["#deep_learning"]), /protected/);
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

test("more grounded suggestions are allowed without filling or proliferating new tags", async () => {
  const { api, context, item } = fixture();
  const names = [
    "Graph clustering",
    "Molecule prediction",
    "Image retrieval",
    "Object detection",
    "Semantic segmentation",
    "Domain adaptation",
    "Attention mechanism",
    "Contrastive learning",
    "Matrix factorization",
  ];
  context.Zotero.Tags.getAll = async () => names.map((tag) => ({ tag }));
  item.getField = () => names.join(" and ");
  const existing = await api.suggest(item, []);
  assert.equal(existing.length, 9);
  assert.ok(existing.every((tag) => !tag.isNew));
  context.Zotero.Tags.getAll = async () => [];
  const rows = [2, 3].map((id) => ({
    score: 0.9,
    item: {
      id,
      libraryID: 1,
      getTags: () => [],
      getField: () => item.getField(),
    },
  }));
  const fresh = await api.suggest(item, rows);
  assert.equal(fresh.length, 4);
  assert.ok(fresh.every((tag) => tag.isNew));
  assert.equal((await api.suggest(item, [rows[0], rows[0]])).length, 4);
  const phrase = fresh[0].name;
  await assert.rejects(api.addSelected(1, 1, [phrase]), /changed/);
  assert.equal(await api.addSelected(1, 1, [phrase], () => true, [phrase]), 1);
  assert.ok(item.hasTag(phrase));
});

test("duplicate strategies explain plural, explicit abbreviations and spelling without transitive guessing", () => {
  const { api } = fixture();
  assert.equal(
    api.duplicateReason("Graph neural networks", "Graph neural network"),
    "alias",
  );
  assert.equal(
    api.duplicateReason("GNN", "Graph neural network (GNN)"),
    "abbreviation",
  );
  assert.equal(
    api.duplicateReason("Representation learning", "Representaton learning"),
    "spelling",
  );
  assert.equal(api.duplicateReason("GPT-2", "GPT-3"), null);
  assert.equal(
    api.duplicateReason("Supervised learning", "Unsupervised learning"),
    null,
  );
  assert.equal(api.duplicateReason("GNN", "Graph neural network"), "alias");
  const groups = api.duplicateGroups([
    "GNN",
    "Graph neural network (GNN)",
    "Graph neural network",
  ]);
  assert.equal(groups[0].length, 3);
});

test("existing suggestions include abstract-only matches and neighboring tags", async () => {
  const { api, item } = fixture();
  item.getField = (field) =>
    field === "title" ? "A new approach" : "Deep learning improves accuracy";
  assert.ok(
    (await api.suggest(item, [])).some((tag) => tag.name === "Deep Learning"),
  );
  const rows = [
    {
      score: 0.9,
      item: { id: 2, libraryID: 1, getTags: () => [{ tag: "Other" }] },
    },
  ];
  assert.ok(
    (await api.suggest(item, rows)).some((tag) => tag.name === "Other"),
  );
});

test("terminology aliases preserve task modifiers", () => {
  const { api } = fixture();
  assert.equal(api.duplicateReason("Convolutional Nets", "CNN"), "alias");
  assert.equal(
    api.duplicateReason(
      "Conditional GAN",
      "Conditional generative adversarial network",
    ),
    "alias",
  );
  assert.equal(api.duplicateReason("GAN", "Conditional GAN"), null);
  assert.equal(api.duplicateGroups(["Convolutional Nets", "CNN"])[0].length, 2);
});
