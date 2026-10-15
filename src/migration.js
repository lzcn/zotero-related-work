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

  async _cleanFiles(active) {
    const root = PathUtils.join(Zotero.DataDirectory.dir, "related-work");
    if (!active() || !(await this._directory(root))) return;
    let runtimeHash = null;
    let runtimeFiles = [];
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
    }
    const models = PathUtils.join(root, "models");
    if (await this._directory(models)) {
      await this._removeDirectory(
        PathUtils.join(models, "minilm-l6-q8-v1"),
        active,
      );
      // Initial loading owns this cleanup, before inference/downloads can start.
      await this._removeTemporaryFiles(
        PathUtils.join(models, SWSemantic.version),
        Object.keys(SWSemantic.assets).map((name) => name.replaceAll("/", "-")),
        active,
      );
    }
    const runtime = PathUtils.join(root, "runtime");
    if (runtimeHash && (await this._directory(runtime))) {
      for (const path of await IOUtils.getChildren(runtime)) {
        const name = PathUtils.filename(path);
        if (name !== runtimeHash && /^[a-f0-9]{64}$/.test(name))
          await this._removeDirectory(path, active);
      }
      await this._removeTemporaryFiles(
        PathUtils.join(runtime, runtimeHash),
        runtimeFiles,
        active,
      );
    }
  },
};
if (typeof module !== "undefined" && module.exports)
  module.exports = { SWMigration };
