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
var SWQuitObserver = null;

function stopWork() {
  SWReady = false;
  ++SWGeneration;
  SWScope.SWSection?.shutdown();
  SWScope.SWIndexer?.requestStop?.();
}

function removeQuitObserver() {
  if (!SWQuitObserver) return;
  Services.obs?.removeObserver(SWQuitObserver, "quit-application-granted");
  SWQuitObserver = null;
}

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
    SWQuitObserver = {
      observe() {
        stopWork();
        void SWScope.SWIndexer?.corpus
          ?.close()
          .catch((e) => Zotero.logError(e));
      },
    };
    Services.obs?.addObserver(SWQuitObserver, "quit-application-granted");
    await Zotero.initializationPromise;
    if (token !== SWGeneration) return;
    await SWScope.SWIndexer.start();
    if (token !== SWGeneration) return;
    SWScope.SWSection.register(rootURI);
    SWReady = true;
    for (var win of Zotero.getMainWindows())
      SWScope.SWSection.injectWindow(win);
    // Storage preparation must not block installation or hide the sidebar.
    void SWScope.SWIndexer.corpus.ready.catch((error) =>
      Zotero.logError(error),
    );
  } catch (error) {
    SWReady = false;
    Zotero.logError(new Error("[similar-works] startup failed: " + error));
    await releaseResources();
  }
}

async function releaseResources() {
  removeQuitObserver();
  if (SWScope.SWSection) SWScope.SWSection.shutdown();
  if (SWScope.SWIndexer) await SWScope.SWIndexer.shutdown();
  if (SWScope.SWIndexer?.corpus) await SWScope.SWIndexer.corpus.close();
}

async function shutdown(data, reason) {
  stopWork();
  removeQuitObserver();
  // Our independent SQLite connection blocks profile shutdown until explicitly closed.
  // Do not await Zotero startup or its library scans while the application is quitting.
  if (typeof APP_SHUTDOWN !== "undefined" && reason === APP_SHUTDOWN) {
    await SWScope.SWIndexer?.corpus?.close();
    return;
  }
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
