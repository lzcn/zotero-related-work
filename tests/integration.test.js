const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

// Small DOM fixture: exercise the actual render callbacks without a browser dependency.
class Element {
	constructor(tag, doc) {
		this.tag = tag; this.ownerDocument = doc; this.children = [];
		this.dataset = {}; this.style = {}; this.listeners = {}; this.isConnected = true;
	}
	append(...nodes) { for (const n of nodes) { n.parent = this; this.children.push(n); } }
	appendChild(n) { this.append(n); }
	replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
	remove() { this.parent.children = this.parent.children.filter(n => n !== this); }
	setAttribute(k, v) { this[k] = v; }
	removeAttribute(k) { delete this[k]; }
	addEventListener(k, fn) { this.listeners[k] = fn; }
	checkValidity() { return Number(this.value) >= 1 && Number(this.value) <= 100; }
	reportValidity() {}
	closest() { return { open: this.open !== false }; }
	querySelectorAll(selector) {
		const match = n => selector.startsWith('.') ? n.className === selector.slice(1)
			: selector.startsWith('input[type=') ? n.tag === 'input' && n.type === selector.slice(11, -1)
			: n.tag === selector;
		return this.children.flatMap(n => [...(match(n) ? [n] : []), ...n.querySelectorAll(selector)]);
	}
	querySelector(s) { return this.querySelectorAll(s)[0] || null; }
}

function harness() {
	const items = new Map(), prefs = new Map([['similarworks.minFulltextTerms', 1]]);
	const files = new Map(), queued = [], errors = [], selected = [];
	const doc = { createElementNS(ns, tag) { assert.equal(ns, "http://www.w3.org/1999/xhtml"); return new Element(tag, doc); },
		l10n: { async formatValue() { return ''; } },
		defaultView: { ZoteroPane: { selectItem(id) { selected.push(id); } } } };
	const Zotero = {
		Prefs: { get: k => prefs.get(k), set: (k, v) => prefs.set(k, v) },
		Promise: { delay: async () => {} }, logError: e => errors.push(e),
		Items: { async getAsync(id) { return Array.isArray(id) ? id.map(i => items.get(i)) : items.get(id); },
			async getByLibraryAndKeyAsync(lib, key) { return [...items.values()].find(i => i.libraryID === lib && i.key === key); },
			async getAll(lib) { return [...items.values()].filter(i => i.libraryID === lib && !i.deleted && !i.parentItemID).map(i => i.id); } },
		Libraries: { getAll: () => [{ id: 1 }] },
		Fulltext: { isCachedMIMEType: mime => mime === 'application/pdf',
			getItemCacheFile: att => ({ path: '/cache/' + att.key }),
			async queueItem(att) { queued.push(att.id); } },
		DB: { valueQueryAsync: async () => 50 },
		ItemPaneManager: { registerSection: opts => { Zotero.hooks = opts; return 'namespaced-pane'; },
			unregisterSection: id => { Zotero.unregistered = id; } }
	};
	const context = vm.createContext({ Zotero, SWPlugin: { id: 'test' }, TextDecoder, setTimeout, clearTimeout,
		IOUtils: { exists: async p => files.has(p), read: async p => new TextEncoder().encode(files.get(p)),
			stat: async p => ({ lastModified: 1, size: files.get(p).length }) } });
	for (const file of ['stemmer', 'tokenizer', 'corpus', 'indexer', 'section']) {
		vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/' + file + '.js'), 'utf8'), context);
	}
	const corpus = vm.runInContext('new SWCorpus()', context);
	corpus._ready = Promise.resolve(); corpus.progress.phase = 'ready';
	context.SWIndexer.corpus = corpus;
	function item(id, title, parentItemID, libraryID = 1) {
		const it = { id, key: 'KEY' + id, libraryID, parentItemID, deleted: false,
			isFeedItem: false, isNote: () => false, isAttachment: () => !!parentItemID,
			isRegularItem: () => !parentItemID, getField: field => field === 'title' ? title : '',
			getCreators: () => [], getBestAttachment: async () => [...items.values()].find(a => a.parentItemID === id && !a.deleted),
			getAttachments: () => [...items.values()].filter(a => a.parentItemID === id && !a.deleted).map(a => a.id),
			attachmentContentType: 'application/pdf', fileExists: async () => true };
		items.set(id, it); return it;
	}
	return { ...context, context, corpus, item, doc, items, files, prefs, queued, errors, selected,
		body: new Element('div', doc) };
}

