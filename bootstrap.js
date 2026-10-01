var SWScope = {
	Zotero, Services, ChromeUtils, IOUtils, PathUtils, TextDecoder, setTimeout, clearTimeout,
	SWPlugin: { id: null, version: null, rootURI: null }
};

async function startup({ id, version, rootURI }, reason) {
	try {
		SWScope.SWPlugin.id = id;
		SWScope.SWPlugin.version = version;
		SWScope.SWPlugin.rootURI = rootURI;
		var loader = Services.scriptloader;
		var files = ["migration.js", "stemmer.js", "tokenizer.js", "corpus.js", "indexer.js", "section.js"];
		for (var f of files) {
			loader.loadSubScript(rootURI + "src/" + f, SWScope);
		}
		await Zotero.initializationPromise;
		await SWScope.SWMigration.prepare();
		await SWScope.SWIndexer.start();
		for (var win of Zotero.getMainWindows()) {
			SWScope.SWSection.injectWindow(win);
		}
		SWScope.SWSection.register(rootURI);
	}
	catch (e) {
		Zotero.logError("[similar-works] startup failed: " + e);
	}
}

async function shutdown() {
	try {
		if (SWScope.SWSection) SWScope.SWSection.shutdown();
		if (SWScope.SWIndexer) {
			await SWScope.SWIndexer.shutdown();
			if (SWScope.SWIndexer.corpus) await SWScope.SWIndexer.corpus.close();
		}
	}
	catch (e) { Zotero.logError(e); }
}

function onMainWindowLoad({ window }) {
	try {
		SWScope.SWSection.injectWindow(window);
	}
	catch (e) {
		Zotero.logError("[similar-works] onMainWindowLoad failed: " + e);
	}
}

function onMainWindowUnload({ window }) {
	try {
		SWScope.SWSection.removeWindow(window);
	}
	catch (e) { }
}

function install() { }

function uninstall() { }
