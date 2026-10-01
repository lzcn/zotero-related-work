var SW_SCHEMA_VERSION = 1;

function swYield(ms) {
	if (typeof Zotero !== "undefined" && Zotero.Promise && Zotero.Promise.delay) {
		return Zotero.Promise.delay(ms || 0);
	}
	return new Promise(resolve => setTimeout(resolve, ms || 0));
}

var SWCorpus = class {
	constructor() {
		this.docs = new Map();
		this.df = new Map();
		this.n = 0;
		this.dfVersion = 0;
		this.revision = 0;
		this.lastChangedAt = 0;
		this._sourceStates = new Map();
		this._norms = new Map();
		this._normsVersion = -1;
		this._db = null;
		this._dbPath = null;
		this.progress = { phase: "idle", done: 0, total: 0 };
		this._ready = null;
		this._readyResolved = false;
		this._readyListeners = new Set();
	}

	get ready() {
		if (!this._ready) {
			this._ready = this._openAndLoad();
		}
		return this._ready;
	}

	onReady(fn) {
		if (this._readyResolved) {
			fn();
			return () => { };
		}
		this._readyListeners.add(fn);
		return () => this._readyListeners.delete(fn);
	}

	async _openAndLoad() {
		try {
			var dataDir = Zotero.DataDirectory.dir;
			var dir = PathUtils.join(dataDir, "similar-works");
			await IOUtils.makeDirectory(dir, { ignoreExisting: true });
			this._dbPath = PathUtils.join(dir, "similarity.sqlite");
			var { Sqlite } = ChromeUtils.importESModule("resource://gre/modules/Sqlite.sys.mjs");
			this._db = await Sqlite.openConnection({ path: this._dbPath });
			await this._db.execute("PRAGMA journal_mode = WAL");
			await this._ensureSchema();
			await this._loadAll();
			this._readyResolved = true;
			for (var fn of Array.from(this._readyListeners)) {
				try { fn(); } catch (e) { Zotero.logError(e); }
			}
			this._readyListeners.clear();
		}
		catch (e) {
			Zotero.logError("[similar-works] corpus init failed: " + (e && e.message ? e.message : e));
			this.progress = { phase: "error", done: 0, total: 0, error: String(e && e.message ? e.message : e) };
		}
	}

	async _ensureSchema() {
		await this._db.execute("CREATE TABLE IF NOT EXISTS docs (key TEXT PRIMARY KEY, hash TEXT NOT NULL, weak INTEGER NOT NULL DEFAULT 0, tf TEXT NOT NULL)");
		await this._db.execute("CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)");
		await this._db.execute("CREATE TABLE IF NOT EXISTS doc_updates (key TEXT PRIMARY KEY, updatedAt INTEGER NOT NULL)");
		await this._db.execute("CREATE TABLE IF NOT EXISTS source_updates (key TEXT PRIMARY KEY, itemModifiedAt TEXT NOT NULL, sourceHash TEXT NOT NULL, checkedAt INTEGER NOT NULL)");
		var revisions = await this._db.execute("SELECT v FROM meta WHERE k = 'corpusRevision'");
		this.revision = revisions.length ? Number(revisions[0].getResultByName("v")) : 0;
		var rows = await this._db.execute("SELECT v FROM meta WHERE k = 'schemaVersion'");
		var version = rows.length ? parseInt(rows[0].getResultByName("v")) : 0;
		if (version !== SW_SCHEMA_VERSION) {
			await this._db.execute("DROP TABLE IF EXISTS docs");
			await this._db.execute("CREATE TABLE docs (key TEXT PRIMARY KEY, hash TEXT NOT NULL, weak INTEGER NOT NULL DEFAULT 0, tf TEXT NOT NULL)");
		}
		await this._db.execute("INSERT OR REPLACE INTO meta (k, v) VALUES ('schemaVersion', '" + SW_SCHEMA_VERSION + "')");
	}

	async _loadAll() {
		var countRows = await this._db.execute("SELECT COUNT(*) AS c FROM docs");
		var total = countRows.length ? countRows[0].getResultByName("c") : 0;
		this.progress = { phase: "loading", done: 0, total: total };
		var offset = 0;
		var chunk = 100;
		while (true) {
			var rows = await this._db.execute("SELECT key, hash, weak, tf FROM docs ORDER BY key LIMIT " + chunk + " OFFSET " + offset);
			if (!rows.length) {
				break;
			}
			for (var row of rows) {
				var key = row.getResultByName("key");
				var tf;
				try {
					var obj = JSON.parse(row.getResultByName("tf"));
					tf = new Map(Object.entries(obj));
				}
				catch (e) {
					continue;
				}
				var doc = {
					hash: row.getResultByName("hash"),
					weak: !!parseInt(row.getResultByName("weak")),
					tf: tf
				};
				this._memInsert(key, doc, false);
			}
			offset += rows.length;
			this.progress = { phase: "loading", done: offset, total: total };
			await swYield(20);
		}
		this.progress = { phase: "ready", done: this.n, total: this.n };
	}

	_memInsert(key, doc, bump) {
		this.docs.set(key, doc);
		this.n++;
		for (var t of doc.tf.keys()) {
			this.df.set(t, (this.df.get(t) || 0) + 1);
		}
		if (bump) {
			this.dfVersion++;
		}
	}

	_memRemove(key) {
		var doc = this.docs.get(key);
		if (!doc) {
			return false;
		}
		this.docs.delete(key);
		this._norms.delete(key);
		this.n--;
		for (var t of doc.tf.keys()) {
			var c = this.df.get(t) || 0;
			if (c <= 1) {
				this.df.delete(t);
			}
			else {
				this.df.set(t, c - 1);
			}
		}
		this.dfVersion++;
		return true;
	}

	async upsertDoc(key, hash, weak, tf) {
		var prev = this.docs.get(key);
		if (prev && prev.hash === hash) {
			return false;
		}
		if (prev) {
			this._memRemove(key);
		}
		this._memInsert(key, { hash: hash, weak: weak, tf: tf }, true);
		this.revision++;
		this.lastChangedAt = Date.now();
		if (this._db) {
			var obj = {};
			for (var [t, c] of tf) {
				obj[t] = c;
			}
			try {
				await this._persistChange("INSERT OR REPLACE INTO docs (key, hash, weak, tf) VALUES (?, ?, ?, ?)", [key, hash, weak ? 1 : 0, JSON.stringify(obj)], key, false);
			}
			catch (e) {
				Zotero.logError("[similar-works] persist doc failed: " + e);
			}
		}
		return true;
	}

	async removeDoc(key) {
		if (!this._memRemove(key)) {
			return false;
		}
		this.revision++;
		this.lastChangedAt = Date.now();
		if (this._db) {
			try {
				await this._persistChange("DELETE FROM docs WHERE key = ?", [key], key, true);
			}
			catch (e) {
				Zotero.logError(e);
			}
		}
		return true;
	}

	async _persistChange(sql, params, key, removed, revision = this.revision) {
		await this._db.executeTransaction(async () => {
			await this._db.execute(sql, params);
			await this._db.execute("INSERT OR REPLACE INTO meta (k, v) VALUES ('corpusRevision', ?)", [String(revision)]);
			if (removed) {
				await this._db.execute("DELETE FROM doc_updates WHERE key = ?", [key]);
				await this._db.execute("DELETE FROM source_updates WHERE key = ?", [key]);
				this._sourceStates.delete(key);
			}
			else await this._db.execute("INSERT OR REPLACE INTO doc_updates (key, updatedAt) VALUES (?, ?)", [key, Date.now()]);
		});
	}

	async recordSource(key, modifiedAt, hash) {
		var state = JSON.stringify([modifiedAt, hash]);
		if (this._sourceStates.get(key) === state) return;
		if (this._db) {
			try { await this._db.execute("INSERT OR REPLACE INTO source_updates (key, itemModifiedAt, sourceHash, checkedAt) VALUES (?, ?, ?, ?)", [key, modifiedAt, hash, Date.now()]); }
			catch (e) { Zotero.logError(e); return; }
		}
		this._sourceStates.set(key, state);
	}

	idf(term) {
		if (!this.n) {
			return 1;
		}
		var d = this.df.get(term) || 0;
		return Math.log((this.n + 1) / (d + 1)) + 1;
	}

	_norm(key, tf) {
		if (this._normsVersion !== this.dfVersion) {
			this._norms.clear();
			this._normsVersion = this.dfVersion;
		}
		var cached = this._norms.get(key);
		if (cached !== undefined) {
			return cached;
		}
		var sum = 0;
		for (var [t, c] of tf) {
			var w = (1 + Math.log(c)) * this.idf(t);
			sum += w * w;
		}
		var norm = Math.sqrt(sum);
		this._norms.set(key, norm);
		return norm;
	}

	*_scoreCandidates(queryKey, filter) {
		var q = this.docs.get(queryKey);
		if (!q || this.n < 2) return;
		var qn = this._norm(queryKey, q.tf);
		if (!qn) {
			return [];
		}
		for (var [key, d] of this.docs) {
			if (key === queryKey) {
				continue;
			}
			if (filter && !filter(key, d)) {
				continue;
			}
			var small;
			var large;
			if (q.tf.size <= d.tf.size) {
				small = q.tf;
				large = d.tf;
			}
			else {
				small = d.tf;
				large = q.tf;
			}
			var dot = 0;
			for (var [t, c] of small) {
				var c2 = large.get(t);
				if (c2) {
					var w1 = (1 + Math.log(c)) * this.idf(t);
					var w2 = (1 + Math.log(c2)) * this.idf(t);
					dot += w1 * w2;
				}
			}
			if (dot <= 0) {
				yield null;
				continue;
			}
			var dn = this._norm(key, d.tf);
			if (!dn) {
				continue;
			}
			yield [key, Math.min(1, Math.max(0, dot / (qn * dn)))];
		}
	}

	_rankResults(results, k) {
		results.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
		return results.slice(0, k).map(r => ({ key: r[0], score: r[1], weak: this.docs.get(r[0]).weak }));
	}

	scoreTopK(queryKey, k, filter) {
		k = Math.floor(Number(k));
		if (!Number.isFinite(k) || k < 1) return [];
		return this._rankResults(Array.from(this._scoreCandidates(queryKey, filter)).filter(Boolean), k);
	}

	async scoreTopKAsync(queryKey, k, filter, cancelled = () => false, onProgress = () => {}, restMs = 20) {
		k = Math.floor(Number(k));
		if (!Number.isFinite(k) || k < 1) return [];
		// Freeze the vocabulary statistics while yielding, so background updates
		// cannot mix different IDF versions in one recommendation list.
		var snapshot = Object.create(this);
		snapshot.docs = new Map(this.docs);
		snapshot.df = new Map(this.df);
		snapshot.n = this.n;
		snapshot.dfVersion = this.dfVersion;
		snapshot._normsVersion = this._normsVersion;
		snapshot._norms = new Map(this._norms);
		var total = 0;
		for (var [key, doc] of snapshot.docs) if (key !== queryKey && (!filter || filter(key, doc))) total++;
		var done = 0;
		onProgress({ done: 0, total });
		var results = [], sliceStarted = Date.now();
		for (var result of snapshot._scoreCandidates(queryKey, filter)) {
			if (cancelled()) return [];
			done++;
			if (result) results.push(result);
			if (Date.now() - sliceStarted >= 8) {
				onProgress({ done: Math.min(done, total), total });
				await swYield(restMs);
				sliceStarted = Date.now();
			}
		}
		if (cancelled()) return [];
		onProgress({ done: total, total });
		if (this.dfVersion === snapshot.dfVersion) {
			this._norms = snapshot._norms;
			this._normsVersion = snapshot._normsVersion;
		}
		return snapshot._rankResults(results, k);
	}

	async close() {
		if (this._db) {
			var db = this._db;
			this._db = null;
			try { await db.close(); } catch (e) { }
		}
	}
};

if (typeof module !== "undefined" && module.exports) {
	module.exports = { SWCorpus: SWCorpus, swYield: swYield };
}