test('attachment updates index the parent once; cache replaces metadata; trash keeps parent', async () => {
	const h = harness(), parent = h.item(1, 'neural machine learning'), att = h.item(2, 'attachment', 1);
	await h.SWIndexer.processItem(att);
	assert.equal(h.corpus.docs.get('1/KEY1').weak, true);
	assert.equal(h.corpus.docs.has('1/KEY2'), false);
	assert.deepEqual(h.queued, [], 'reuse existing Zotero index without scheduling PDF extraction');
	await h.SWIndexer.processItem(parent);
	assert.deepEqual(h.queued, []);
	h.files.set('/cache/KEY2', 'neural network learning optimization parameters '.repeat(4));
	h.SWIndexer._onNotify('index', 'item', [2]);
	await h.SWIndexer._drainPromise;
	assert.equal(h.corpus.docs.get('1/KEY1').weak, false);
	att.deleted = true;
	await h.SWIndexer._removeById(2);
	await h.SWIndexer._drainPromise;
	assert.equal(h.corpus.docs.get('1/KEY1').weak, true);
	assert.equal(h.corpus.n, 1);
	assert.equal(h.errors.length, 0);
});

test('permanent deletion uses notifier identity; startup prunes stale and child vectors', async () => {
	const h = harness(); h.item(1, 'machine learning');
	await h.corpus.upsertDoc('1/GONE', 'x', false, new Map([['machine', 1]]));
	await h.SWIndexer._removeById(99, { libraryID: 1, key: 'GONE' });
	assert.equal(h.corpus.n, 0);
	await h.corpus.upsertDoc('1/STALE', 'x', false, new Map([['machine', 1]]));
	h.prefs.set('similarworks.backgroundIndexing', false);
	await h.SWIndexer.enqueueLibrary();
	assert.equal(h.corpus.n, 0);
});

test('sidebar ranks top K in same library, preserves rows during indexing, and navigates each row', async () => {
	const h = harness();
	const query = h.item(1, 'neural machine learning'), a = h.item(2, 'neural machine learning'),
		b = h.item(3, 'machine learning algorithm'), other = h.item(4, 'neural machine learning', null, 2);
	for (const it of [query, a, b, other]) await h.SWIndexer.processItem(it);
	h.prefs.set('similarworks.recommendationCount', 2);
	h.SWIndexer._draining = true;
	let summary;
	const props = { body: h.body, item: query, tabType: 'library', setSectionSummary: s => summary = s };
	await h.SWSection.renderBody(props, true);
	const rows = h.body.querySelectorAll('.sw-row');
	assert.equal(rows.length, 2);
	assert.equal(summary, '2');
	assert.doesNotMatch(h.body.querySelector('.sw-status').textContent, /index|comput/i);
	rows[0].listeners.click(); rows[1].listeners.click();
	assert.deepEqual(h.selected, [2, 3]);
	assert.equal(rows[0].title, undefined, 'recommendations do not expose technical hover text');
	assert.equal(h.SWSection._active.length, 1);
	await h.SWSection.renderBody(props, true);
	assert.equal(h.SWSection._active.length, 1, 'refresh does not duplicate bodies');
	assert.equal(h.body.querySelector('input[type=number]'), null);
	assert.equal(h.body.querySelector('input[type=checkbox]'), null);
	h.prefs.set('similarworks.recommendationCount', 1);
	await h.SWSection.renderBody(props, true);
	assert.equal(h.body.querySelectorAll('.sw-row').length, 1);
	h.prefs.set('similarworks.allowMetadataOnlyRecommendations', false);
	await h.SWSection.renderBody(props, true);
	assert.equal(h.body.querySelectorAll('.sw-row').length, 0);
	assert.equal(h.errors.length, 0);
});

