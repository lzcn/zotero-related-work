/* global window, Zotero */
window.MozXULElement.insertFTLIfNeeded("similar-works.ftl");
window.SimilarWorksPreferences?.stop();
window.SimilarWorksPreferences = (() => {
  let timer,
    generation = 0,
    buildInfo;
  const stop = () => {
    generation++;
    window.clearTimeout(timer);
  };
  async function start(doc) {
    stop();
    const token = generation;
    async function refresh() {
      const status = Zotero.getMainWindow()?.similarWorksStatus?.();
      const root = doc.getElementById("similar-works-diagnostics");
      if (token !== generation || !status || !root?.isConnected) return;
      try {
        if (!buildInfo)
          buildInfo = JSON.parse(
            await Zotero.File.getResourceAsync(
              status.rootURI + "content/build-info.json",
            ),
          );
        const phase = await doc.l10n.formatValue(
          "similar-works-state-" + status.state,
        );
        const vectorPhase = await doc.l10n.formatValue(
          "similar-works-state-" + status.semantic.state,
        );
        const indexText = await doc.l10n.formatValue(
          "similar-works-pref-index-value",
          {
            phase,
            count: status.indexedItems,
            total: status.totalItems ?? status.indexProgress.total ?? 0,
            known: Number(status.totalItems !== null),
            pending: status.queuedItems,
          },
        );
        const vectorText = await doc.l10n.formatValue(
          "similar-works-pref-vector-value",
          {
            phase: vectorPhase,
            count: status.semantic.indexedItems,
            total: status.vectorTotal,
            pending: status.semantic.queuedItems,
          },
        );
        const modelText = await doc.l10n.formatValue(
          "similar-works-pref-model-value",
          {
            model: status.model,
            dimensions: status.dimensions,
            version: status.modelVersion,
          },
        );
        if (token !== generation || !root.isConnected) return;
        for (const [id, text] of Object.entries({
          "similar-works-build": `${buildInfo.version} · ${buildInfo.id}`,
          "similar-works-index": indexText,
          "similar-works-vectors": vectorText,
          "similar-works-model": modelText,
        }))
          doc.getElementById(id).textContent = text;
        for (const [id, total, done, enabled] of [
          [
            "similar-works-index-progress",
            status.state === "scanning" && status.totalItems === null
              ? 0
              : (status.totalItems ?? status.indexProgress.total),
            status.indexProgress.phase === "loading"
              ? status.indexProgress.done
              : status.indexedItems,
            ["preparing", "scanning", "indexing"].includes(status.state),
          ],
          [
            "similar-works-vector-progress",
            status.vectorTotal,
            status.semantic.indexedItems,
            !["disabled", "idle", "stopped"].includes(status.semantic.state),
          ],
        ]) {
          const bar = doc.getElementById(id);
          bar.hidden = !enabled;
          if (total > 0) {
            bar.max = total;
            bar.value = Math.min(done, total);
          } else bar.removeAttribute("value");
        }
        const error = doc.getElementById("similar-works-diagnostics-error");
        error.textContent = status.error || status.semantic.error || "";
        error.hidden = !error.textContent;
      } catch (error) {
        Zotero.logError(error);
      }
      if (token === generation) timer = window.setTimeout(refresh, 1000);
    }
    await refresh();
  }
  window.addEventListener("unload", stop, { once: true });
  return { start, stop };
})();
