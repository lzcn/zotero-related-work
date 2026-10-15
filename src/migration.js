// Retire only known plugin-owned caches; current embeddings and user data survive.
var SWMigration = {
  _files: null,

  preferences() {
    const prefix = "similar-works.";
    const style = String(Zotero.Prefs.get(prefix + "tagNameStyle") || "");
    const hasStyle = Zotero.Prefs.prefHasUserValue(prefix + "tagNameStyle");
    const legacyCase = Zotero.Prefs.get(prefix + "tagSpaceCase");
    if (
      !["sentence", "title"].includes(style) ||
      (!hasStyle && legacyCase === "title")
    )
      Zotero.Prefs.set(
        prefix + "tagNameStyle",
        legacyCase === "title" ? "title" : "sentence",
      );
    for (const name of [
      "recommendationMethod",
      "tagSpaceCase",
      "tagPreserveHyphens",
    ])
      if (Zotero.Prefs.prefHasUserValue(prefix + name))
        Zotero.Prefs.clear(prefix + name);
  },

  files(active) {
    if (!this._files)
      this._files = this._cleanFiles(active).catch((error) => {
        this._files = null;
        throw new Error("[related-work] Cache cleanup failed", {
          cause: error,
        });
      });
    return this._files;
  },

  async embeddings(corpus, active) {
    return corpus.runTask(async () => {
      const rows = await corpus._db.execute(
        "SELECT v FROM meta WHERE k = 'embeddingModel'",
      );
      if (!active() || rows[0]?.getResultByName("v") === SWSemantic.version)
        return;
      await corpus._db.executeTransaction(async () => {
        await corpus._db.execute("DELETE FROM embeddings WHERE model <> ?", [
          SWSemantic.version,
        ]);
        if (!active()) throw new Error("Cache migration cancelled");
        await corpus._db.execute("DELETE FROM recommendations");
        await corpus._db.execute(
          "INSERT OR REPLACE INTO meta (k, v) VALUES ('embeddingModel', ?)",
          [SWSemantic.version],
        );
        if (!active()) throw new Error("Cache migration cancelled");
      });
    });
  },

  async _directory(path) {
    if (!(await IOUtils.exists(path))) return false;
    const file = Zotero.File.pathToFile(path);
    return !file.isSymlink() && file.isDirectory();
  },

  async _removeDirectory(path, active) {
    if (active() && (await this._directory(path)) && active()) {
      await IOUtils.remove(path, { recursive: true });
      await swYield(0);
    }
  },

  async _removeTemporaryFiles(directory, names, active) {
    if (!active() || !(await this._directory(directory))) return;
    for (const name of names) {
      if (!active()) return;
      const path = PathUtils.join(directory, name + ".tmp");
      if (!(await IOUtils.exists(path))) continue;
      const file = Zotero.File.pathToFile(path);
      if (!file.isSymlink() && file.isFile() && active())
        await IOUtils.remove(path);
    }
  },

  async _removeFile(path, active) {
    if (!active() || !(await IOUtils.exists(path))) return;
    const file = Zotero.File.pathToFile(path);
    if (!file.isSymlink() && file.isFile() && active())
      await IOUtils.remove(path);
  },

  async _reuseFile(source, target, checksum, active) {
    if (!active() || !(await IOUtils.exists(source))) return;
    const file = Zotero.File.pathToFile(source);
    if (file.isSymlink() || !file.isFile()) return;
    if (await IOUtils.exists(target)) {
      const destination = Zotero.File.pathToFile(target);
      if (destination.isSymlink() || !destination.isFile()) return;
      if (
        (await SWSemantic._checksum(await IOUtils.read(target))) === checksum
      ) {
        await this._removeFile(source, active);
        return;
      }
      if ((await SWSemantic._checksum(await IOUtils.read(source))) !== checksum)
        return;
    }
    if (active()) await IOUtils.move(source, target, { noOverwrite: false });
  },

  async _removeEmpty(directory, active) {
    if (
      active() &&
      (await this._directory(directory)) &&
      !(await IOUtils.getChildren(directory)).length &&
      active()
    )
      await IOUtils.remove(directory);
  },

  async _model(root, active) {
    const models = PathUtils.join(root, "models");
    const legacy = PathUtils.join(models, SWSemantic.version);
    const model = PathUtils.join(root, "model");
    const legacySafe =
      (await this._directory(models)) && (await this._directory(legacy));
    if (legacySafe && !(await IOUtils.exists(model)) && active())
      await IOUtils.move(legacy, model, { noOverwrite: true });
    if (!active()) return;
    if (!(await IOUtils.exists(model)))
      await IOUtils.makeDirectory(model, { ignoreExisting: true });
    if (!(await this._directory(model))) return;
    const files = {};
    for (const [asset, checksum] of Object.entries(SWSemantic.assets)) {
      const name = asset.split("/").pop();
      files[name] = checksum;
      if (legacySafe && (await this._directory(legacy)))
        await this._reuseFile(
          PathUtils.join(legacy, asset.replaceAll("/", "-")),
          PathUtils.join(model, name),
          checksum,
          active,
        );
      if (name !== asset.replaceAll("/", "-"))
        await this._reuseFile(
          PathUtils.join(model, asset.replaceAll("/", "-")),
          PathUtils.join(model, name),
          checksum,
          active,
        );
    }
    // This manifest tracks owned files, so future models replace their cache
    // in place without retaining version directories or deleting unknown files.
    const stateFile = PathUtils.join(model, ".manifest.json");
    let previous;
    if (await IOUtils.exists(stateFile)) {
      try {
        previous = JSON.parse(await IOUtils.readUTF8(stateFile));
      } catch (error) {
        Zotero.logError(error);
      }
    }
    const state = JSON.stringify({ version: SWSemantic.version, files });
    if (previous && JSON.stringify(previous) !== state) {
      for (const name of Object.keys(previous.files || {}))
        if (/^[\w.-]+$/.test(name) && !Object.hasOwn(files, name))
          await this._removeFile(PathUtils.join(model, name), active);
      await this._removeDirectory(
        PathUtils.join(model, "coreml-cache"),
        active,
      );
    }
    await this._removeTemporaryFiles(
      model,
      [
        ...Object.keys(files),
        ...Object.keys(SWSemantic.assets).map((name) =>
          name.replaceAll("/", "-"),
        ),
        ".manifest.json",
      ],
      active,
    );
    if (active() && JSON.stringify(previous) !== state)
      await IOUtils.writeUTF8(stateFile, state, {
        tmpPath: stateFile + ".tmp",
      });
    if (legacySafe && (await this._directory(legacy))) {
      const compiled = PathUtils.join(legacy, "coreml-cache");
      if (active() && (await this._directory(compiled))) {
        const target = PathUtils.join(model, "coreml-cache");
        if (!(await IOUtils.exists(target)) && active())
          await IOUtils.move(compiled, target, { noOverwrite: true });
        else await this._removeDirectory(compiled, active);
      }
      await this._removeTemporaryFiles(
        legacy,
        Object.keys(SWSemantic.assets).map((name) => name.replaceAll("/", "-")),
        active,
      );
      await this._removeEmpty(legacy, active);
    }
    await this._removeEmpty(models, active);
  },

  async _cleanFiles(active) {
    const root = PathUtils.join(Zotero.DataDirectory.dir, "related-work");
    if (!active() || !(await this._directory(root))) return;
    let runtimeHash = null;
    let runtimeFiles = [];
    let runtimeChecksums = {};
    if (Zotero.isMac) {
      const manifest = JSON.parse(
        new TextDecoder().decode(
          await SWSemantic._packageFile("native/manifest.json"),
        ),
      );
      runtimeHash = manifest?.files?.inference;
      if (
        typeof runtimeHash !== "string" ||
        !/^[a-f0-9]{64}$/.test(runtimeHash)
      )
        throw new Error("Invalid native runtime manifest during cache cleanup");
      runtimeFiles = Object.keys(manifest.files).filter((name) =>
        /^(inference|libonnxruntime\.\d+\.\d+\.\d+\.dylib)$/.test(name),
      );
      runtimeChecksums = manifest.files;
    }
    const models = PathUtils.join(root, "models");
    if (await this._directory(models)) {
      for (const retired of ["minilm-l6-q8-v1", "minilm-l6-fp32-v2"])
        if (retired !== SWSemantic.version)
          await this._removeDirectory(PathUtils.join(models, retired), active);
    }
    await this._model(root, active);
    const runtime = PathUtils.join(root, "runtime");
    if (runtimeHash && (await this._directory(runtime))) {
      for (const path of await IOUtils.getChildren(runtime)) {
        const name = PathUtils.filename(path);
        if (name === runtimeHash && (await this._directory(path)))
          for (const file of runtimeFiles)
            await this._reuseFile(
              PathUtils.join(path, file),
              PathUtils.join(runtime, file),
              runtimeChecksums[file],
              active,
            );
        if (/^[a-f0-9]{64}$/.test(name))
          await this._removeDirectory(path, active);
        else if (
          /^libonnxruntime\.\d+\.\d+\.\d+\.dylib$/.test(name) &&
          !runtimeFiles.includes(name)
        )
          await this._removeFile(path, active);
      }
      await this._removeTemporaryFiles(runtime, runtimeFiles, active);
    }
  },
};
if (typeof module !== "undefined" && module.exports)
  module.exports = { SWMigration };