test('switching items during a delayed render discards previous results; closed pane is lazy', async () => {
	const h = harness(), q = h.item(1, 'machine learning'), a = h.item(2, 'machine learning'),
		b = h.item(3, 'cooking tomato pasta');
	for (const it of [q, a, b]) await h.SWIndexer.processItem(it);
	let release, calls = 0;
	const ensure = h.SWIndexer.ensureNow.bind(h.SWIndexer);
	h.SWIndexer.ensureNow = async it => {
		calls++;
		if (it === q) await new Promise(resolve => release = resolve);
		return ensure(it);
	};
	const pending = h.SWSection.renderBody({ body: h.body, item: q }, true);
	await new Promise(resolve => setImmediate(resolve));
	await h.SWSection.renderBody({ body: h.body, item: b }, true);
	release(); await pending;
	assert.equal(h.body['aria-busy'], 'false');
	assert.equal(h.body.querySelector('.sw-computation-progress').hidden, true);
	assert.match(h.body.querySelector('.sw-status').textContent, /No similar/);
	assert.equal(h.body.querySelectorAll('.sw-row').length, 0);
	h.body.open = false;
	await h.SWSection.renderBody({ body: h.body, item: a }, true);
	assert.equal(calls, 2);
});

test('background updates keep existing rows until explicit refresh finishes', async () => {
	const h = harness(), q = h.item(1, 'machine learning'), a = h.item(2, 'machine learning');
	for (const it of [q, a]) await h.SWIndexer.processItem(it);
	const props = { body: h.body, item: q };
	await h.SWSection.renderBody(props, true);
	const original = h.body.querySelector('.sw-row');
	await h.SWIndexer.processItem(h.item(3, 'machine learning'));
	assert.equal(h.body.querySelector('.sw-row'), original, 'background vector updates leave the current results unchanged');
	let release;
	const ensure = h.SWIndexer.ensureNow.bind(h.SWIndexer);
	h.SWIndexer.ensureNow = async it => { await new Promise(resolve => release = resolve); return ensure(it); };
	const pending = h.SWSection.renderBody(props, true);
	await new Promise(resolve => setImmediate(resolve));
	assert.equal(h.body.querySelector('.sw-row'), original, 'no intermediate clear while computing');
	assert.match(h.body.querySelector('.sw-status').textContent, /Computing/);
	assert.equal(h.body['aria-busy'], 'true');
	assert.equal(h.body.querySelector('.sw-computation-progress').hidden, false);
	const computeToken = h.body._swToken;
	await h.SWSection.renderBody(props);
	assert.equal(h.body._swToken, computeToken, 'progress refresh cannot cancel a manual calculation');
	release(); await pending;
	assert.equal(h.body['aria-busy'], 'false');
	assert.equal(h.body.querySelector('.sw-computation-progress').hidden, true);
	assert.match(h.body.querySelector('.sw-status').textContent, /Updated/);
	h.SWSection.shutdown();
});

test('each manual refresh computes online; background progress never computes scores', async () => {
	const h = harness(), q = h.item(1, 'machine learning'), a = h.item(2, 'machine learning');
	for (const it of [q, a]) await h.SWIndexer.processItem(it);
	const props = { body: h.body, item: q };
	let calculations = 0;
	const score = h.corpus.scoreTopKAsync.bind(h.corpus);
	h.corpus.scoreTopKAsync = (...args) => { calculations++; return score(...args); };
	await h.SWSection.renderBody(props);
	assert.equal(calculations, 0);
	assert.equal(h.body.querySelectorAll('.sw-row').length, 0);
	assert.equal(h.body.querySelector('.sw-progress'), null);
	await h.SWSection.renderBody(props, true);
	assert.equal(calculations, 1);
	await h.SWSection.renderBody(props, true);
	assert.equal(calculations, 2, 'every explicit refresh computes scores without a persisted matrix');
	await h.SWSection.renderBody(props);
	assert.equal(calculations, 2);
	const b = h.item(3, 'machine learning algorithm'); await h.SWIndexer.processItem(b);
	await h.SWSection.renderBody(props, true);
	assert.equal(calculations, 3, 'refresh includes newly built vectors');
	assert.equal(h.body.querySelectorAll('.sw-row').length, 2);
});

