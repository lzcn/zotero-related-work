// Read-only library snapshots; graph workers belong to their own windows.
var SWGraph = {
  // Keep the unfinished graph unavailable until its interface is revised.
  enabled: false,
  _dialogs: new Set(),
  _subscriptions: new Set(),
  _stopped: false,

  async snapshot(libraryID, centerId, active = () => true) {
    const corpus = SWIndexer.corpus;
    await corpus.ready;
    if (this._stopped || !active()) return null;
    if (corpus.progress.phase !== "ready")
      throw new Error(corpus.progress.error || "Index is unavailable");
    if (!centerId?.startsWith(libraryID + "/"))
      throw new Error("similar-works-graph-unavailable");
    const method = Zotero.isMac ? "semantic" : "text";
    if (method === "semantic") await SWSemantic.start(corpus);
    // Query only keys here; native metadata is loaded for the small visible graph.
    const liveKeys = new Set(
      await Zotero.DB.columnQueryAsync(
        "SELECT key FROM items WHERE libraryID = ? AND itemID NOT IN (SELECT itemID FROM deletedItems)",
        [libraryID],
      ),
    );
    if (this._stopped || !active()) return null;
    const documents = [];
    const includeWeak = SWPref("allowMetadataOnlyRecommendations", true);
    const prefix = libraryID + "/";
    // Clone in one turn so fingerprints all belong to the same index epoch.
    for (const [key, source] of corpus.docs) {
      if (
        !key.startsWith(prefix) ||
        !liveKeys.has(key.slice(prefix.length)) ||
        (!includeWeak && source.weak)
      )
        continue;
      if (method === "semantic") {
        const embedding = SWSemantic.vectors.get(key);
        if (embedding?.hash !== source.hash) continue;
        documents.push({ key, vector: new Float32Array(embedding.vector) });
      } else {
        const doc = corpus.search.docs.get(key);
        if (!doc) continue;
        const vector = (value) => ({
          ids: new Uint32Array(value.ids),
          weights: new Float64Array(value.weights),
          length: value.length,
        });
        documents.push({
          key,
          vector: vector(doc.vector),
          fieldVectors: doc.fieldVectors.map(vector),
        });
      }
    }
    return { documents, method, centerId };
  },

  async describe(libraryID, ids, active = () => true) {
    const nodes = [];
    for (const id of ids) {
      if (this._stopped || !active()) return null;
      if (!id.startsWith(libraryID + "/")) continue;
      const item = await Zotero.Items.getByLibraryAndKeyAsync(
        libraryID,
        id.slice(id.indexOf("/") + 1),
      );
      if (
        !item ||
        item.deleted ||
        item.isFeedItem ||
        !item.isRegularItem() ||
        item.parentItemID
      )
        continue;
      const yearText = String(item.getField("date") || "").match(
        /\b\d{4}\b/,
      )?.[0];
      const year = yearText ? Number(yearText) : null;
      nodes.push({
        id,
        itemID: item.id,
        title: String(item.getField("title") || item.getDisplayTitle()),
        meta: [item.firstCreator, yearText].filter(Boolean).join(" · "),
        year,
        color: swGraphYearColor(year),
        abstract: String(item.getField("abstractNote") || ""),
        tags: item.getTags().map(({ tag }) => tag),
      });
    }
    return this._stopped || !active() ? null : nodes;
  },

  subscribe(listener) {
    let previous = JSON.stringify([
      SWIndexer.corpus.revision,
      SWSemantic.vectors.size,
    ]);
    let timer;
    const poll = () => {
      const next = JSON.stringify([
        SWIndexer.corpus.revision,
        SWSemantic.vectors.size,
      ]);
      if (next !== previous) {
        previous = next;
        listener("items");
      }
      timer = setTimeout(poll, 2000);
    };
    timer = setTimeout(poll, 2000);
    const observer = Zotero.Notifier.registerObserver(
      { notify: () => listener("items") },
      ["item", "item-tag"],
      "similar-works-graph",
    );
    const preferences = ["allowMetadataOnlyRecommendations"].map((name) =>
      Zotero.Prefs.registerObserver("similar-works." + name, () =>
        listener("preferences"),
      ),
    );
    const unsubscribe = () => {
      if (!this._subscriptions.delete(unsubscribe)) return;
      clearTimeout(timer);
      Zotero.Notifier.unregisterObserver(observer);
      for (const id of preferences) Zotero.Prefs.unregisterObserver(id);
    };
    this._subscriptions.add(unsubscribe);
    return unsubscribe;
  },

  async select(id) {
    if (this._stopped) return;
    const slash = id.indexOf("/");
    const item = await Zotero.Items.getByLibraryAndKeyAsync(
      Number(id.slice(0, slash)),
      id.slice(slash + 1),
    );
    if (this._stopped || !item || item.deleted)
      throw new Error("similar-works-graph-unavailable");
    const win = Zotero.getMainWindow();
    win.Zotero_Tabs.select("zotero-pane");
    await win.ZoteroPane.selectItem(item.id);
    win.focus();
  },

  open(win, libraryID, centerId) {
    if (!this.enabled || this._stopped || !Zotero.Libraries.get(libraryID))
      return null;
    if (!centerId) {
      let item = win.ZoteroPane.getSelectedItems()[0];
      if (item?.parentItemID) item = Zotero.Items.get(item.parentItemID);
      if (
        !item ||
        item.deleted ||
        item.isFeedItem ||
        !item.isRegularItem() ||
        item.libraryID !== libraryID
      )
        return null;
      centerId = SWIndexer.docKey(item);
    }
    const existing = [...this._dialogs].find(
      (dialog) => !dialog.closed && dialog.arguments[0].libraryID === libraryID,
    );
    if (existing) {
      existing.arguments[0].centerId = centerId;
      existing.dispatchEvent(
        new existing.CustomEvent("related-work-center", { detail: centerId }),
      );
      existing.focus();
      return existing;
    }
    const url = "chrome://similar-works/content/graph.xhtml";
    const dialog = win.openDialog(
      url,
      "",
      "chrome,centerscreen,resizable,width=1100,height=760",
      {
        api: this,
        libraryID,
        centerId,
        isMac: !!Zotero.isMac,
      },
    );
    this._dialogs.add(dialog);
    const loaded = () => {
      if (
        dialog.document.documentURI !== url ||
        dialog.document.readyState !== "complete"
      )
        return;
      dialog.removeEventListener("load", loaded);
      dialog.addEventListener("unload", () => this._dialogs.delete(dialog), {
        once: true,
      });
    };
    dialog.addEventListener("load", loaded);
    loaded();
    return dialog;
  },

  stop() {
    this._stopped = true;
    for (const dialog of this._dialogs) if (!dialog.closed) dialog.close();
    this._dialogs.clear();
    for (const unsubscribe of this._subscriptions) unsubscribe();
  },
};
function swGraphYearColor(year, currentYear = new Date().getFullYear()) {
  if (!Number.isInteger(year) || year <= 0) return "#9aa0a6";
  const freshness = Math.exp(-Math.max(0, currentYear - year) / 12);
  return `hsl(215 70% ${(78 - 36 * freshness).toFixed(1)}%)`;
}
if (typeof module !== "undefined")
  module.exports = { SWGraph, swGraphYearColor };
