function SWPref(name, fallback) {
	try {
		var v = Zotero.Prefs.get("similarworks." + name);
		return v === undefined || v === null ? fallback : v;
	}
	catch (e) {
		return fallback;
	}
}

function SWResultLimit(value) {
	var n = Number(value);
	return Number.isFinite(n) && n >= 1 ? Math.min(100, Math.floor(n)) : 10;
}

var SWIndexer = {
	corpus: null,
	_queue: [],
	_queued: new Set(),
	_inFlight: new Map(),
	_itemKeys: new Map(),
	_stopped: false,
	_drainPromise: null,
	_scanPromise: null,
	_requestedFulltext: new Set(),
	_pendingRemovals: new Set(),
	_draining: false,
	_notifierID: null,
	_started: false,

	async start() {
		if (this._started) {
			return;
		}
		this._started = true;
		this.corpus = new SWCorpus();
		this._scanPromise = this.corpus.ready.then(async () => {
			var remaining = SWPref("backgroundStartupDelayMs", 15000);
			while (!this._stopped && remaining > 0) {
				await swYield(Math.min(250, remaining));
				remaining -= 250;
			}
			if (!this._stopped && this.corpus.progress.phase === "ready") {
				return this.enqueueLibrary();
			}
		}).catch(e => Zotero.logError(e));
		this.registerNotifier();
	},

	registerNotifier() {
		var observer = {
			notify: (event, type, ids, extraData) => {
				try {
					this._onNotify(event, type, ids, extraData);
				}
				catch (e) {
					Zotero.logError(e);
				}
			}
		};
		this._notifierID = Zotero.Notifier.registerObserver(observer, ["item"], "similar-works");
	},

	_onNotify(event, type, ids, extraData = {}) {
		if (this._stopped || type !== "item") {
			return;
		}
		if (event === "trash" || event === "delete") {
			for (const id of ids) {
				var work = this._removeById(id, extraData[id]).catch(e => Zotero.logError(e));
				this._pendingRemovals.add(work);
				work.then(() => this._pendingRemovals.delete(work));
			}
			return;
		}
		if (event === "add" || event === "modify" || event === "index" || event === "refresh") {
			for (const id of ids) {
				this.enqueue(id);
			}
		}
	},

	async _removeById(id, extra = {}) {
		await this.corpus.ready;
		var item = await Zotero.Items.getAsync(id);
		var record = this._itemKeys.get(id);
		var parentID = item?.parentItemID || record?.parentID || extra.parentItemID;
		// A child attachment disappearing changes its parent's text, not the parent existence.
		if (parentID) this.enqueue(parentID);
		var key = item ? this.docKey(item) : record?.key;
		if (!key && extra.libraryID && extra.key) key = extra.libraryID + "/" + extra.key;
		if (key) {
			await this.corpus.removeDoc(key);
		}
		this._itemKeys.delete(id);
	},

	docKey(item) {
		return item.libraryID + "/" + item.key;
	},

	async resolveDocItem(item) {
		if (!item || item.deleted || item.isNote() || item.isFeedItem) {
			return null;
		}
		if (item.isAttachment()) {
			var pid = item.parentItemID;
			if (pid) {
				var parent = await Zotero.Items.getAsync(pid);
				return parent && !parent.deleted ? parent : null;
			}
			return item;
		}
		if (item.isRegularItem()) {
			return item;
		}
		return null;
	},

	enqueue(id) {
		if (this._stopped || this._queued.has(id)) {
			return;
		}
		this._queued.add(id);
		this._queue.push(id);
		if (!this._draining) this._drainPromise = this._drain();
	},

	async enqueueLibrary() {
		try {
			var live = new Set();
			var oldKeys = Array.from(this.corpus.docs.keys());
			var scanned = 0;
			for (var lib of Zotero.Libraries.getAll()) {
				var ids = await Zotero.Items.getAll(lib.id, true, false, true);
				for (const id of ids) {
					if (this._stopped) return;
					if (++scanned % 25 === 0) await swYield(20);
					var item = await Zotero.Items.getAsync(id);
					var target = await this.resolveDocItem(item);
					if (!target) continue;
					live.add(this.docKey(target));
					this._itemKeys.set(id, { key: this.docKey(item), parentID: item.parentItemID });
					if (SWPref("backgroundIndexing", true)) this.enqueue(id);
				}
			}
			for (var key of oldKeys) {
				if (this._stopped) return;
				if (!live.has(key)) await this.corpus.removeDoc(key);
			}
		}
		catch (e) { Zotero.logError(e); }
	},

	async _drain() {
		if (this._draining) {
			return;
		}
		this._draining = true;
		try {
			await this.corpus.ready;
			while (!this._stopped && this._queue.length) {
				var id = this._queue.shift();
				this._queued.delete(id);
				await this._processId(id);
				await swYield(SWPref("indexDelayMs", 1000));
			}
		}
		finally {
			this._draining = false;
		}
	},

	async _processId(id) {
		try {
			var item = await Zotero.Items.getAsync(id);
			if (item) {
				await this.processItem(item);
			}
		}
		catch (e) {
			Zotero.logError(e);
		}
	},

	async ensureNow(item) {
		var target = await this.resolveDocItem(item);
		if (!target) {
			return null;
		}
		await this.processItem(target);
		return target;
	},

	async processItem(item) {
		await this.corpus.ready;
		if (this._stopped || this.corpus.progress.phase !== "ready") return;
		var prior = this._itemKeys.get(item.id);
		if (prior?.parentID && prior.parentID !== item.parentItemID) this.enqueue(prior.parentID);
		this._itemKeys.set(item.id, { key: this.docKey(item), parentID: item.parentItemID });
		if (item.deleted) {
			await this._removeById(item.id);
			return;
		}
		var target = await this.resolveDocItem(item);
		if (!target) return;
		var pending = this._inFlight.get(target.id);
		if (pending) {
			await pending;
			return this.processItem(item);
		}
		var work = this._processDoc(target);
		this._inFlight.set(target.id, work);
		try { await work; }
		finally { this._inFlight.delete(target.id); }
	},

	async _processDoc(item) {
		if (item.isNote() || item.isFeedItem) {
			return;
		}
		if (!item.isRegularItem() && !item.isAttachment()) {
			return;
		}
		var key = this.docKey(item);
		if (item.deleted) {
			await this.corpus.removeDoc(key);
			return;
		}
		var info = await this.extractText(item);
		if (!info) {
			await this.corpus.removeDoc(key);
			return;
		}
		if (item.deleted || this._stopped) {
			await this.corpus.removeDoc(key);
			return;
		}
		await this.corpus.recordSource(key, String(item.getField("dateModified") || ""), info.hash);
		var prev = this.corpus.docs.get(key);
		if (prev && prev.hash === info.hash) {
			return;
		}
		var tf = await this.termFreqInBackground(info.content);
		if (this._stopped) return;
		var weak = info.weak;
		if (!weak && tf.size < SWPref("minFulltextTerms", 25)) {
			var meta = this.metadataText(item);
			if (meta && meta.hash !== info.hash) {
				info = meta;
				tf = SWTokenizer.termFreq(info.content, { minLength: SWPref("minTokenLength", 2) });
			}
			weak = true;
		}
		await this.corpus.upsertDoc(key, info.hash, weak, tf);
	},

	async termFreqInBackground(text) {
		var tf = new Map(), offset = 0, count = 0;
		// Split on word boundaries so English tokens and CJK bigrams keep
		// the same meaning; release the UI thread between small text batches.
		while (!this._stopped && offset < text.length && count < SW_MAX_TOKENS) {
			var end = Math.min(offset + 4000, text.length);
			while (end < text.length && /[\p{L}\p{N}]/u.test(text[end])) end++;
			var tokens = SWTokenizer.tokenize(text.slice(offset, end), { minLength: SWPref("minTokenLength", 2) });
			for (var token of tokens) {
				if (count++ >= SW_MAX_TOKENS) break;
				tf.set(token, (tf.get(token) || 0) + 1);
			}
			offset = end;
			if (offset < text.length) await swYield(20);
		}
		return tf;
	},

	async extractText(item) {
		if (item.isRegularItem()) {
			var atts = [];
			try {
				var best = await item.getBestAttachment();
				if (best && !best.deleted) {
					atts.push(best);
				}
			}
			catch (e) { }
			try {
				var attIds = await item.getAttachments();
				var attItems = await Zotero.Items.getAsync(attIds.slice(0, 8));
				for (var a of attItems) {
					if (a && !a.deleted && !atts.includes(a)) {
						atts.push(a);
					}
				}
			}
			catch (e) { }
			for (var att of atts.slice(0, 5)) {
				var t = await this.attachmentText(att);
				if (t) {
					return t;
				}
			}
			return this.metadataText(item);
		}
		if (item.isAttachment()) {
			return (await this.attachmentText(item)) || this.metadataText(item);
		}
		return null;
	},

	async attachmentText(att) {
		try {
			if (att.deleted) return null;
			this._itemKeys.set(att.id, { key: this.docKey(att), parentID: att.parentItemID });
			var fulltext = Zotero.Fulltext || Zotero.FullText;
			var mime = att.attachmentContentType || "";
			if (!fulltext.isCachedMIMEType(mime) && mime !== "text/plain") {
				return null;
			}

			var path = fulltext.getItemCacheFile(att).path;
			var have = await IOUtils.exists(path);
			if (!have && mime === "text/plain") {
				var indexed = await Zotero.DB.valueQueryAsync("SELECT indexedChars FROM fulltextItems WHERE itemID=?", [att.id]);
				path = indexed > 0 ? await att.getFilePathAsync() : null;
				if (path) have = await IOUtils.exists(path);
			}
			if (!have && SWPref("requestMissingFulltext", false) && !this._requestedFulltext.has(att.id) && await att.fileExists()) {
				this._requestedFulltext.add(att.id);
				await fulltext.queueItem(att);
			}
			if (!have) {
				return null;
			}
			if (have) this._requestedFulltext.delete(att.id);
			var stat = await IOUtils.stat(path);
			var hash = "f" + att.key + ":" + stat.lastModified + ":" + stat.size
				+ (mime === "text/plain" ? ":" + (indexed || 0) : "");
			var parent = att.parentItemID ? await Zotero.Items.getAsync(att.parentItemID) : att;
			if (parent && this.corpus.docs.get(this.docKey(parent))?.hash === hash) {
				return { content: "", hash, weak: false };
			}
			var buf = await IOUtils.read(path, { maxBytes: SWPref("maxTextChars", 1200000) });
			var content = new TextDecoder(mime === "text/plain" ? (att.attachmentCharset || "utf-8") : "utf-8").decode(buf);
			if (mime === "text/plain" && indexed > 0) content = content.slice(0, indexed);
			if (!content || content.trim().length < 40) {
				return null;
			}
			return { content: content, hash, weak: false };
		}
		catch (e) {
			Zotero.logError(e);
			return null;
		}
	},

	metadataText(item) {
		var parts = [];
		var title = item.getField("title");
		if (title) {
			parts.push(title);
		}
		var abs = item.getField("abstractNote");
		if (abs) {
			parts.push(abs);
		}
		try {
			for (var c of item.getCreators()) {
				if (c.lastName) {
					parts.push(c.lastName);
				}
				if (c.firstName) {
					parts.push(c.firstName);
				}
			}
		}
		catch (e) { }
		if (!parts.length) {
			return null;
		}
		var content = parts.join("\n");
		return { content: content, hash: "m" + SWTokenizer.swFnv1a(content), weak: true };
	},

	async shutdown() {
		this._stopped = true;
		if (this._notifierID) {
			Zotero.Notifier.unregisterObserver(this._notifierID);
			this._notifierID = null;
		}
		this._queue = [];
		this._queued.clear();
		await Promise.allSettled(Array.from(this._pendingRemovals));
		await this._scanPromise;
		await this._drainPromise;
		await Promise.allSettled(Array.from(this._inFlight.values()));
	}
};