test('cooperative tokenization keeps word and CJK boundaries; unchanged PDFs skip reads', async () => {
	const h = harness();
	const text = ('machine learning 参数优化 neural-network 数据分析 '.repeat(200));
	const batched = await h.SWIndexer.termFreqInBackground(text);
	const direct = h.SWTokenizer.termFreq(text, { minLength: 2 });
	assert.deepEqual([...batched], [...direct]);
	const q = h.item(1, 'machine learning');
	h.item(2, 'PDF', 1);
	h.files.set('/cache/KEY2', text);
	let reads = 0; const read = h.context.IOUtils.read;
	h.context.IOUtils.read = (...args) => { reads++; return read(...args); };
	await h.SWIndexer.processItem(q); await h.SWIndexer.processItem(q);
	assert.equal(reads, 1, 'matching cache fingerprint avoids repeated fulltext reads');
	const asyncScores = await h.corpus.scoreTopKAsync('1/KEY1', 10);
	assert.deepEqual(asyncScores, h.corpus.scoreTopK('1/KEY1', 10));
});

test('SQLite persists source modification times and vector revisions without score caches', async () => {
 const h = harness(), timestamps = new Map(), sources = new Map(), sqls = [];
 let revision = 0, transactions = 0;
 h.corpus._db = {
  async executeTransaction(fn) {transactions++; await fn();},
  async execute(sql,args) {
   sqls.push(sql);
   if(sql.includes("'corpusRevision', ?")) revision = Number(args[0]);
   if(sql.startsWith('INSERT OR REPLACE INTO doc_updates')) timestamps.set(args[0],args[1]);
   if(sql.startsWith('INSERT OR REPLACE INTO source_updates')) sources.set(args[0],args.slice(1));
   return [];
  }
 };
 await h.corpus.recordSource('1/A','2026-10-02 01:00:00','source-v1');
 await h.corpus.upsertDoc('1/A','source-v1',false,new Map([['learning',2]]));
 assert.equal(transactions,1); assert.equal(revision,1); assert.ok(timestamps.get('1/A') > 0);
 assert.equal(sources.get('1/A')[0],'2026-10-02 01:00:00');
 const count = sqls.length;
 await h.corpus.recordSource('1/A','2026-10-02 01:00:00','source-v1');
 assert.equal(sqls.length,count,'unchanged source does not cause another database write');
 await h.corpus.upsertDoc('1/A','source-v2',false,new Map([['learning',3]]));
 assert.equal(revision,2); assert.ok(sqls.every(sql => !sql.includes('recommendations')));
});

test('K validation, identical document scores, and registered pane cleanup', async () => {
	const h = harness();
	for (const [v, expected] of [[0, 10], ['bad', 10], [999, 100], [2.8, 2], ['5', 5]]) {
		assert.equal(h.SWResultLimit(v), expected);
	}
	await h.corpus.upsertDoc('1/A', 'a', false, new Map([['learning', 3]]));
	await h.corpus.upsertDoc('1/B', 'b', true, new Map([['learning', 3]]));
	assert.equal(h.corpus.scoreTopK('1/A', 1)[0].score, 1);
	assert.equal(h.corpus.scoreTopK('1/A', -1).length, 0);
	assert.equal(h.corpus.scoreTopK('1/A', 5, (_, d) => !d.weak).length, 0);
	h.SWSection.register('file:///test/'); h.SWSection.shutdown();
	assert.equal(h.Zotero.unregistered, 'namespaced-pane');
});

test('TXT uses only Zotero-indexed characters and concurrent attachment renders stay canonical', async () => {
	const h = harness(), parent = h.item(1, 'machine learning'), att = h.item(2, 'text file', 1);
	att.attachmentContentType = 'text/plain';
	att.getFilePathAsync = async () => '/plain.txt';
	h.files.set('/plain.txt', 'machine neural learning '.repeat(10) + 'unindexedending');
	const text = await h.SWIndexer.attachmentText(att);
	assert.equal(text.content.length, 50);
	assert.equal(text.content.includes('unindexedending'), false);
	await Promise.all([h.SWIndexer.processItem(att), h.SWIndexer.processItem(parent)]);
	assert.equal(h.corpus.n, 1);
	assert.equal(h.corpus.docs.get('1/KEY1').weak, false);
	assert.equal(h.errors.length, 0);
});

