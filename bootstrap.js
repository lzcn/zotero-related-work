var SWScope = {
  Zotero,
  Services,
  ChromeUtils,
  IOUtils,
  PathUtils,
  TextDecoder,
  setTimeout,
  clearTimeout,
  SWPlugin: { id: null, version: null, rootURI: null },
};

var SWReady = false;
var SWGeneration = 0;
var SWStartupPromise = null;
var SWShutdownPromise = null;

async function startup(data) {
  if (SWStartupPromise) return SWStartupPromise;
  var token = ++SWGeneration;
  SWStartupPromise = start(data, token);
  return SWStartupPromise;
}

async function start({ id, version, rootURI }, token) {
  try {
    SWScope.SWPlugin = { id, version, rootURI };
    var files = [
      "stemmer.js",
      "tokenizer.js",
      "search.js",
      "corpus.js",
      "indexer.js",
      "section.js",
    ];
    for (var file of files)
      Services.scriptloader.loadSubScript(rootURI + "src/" + file, SWScope);
    await Zotero.initializationPromise;
    if (token !== SWGeneration) return;
    await SWScope.SWIndexer.start();
    await SWScope.SWIndexer.corpus.ready;
    if (token !== SWGeneration) return;
    if (SWScope.SWIndexer.corpus.progress.phase === "error") {
      throw new Error(SWScope.SWIndexer.corpus.progress.error);
    }
    SWScope.SWSection.register(rootURI);
    SWReady = true;
    for (var win of Zotero.getMainWindows())
      SWScope.SWSection.injectWindow(win);
  } catch (error) {
    SWReady = false;
    Zotero.logError(new Error("[similar-works] startup failed: " + error));
    await releaseResources();
  }
}

async function releaseResources() {
  if (SWScope.SWSection) SWScope.SWSection.shutdown();
  if (SWScope.SWIndexer) await SWScope.SWIndexer.shutdown();
  if (SWScope.SWIndexer?.corpus) await SWScope.SWIndexer.corpus.close();
}

async function shutdown(data, reason) {
  SWReady = false;
  ++SWGeneration;
  SWScope.SWSection?.shutdown();
  SWScope.SWIndexer?.requestStop?.();
  // Zotero owns process-wide storage teardown. Do not hold quit open for scans.
  if (typeof APP_SHUTDOWN !== "undefined" && reason === APP_SHUTDOWN) return;
  if (SWShutdownPromise) return SWShutdownPromise;
  SWShutdownPromise = (async () => {
    SWReady = false;
    ++SWGeneration;
    await SWStartupPromise;
    try {
      await releaseResources();
    } catch (error) {
      Zotero.logError(error);
    }
  })();
  return SWShutdownPromise;
}

function onMainWindowLoad({ window }) {
  try {
    if (SWReady) SWScope.SWSection.injectWindow(window);
  } catch (e) {
    Zotero.logError(new Error("[similar-works] onMainWindowLoad failed: " + e));
  }
}

function onMainWindowUnload({ window }) {
  try {
    SWScope.SWSection.removeWindow(window);
  } catch (e) {}
}

function install() {}

function uninstall() {}
