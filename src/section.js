var SW_CSS = `
.sw-list { display: flex; flex-direction: column; gap: 3px; padding: 2px 0; }
.sw-computation-progress { display: block; width: calc(100% - 12px); height: 4px; margin: 3px 6px 7px; accent-color: var(--accent-blue, #3874d8); }
.sw-computation-progress[hidden] { display: none; }
.sw-status { padding: 4px 6px; color: var(--text-secondary, gray); font-size: 12px; }
.sw-row {
	display: flex; align-items: flex-start; gap: 10px;
	padding: 6px 8px; border-radius: 6px; cursor: pointer;
}
.sw-row { border: 0; background: transparent; text-align: start; font: inherit; color: inherit; width: 100%; }
/* Zotero's native button rule caps max-height at 25px. Recommendation rows
   must grow with their title and metadata, including in XUL main windows. */
.sw-list > button.sw-row { appearance: none; box-sizing: border-box; height: auto;
	max-height: none; min-height: 0; margin: 0; flex-shrink: 0; white-space: normal; }
.sw-row:focus-visible { outline: 2px solid var(--accent-blue, #3874d8); }
.sw-rank { min-width: 14px; padding-top: 3px; font-size: 11px; color: var(--text-secondary, gray); }
.sw-row:hover { background: var(--fill-quinary, rgba(127, 127, 127, 0.12)); }
.sw-row:active { background: var(--fill-quaternary, rgba(127, 127, 127, 0.2)); }
.sw-main { flex: 1 1 auto; min-width: 0; }
.sw-title {
	font-size: 13px; line-height: 1.35; color: var(--text-primary, currentColor);
	display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.sw-meta { font-size: 11px; color: var(--text-secondary, gray); line-height: 1.4; margin-top: 3px;
	white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sw-side { flex: none; width: 74px; display: flex; flex-direction: column;
	align-items: flex-end; gap: 4px; padding-top: 1px; }
.sw-num { font-size: 11px; font-weight: 500; color: var(--accent-blue, #3874d8);
	font-variant-numeric: tabular-nums; }
.sw-track { width: 74px; height: 4px; border-radius: 2px;
	background: var(--fill-secondary, rgba(127, 127, 127, 0.25)); overflow: hidden; }
.sw-bar { height: 100%; border-radius: 2px; background: var(--accent-blue, #3874d8); }
.sw-flag { font-size: 10px; color: var(--text-tertiary, gray); border: 1px solid
	var(--fill-tertiary, rgba(127,127,127,.35)); border-radius: 3px; padding: 0 3px; }
`;