test('bootstrap loads scripts into a scope with Zotero globals and closes SQLite on shutdown', async () => {
	const h = harness();
	h.prefs.set('similarworks.backgroundIndexing', false);
	let closed = false;
	h.Zotero.DataDirectory = { dir: '/data' };
	h.Zotero.initializationPromise = Promise.resolve();
	h.Zotero.getMainWindows = () => [];
	h.Zotero.Notifier = { registerObserver: () => 1, unregisterObserver: () => {} };
	h.IOUtils.makeDirectory = async () => {};
	const env = {
		Zotero: h.Zotero, IOUtils: h.IOUtils, PathUtils: { join: (...parts) => parts.join('/') },
		TextDecoder, setTimeout, clearTimeout,
		ChromeUtils: { importESModule: () => ({ AddonManager: { getAddonByID: async () => null }, Sqlite: { openConnection: async () => ({
			execute: async sql => sql.includes('COUNT(*)') ? [{ getResultByName: () => 0 }] : [],
			close: async () => { closed = true; }
		}) } }) }
	};
	env.Services = { scriptloader: { loadSubScript(uri, scope) {
		if (!vm.isContext(scope)) vm.createContext(scope);
		vm.runInContext(fs.readFileSync(path.join(__dirname, '..', uri), 'utf8'), scope);
	} } };
	const context = vm.createContext(env);
	vm.runInContext(fs.readFileSync(path.join(__dirname, '../bootstrap.js'), 'utf8'), context);
	await context.startup({ id: 'test', version: '0.2.0', rootURI: '' });
	await context.SWScope.SWIndexer.corpus.ready;
	assert.equal(context.SWScope.SWIndexer.corpus.progress.phase, 'ready');
	assert.equal(context.SWScope.SWTokenizer.termFreq('machine learning').size, 2);
	assert.equal(context.SWScope.SWSection._registered, 'namespaced-pane');
	await context.shutdown();
	assert.equal(closed, true);
	assert.equal(h.errors.length, 0);
});

test('Fluent section translations preserve native child controls in both locales', () => {
	for (const locale of ['en-US', 'zh-CN']) {
		const ftl = fs.readFileSync(path.join(__dirname, '../locale', locale, 'similar-works.ftl'), 'utf8');
		// Zotero translates the collapsible-section itself. A message value would
		// replace its children, so the header must translate only its label attribute.
		assert.match(ftl, /^similarworks-header =\s*\n\s+\.label = .+$/m);
		assert.match(ftl, /^similarworks-sidenav =\s*\n\s+\.tooltiptext = .+$/m);
		assert.match(ftl, /^similarworks-refresh =\s*\n\s+\.tooltiptext = .+$/m);
	}
});

 test('refresh gives immediate feedback and resumes after database loading', async () => {
 const h = harness(), q = h.item(1, 'machine learning'), a = h.item(2, 'machine learning');
 for (const it of [q,a]) await h.SWIndexer.processItem(it);
 let finishLoading;
 h.corpus.progress.phase = 'loading';
 h.corpus._ready = new Promise(resolve => finishLoading = () => {h.corpus.progress.phase = 'ready';resolve();});
 const pending = h.SWSection.renderBody({body:h.body,item:q},true);
 assert.match(h.body.querySelector('.sw-status').textContent,/Computing/);
 assert.equal(h.body['aria-busy'],'true');
 await new Promise(resolve => setImmediate(resolve));
 assert.equal(h.body.querySelectorAll('.sw-row').length,0);
 finishLoading(); await pending;
 assert.equal(h.body.querySelectorAll('.sw-row').length,1);
 assert.match(h.body.querySelector('.sw-status').textContent,/Updated/);
 assert.equal(h.body['aria-busy'],'false');
 assert.equal(h.body.querySelector('.sw-progress'),null);
 });

test('online similarity reports completed candidate progress and obeys cancellation', async () => {
 const h = harness();
 for (let id=1;id<=4;id++) await h.SWIndexer.processItem(h.item(id,'machine learning algorithm'));
 const progress = [];
 const matches = await h.corpus.scoreTopKAsync('1/KEY1',10,()=>true,()=>false,p=>progress.push(p));
 assert.equal(matches.length,3);
 assert.deepEqual(JSON.parse(JSON.stringify(progress[0])),{done:0,total:3});
 assert.deepEqual(JSON.parse(JSON.stringify(progress.at(-1))),{done:3,total:3});
 assert.equal((await h.corpus.scoreTopKAsync('1/KEY1',10,()=>true,()=>true)).length,0);
});
