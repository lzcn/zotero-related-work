var SWScope = {
  Zotero,
  Services,
  ChromeUtils,
  IOUtils,
  PathUtils,
  TextDecoder,
  TextEncoder: typeof TextEncoder === "undefined" ? undefined : TextEncoder,
  Ci: typeof Ci === "undefined" ? undefined : Ci,
  setTimeout,
  clearTimeout,
  SWPlugin: { id: null, version: null, rootURI: null },
};

var SWReady = false;
var SWChrome = null;
var SWGeneration = 0;
var SWStartupPromise = null;
var SWShutdownPromise = null;
var SWQuitObserver = null;

function stopWork() {
  SWReady = false;
  ++SWGeneration;
  SWScope.SWTags?.stop();
  SWScope.SWSection?.shutdown();
  SWScope.SWSemantic?.stop();
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

async function migrateDataDirectory() {
  const legacy = PathUtils.join(Zotero.DataDirectory.dir, "similar-works");
  const current = PathUtils.join(Zotero.DataDirectory.dir, "related-work");
  if (!(await IOUtils.exists(legacy))) return;
  if (await IOUtils.exists(current))
    throw new Error(
      "Both similar-works and related-work data directories exist; neither was overwritten.",
    );
  // Move the whole cache before opening SQLite, including WAL, models and progress.
  await IOUtils.move(legacy, current, { noOverwrite: true });
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
      "semantic.js",
      "tags.js",
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
    const service = Components.classes[
      "@mozilla.org/addons/addon-manager-startup;1"
    ].getService(Components.interfaces.amIAddonManagerStartup);
    SWChrome = service.registerChrome(
      Services.io.newURI(rootURI + "manifest.json"),
      [["content", "similar-works", rootURI + "content/"]],
    );
    await migrateDataDirectory();
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

function releaseChrome() {
  SWChrome?.destruct();
  SWChrome = null;
}

async function releaseResources() {
  try {
    await SWScope.SWTags?.finishWrites();
    removeQuitObserver();
    SWScope.SWSemantic?.stop();
    await SWScope.SWSemantic?._running;
    if (SWScope.SWSection) SWScope.SWSection.shutdown();
    if (SWScope.SWIndexer) await SWScope.SWIndexer.shutdown();
    if (SWScope.SWIndexer?.corpus) await SWScope.SWIndexer.corpus.close();
  } finally {
    releaseChrome();
  }
}

async function shutdown(data, reason) {
  stopWork();
  removeQuitObserver();
  // Our independent SQLite connection blocks profile shutdown until explicitly closed.
  // Do not await Zotero startup or its library scans while the application is quitting.
  if (typeof APP_SHUTDOWN !== "undefined" && reason === APP_SHUTDOWN) {
    try {
      await SWScope.SWTags?.finishWrites();
      await SWScope.SWIndexer?.corpus?.close();
    } finally {
      releaseChrome();
    }
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