var SWSection = {
  _rootURI: null,
  _registered: null,
  _active: [],
  _stopped: false,
  _windows: new Set(),

  register(rootURI) {
    this._rootURI = rootURI;
    var self = this;
    var opts = {
      pluginID: SWPlugin.id,
      paneID: "similar-works-similar",
      header: {
        l10nID: "similar-works-header",
        icon: rootURI + "icons/icon-16.svg",
      },
      sidenav: {
        l10nID: "similar-works-sidenav",
        icon: rootURI + "icons/icon-20.svg",
      },
      onDestroy: ({ body }) => {
        body._swToken = (body._swToken || 0) + 1;
        self._active = self._active.filter((e) => e.body !== body);
      },
      onItemChange: (props) => {
        var { body, item, setEnabled } = props;
        if (!item || body._swSelectionKey !== SWIndexer.docKey(item)) {
          body._swToken = (body._swToken || 0) + 1;
        }
        self._active = self._active.filter((e) => e.body !== body);
        var supported =
          !!item &&
          !item.isNote() &&
          !item.isFeedItem &&
          (item.isRegularItem() || item.isAttachment());
        setEnabled(supported);
        if (supported) self._track(props);
        return true;
      },
      onRender: ({ body }) => {
        self.ensureSkeleton(body);
      },
      onAsyncRender: (props) => {
        return self.renderBody(props);
      },
      onToggle: (props) => self.renderBody(props),
      sectionButtons: [
        {
          type: "refresh",
          icon: "chrome://zotero/skin/16/universal/refresh.svg",
          l10nID: "similar-works-refresh",
          onClick: (props) => self.renderBody(props, true),
        },
      ],
    };
    this._registered = Zotero.ItemPaneManager.registerSection(opts);
    return this._registered !== false;
  },

  ensureSkeleton(body) {
    if (!body || body.querySelector(".sw-list")) return;
    var doc = body.ownerDocument;
    var list = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
    list.className = "sw-list";
    var status = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
    status.className = "sw-status";
    status.setAttribute("role", "status");
    status.hidden = true;
    var progress = doc.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "progress",
    );
    progress.className = "sw-computation-progress";
    progress.max = 100;
    progress.hidden = true;
    progress.setAttribute("aria-label", "Similarity calculation progress");
    body.replaceChildren(status, progress, list);
  },

  async fmt(doc, id, args, fallback) {
    try {
      var s = await doc.l10n.formatValue(id, args);
      if (s) {
        return s;
      }
    } catch (e) {}
    return fallback;
  },

  _track(props) {
    this._active = this._active.filter(
      (e) => e.body.isConnected && e.body !== props.body,
    );
    this._active.push(props);
  },

  setStatus(body, text, clearRows = true) {
    var status = body.querySelector(".sw-status");
    if (status) {
      status.textContent = text;
      status.hidden = !text;
    }
    if (!clearRows) return;
    body._swResultsSignature = null;
    var rows = body.querySelectorAll(".sw-row");
    for (let r of rows) {
      r.remove();
    }
  },

  async renderBody(props, compute = false) {
    var body = props.body;
    var key = props.item && SWIndexer.docKey(props.item);
    if (!compute && body?._swWork && body._swWorkKey === key) return;
    var token;
    var work = (async () => {
      try {
        var pending = this._renderBody(props, compute);
        token = body?._swToken;
        await pending;
      } catch (e) {
        Zotero.logError(e);
        if (!this._stopped && body && body._swToken === token) {
          // Preserve usable cached rows if revalidation fails.
          this.setStatus(body, String(e.message || e), false);
        }
      } finally {
        if (body && body._swToken === token) {
          body.setAttribute("aria-busy", "false");
          var progress = body.querySelector(".sw-computation-progress");
          if (progress) progress.hidden = true;
        }
      }
    })();
    if (body) {
      body._swWork = work;
      body._swWorkKey = key;
    }
    try {
      await work;
    } finally {
      if (body?._swWork === work) body._swWork = null;
    }
  },

  async _renderBody(props, compute) {
    var { body, item, setSectionSummary } = props;
    if (this._stopped || !body || !item) {
      return;
    }
    var doc = body.ownerDocument;
    var selectionKey = SWIndexer.docKey(item);
    var token =
      (body._swToken || 0) +
      (compute || body._swSelectionKey !== selectionKey ? 1 : 0);
    body._swToken = token;
    var show = async (id, args, fallback, suffix = "") => {
      var text = await this.fmt(doc, id, args, fallback);
      if (!this._stopped && body._swToken === token)
        this.setStatus(body, text + suffix);
    };
    this._track(props);
    this.ensureSkeleton(body);
    if (body._swSelectionKey !== selectionKey) {
      body._swSelectionKey = selectionKey;
      body.querySelector(".sw-computation-progress").hidden = true;
      body.setAttribute("aria-busy", "false");
      body._swResultsSignature = null;
      this.setStatus(body, "");
      if (setSectionSummary) setSectionSummary("");
    }

    var sectionEl = body.closest ? body.closest("collapsible-section") : null;
    if (sectionEl && sectionEl.open === false) {
      body._swPending = true;
      return;
    }
    body._swPending = false;

    if (compute) {
      this.setStatus(body, "Computing similarity…", false);
      body.setAttribute("aria-busy", "true");
      var progressBar = body.querySelector(".sw-computation-progress");
      progressBar.hidden = false;
      progressBar.removeAttribute("value");
      var computingText = await this.fmt(
        doc,
        "similar-works-computing",
        null,
        "Computing similarity…",
      );
      if (body._swToken !== token || this._stopped) return;
      this.setStatus(body, computingText, false);
    }

    var corpus = SWIndexer.corpus;
    if (!corpus) {
      if (compute)
        await show(
          "similar-works-unavailable",
          null,
          "Similarity index unavailable",
        );
      return;
    }
    if (corpus.progress.phase !== "ready") {
      if (!compute && corpus.progress.phase !== "error") {
        await show(
          "similar-works-preparing",
          null,
          "Preparing recommendations…",
        );
        if (body._swToken !== token || this._stopped) return;
        body.setAttribute("aria-busy", "true");
        const preparingProgress = body.querySelector(
          ".sw-computation-progress",
        );
        preparingProgress.hidden = false;
        preparingProgress.removeAttribute("value");
      }
      await corpus.ready;
      if (body._swToken !== token || this._stopped) return;
    }
    if (corpus.progress.phase === "error") {
      var errDetail = corpus.progress.error
        ? " (" + corpus.progress.error + ")"
        : "";
      await show(
        "similar-works-unavailable",
        null,
        "Index unavailable",
        errDetail,
      );
      return;
    }
    if (corpus.progress.phase !== "ready") return;

    var target = await SWIndexer.resolveDocItem(item);
    if (!target || body._swToken !== token || this._stopped) return;
    var docKey = SWIndexer.docKey(target);
    var includeWeak = SWPref("allowMetadataOnlyRecommendations", true);
    var cached = compute
      ? null
      : await corpus.getRecommendations(docKey, includeWeak);
    if (body._swToken !== token || this._stopped) return;
    if (cached)
      await this._presentMatches(
        props,
        cached.matches,
        docKey,
        token,
        "similar-works-cached",
        "Cached results",
      );
    if (body._swToken !== token || this._stopped) return;
    // Avoid spending CPU on items the user only passes while browsing.
    if (!compute) await swYield(120);
    if (body._swToken !== token || this._stopped || sectionEl?.open === false)
      return;
    if (compute) await SWIndexer.ensureNow(item);
    else await SWIndexer.ensureForDisplay(item);
    if (body._swToken !== token) {
      return;
    }
    if (!target) {
      await show(
        "similar-works-no-text",
        null,
        "No analyzable full text or abstract for this item",
      );
      return;
    }
    if (!corpus.docs.has(docKey)) {
      await show(
        "similar-works-no-text",
        null,
        "No analyzable full text or abstract for this item",
      );
      return;
    }

    if (!compute && corpus.recommendationsFresh(cached, docKey)) return;
    // Coalesce corpus changes instead of repeatedly scoring during a bulk import.
    if (!compute && cached) {
      const waitingSince = Date.now();
      while (
        Date.now() - corpus.lastChangedAt < 2500 &&
        Date.now() - waitingSince < 5000
      ) {
        await swYield(250);
        if (
          this._stopped ||
          body._swToken !== token ||
          sectionEl?.open === false
        )
          return;
      }
    }
    progressBar = body.querySelector(".sw-computation-progress");
    computingText = await this.fmt(
      doc,
      cached ? "similar-works-updating" : "similar-works-computing",
      null,
      cached ? "Updating…" : "Computing similarity…",
    );
    if (body._swToken !== token || this._stopped) return;
    this.setStatus(body, computingText, false);
    body.setAttribute("aria-busy", "true");
    progressBar.hidden = !!cached && !compute;
    var epoch = corpus.search.epoch;
    var revision = corpus.revision;
    var queryHash = corpus.docs.get(docKey).hash;
    var lastProgress = 0;
    var matches = await corpus.scoreTopKAsync(
      docKey,
      50,
      (key, d) =>
        key.startsWith(target.libraryID + "/") && (includeWeak || !d.weak),
      () =>
        this._stopped || body._swToken !== token || sectionEl?.open === false,
      ({ done, total }) => {
        if (this._stopped || body._swToken !== token) return;
        if (done < total && Date.now() - lastProgress < 100) return;
        lastProgress = Date.now();
        progressBar.value = total ? Math.min(100, (done / total) * 100) : 100;
        this.setStatus(
          body,
          computingText + (total ? " " + done + " / " + total : ""),
          false,
        );
      },
      30,
      (currentRevision, currentHash, currentEpoch) => {
        epoch = currentEpoch;
        revision = currentRevision;
        queryHash = currentHash;
      },
    );
    if (body._swToken !== token) {
      return;
    }

    if (this._stopped || sectionEl?.open === false) return;
    await corpus.saveRecommendations(
      docKey,
      includeWeak,
      matches,
      revision,
      queryHash,
      epoch,
    );
    if (body._swToken !== token || this._stopped) return;
    await this._presentMatches(props, matches, docKey, token);
  },

  async _presentMatches(
    props,
    matches,
    docKey,
    token,
    statusID = "similar-works-updated",
    fallback = "Updated",
  ) {
    var { body, setSectionSummary, tabType } = props;
    var doc = body.ownerDocument;
    var corpus = SWIndexer.corpus;
    if (setSectionSummary) setSectionSummary("");
    var k = SWResultLimit(SWPref("maxRecommendations", 20));
    var rows = await this._resolveRows(matches, k);
    if (body._swToken !== token) {
      return;
    }

    var list = body.querySelector(".sw-list");
    if (!rows.length) {
      var emptyText = await this.fmt(
        doc,
        "similar-works-empty",
        null,
        "No similar items found in this library",
      );
      if (body._swToken !== token || this._stopped) return;
      this.setStatus(body, emptyText);
      if (body._swToken !== token) return;
      if (setSectionSummary) {
        setSectionSummary("");
      }
      return;
    }
    var top = rows[0].score;
    var weakFlag = await this.fmt(
      doc,
      "similar-works-based-on-weak",
      null,
      "metadata only",
    );

    var queryWeak = corpus.docs.get(docKey)?.weak;
    if (this._stopped || body._swToken !== token) return;
    var updated = await this.fmt(doc, statusID, null, fallback);
    if (this._stopped || body._swToken !== token) return;
    this.setStatus(body, updated + (queryWeak ? " · " + weakFlag : ""), false);
    var signature = JSON.stringify(
      rows.map((r) => [
        r.item.id,
        r.item.getField("title"),
        r.item.getField("date"),
        r.item.getCreators(),
        r.score.toFixed(3),
        r.weak,
      ]),
    );
    if (body._swResultsSignature === signature) return;
    var renderedRows = [];
    var rank = 0;
    for (let r of rows) {
      var row = doc.createElementNS("http://www.w3.org/1999/xhtml", "button");
      row.type = "button";
      row.className = "sw-row";
      var rankLabel = doc.createElementNS(
        "http://www.w3.org/1999/xhtml",
        "span",
      );
      rankLabel.className = "sw-rank";
      rankLabel.textContent = String(++rank);
      row.appendChild(rankLabel);
      var main = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
      main.className = "sw-main";
      var title = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
      title.className = "sw-title";
      title.textContent = r.item.getField("title") || r.item.getDisplayTitle();
      var meta = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
      meta.className = "sw-meta";
      var year = "";
      try {
        var m = String(r.item.getField("date") || "").match(/\d{4}/);
        year = m ? m[0] : "";
      } catch (e) {}
      var creator = "";
      try {
        var cs = r.item.getCreators();
        creator = cs && cs.length ? cs[0].lastName : "";
      } catch (e) {}
      meta.textContent = [year, creator].filter(Boolean).join(" · ");
      main.appendChild(title);
      main.appendChild(meta);

      var side = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
      side.className = "sw-side";
      var num = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
      num.className = "sw-num";
      num.textContent = (r.score * 100).toFixed(1) + "%";
      var track = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
      track.className = "sw-track";
      var bar = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
      bar.className = "sw-bar";
      bar.style.width =
        Math.max(3, (r.score / (top || 1)) * 100).toFixed(1) + "%";
      track.appendChild(bar);
      side.appendChild(num);
      side.appendChild(track);

      row.appendChild(main);
      row.appendChild(side);
      if (r.weak) {
        var flag = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
        flag.className = "sw-flag";
        flag.textContent = weakFlag;
        side.appendChild(flag);
      }

      let itemId = r.item.id;
      let srcTabType = tabType;
      row.addEventListener("click", () =>
        this._selectItem(doc, itemId, srcTabType),
      );
      renderedRows.push(row);
    }
    list.replaceChildren(...renderedRows);
    body._swResultsSignature = signature;
    if (setSectionSummary) {
      setSectionSummary("");
    }
  },

  async _resolveRows(matches, k) {
    var out = [];
    const configuredMinimum = Number(SWPref("minimumSimilarity", 0.05));
    const minimum =
      Number.isFinite(configuredMinimum) &&
      configuredMinimum >= 0 &&
      configuredMinimum <= 1
        ? configuredMinimum
        : 0.05;
    for (var m of matches) {
      if (!Number.isFinite(m.score) || m.score < minimum) continue;
      if (out.length >= k) {
        break;
      }
      var idx = m.key.indexOf("/");
      if (idx < 1) {
        continue;
      }
      var it = null;
      try {
        it = await Zotero.Items.getByLibraryAndKeyAsync(
          parseInt(m.key.substring(0, idx)),
          m.key.substring(idx + 1),
        );
      } catch (e) {}
      if (!it || it.deleted || it.isFeedItem || it.parentItemID) {
        continue;
      }
      out.push({ item: it, score: m.score, weak: m.weak });
    }
    return out;
  },

  _selectItem(doc, itemId, tabType) {
    try {
      var win = doc.defaultView;
      if (tabType !== "library" && win && win.Zotero_Tabs) {
        win.Zotero_Tabs.select("zotero-pane");
      }
      var zp = win?.ZoteroPane || Zotero.getActiveZoteroPane();
      if (zp) {
        zp.selectItem(itemId);
      }
    } catch (e) {
      Zotero.logError(e);
    }
  },

  injectWindow(win) {
    try {
      win.MozXULElement.insertFTLIfNeeded("similar-works.ftl");
    } catch (e) {}
    var doc = win.document;
    if (!doc.getElementById("similar-works-style")) {
      var style = doc.createElementNS("http://www.w3.org/1999/xhtml", "style");
      style.id = "similar-works-style";
      style.textContent = SW_CSS;
      doc.documentElement.appendChild(style);
    }
    this._windows.add(win);
  },

  removeWindow(win) {
    try {
      var doc = win.document;
      var style = doc.getElementById("similar-works-style");
      if (style) {
        style.remove();
      }
      var link = doc.querySelector('link[href="similar-works.ftl"]');
      if (link) {
        link.remove();
      }
    } catch (e) {}
    this._windows.delete(win);
  },

  shutdown() {
    this._stopped = true;
    for (var entry of this._active) entry.body._swToken++;
    try {
      if (this._registered) {
        Zotero.ItemPaneManager.unregisterSection(this._registered);
      }
    } catch (e) {}
    for (var win of Array.from(this._windows)) {
      this.removeWindow(win);
    }
    this._active = [];
    this._registered = null;
  },
};
