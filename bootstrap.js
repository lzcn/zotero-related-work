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
var SWQuitClient = null;
var SWQuitPromise = null;
var SWCancelReadiness = null;

function stopWork() {
  SWReady = false;
  ++SWGeneration;
  SWCancelReadiness?.();
  SWCancelReadiness = null;
  for (const stop of [
    () => SWScope.SWTags?.stop(),
    () => SWScope.SWGraph?.stop(),
    () => SWScope.SWSection?.shutdown(),
    () => SWScope.SWSemantic?.stop(),
    () => SWScope.SWIndexer?.requestStop?.(),
  ]) {
    try {
      stop();
    } catch (error) {
      Zotero.logError(error);
    }
  }
}

function removeQuitObserver() {
  if (!SWQuitObserver) return;
  Services.obs?.removeObserver(SWQuitObserver, "quit-application-granted");
  SWQuitObserver = null;
}

function removeQuitBlocker() {
  SWQuitClient?.removeBlocker(finishQuit);
  SWQuitClient = null;
}

function finishQuit() {
  if (SWQuitPromise) return SWQuitPromise;
  stopWork();
  SWQuitPromise = releaseResources(true);
  return SWQuitPromise;
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
      "semantic.js",
      "tags.js",
      "tag-suggestions.js",
      "retrieval-evidence.js",
      "graph.js",
      "section.js",
    ];
    for (var file of files)
      Services.scriptloader.loadSubScript(rootURI + "src/" + file, SWScope);
    SWQuitObserver = {
      observe() {
        void finishQuit().catch((error) => Zotero.logError(error));
      },
    };
    const { AsyncShutdown } = ChromeUtils.importESModule(
      "resource://gre/modules/AsyncShutdown.sys.mjs",
    );
    SWQuitClient = AsyncShutdown.quitApplicationGranted;
    SWQuitClient.addBlocker(
      "Related Work: stop indexing and close storage",
      finishQuit,
    );
    Services.obs?.addObserver(SWQuitObserver, "quit-application-granted");
    await Promise.race([
      Zotero.initializationPromise,
      new Promise((resolve) => {
        SWCancelReadiness = resolve;
      }),
    ]);
    SWCancelReadiness = null;
    if (token !== SWGeneration) return;
    const service = Components.classes[
      "@mozilla.org/addons/addon-manager-startup;1"
    ].getService(Components.interfaces.amIAddonManagerStartup);
    SWChrome = service.registerChrome(
      Services.io.newURI(rootURI + "manifest.json"),
      [["content", "similar-works", rootURI + "content/"]],
    );
    await SWScope.SWTags.loadTerms(rootURI);
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
    stopWork();
    Zotero.logError(new Error("[similar-works] startup failed: " + error));
    await releaseResources();
  }
}

function releaseChrome() {
  SWChrome?.destruct();
  SWChrome = null;
}

async function releaseResources(appShutdown = false) {
  const actions = [
    removeQuitObserver,
    () => SWScope.SWSemantic?.stop(),
    () => SWScope.SWTags?.finishWrites(),
    ...(appShutdown ? [] : [() => SWScope.SWSemantic?._running]),
    () => SWScope.SWSemantic?._loaded,
    () => SWScope.SWSemantic?._nativeExit,
    () => SWScope.SWIndexer?._statusWrite,
    ...(appShutdown
      ? []
      : [
          () => SWScope.SWSection?.shutdown(),
          () => SWScope.SWIndexer?.shutdown(),
        ]),
    () => SWScope.SWIndexer?.corpus?.close(),
    releaseChrome,
    removeQuitBlocker,
  ];
  for (const action of actions) {
    try {
      await action();
    } catch (error) {
      Zotero.logError(error);
    }
  }
}

async function shutdown(data, reason) {
  stopWork();
  removeQuitObserver();
  if (SWShutdownPromise) return SWShutdownPromise;
  const appShutdown =
    typeof APP_SHUTDOWN !== "undefined" && reason === APP_SHUTDOWN;
  SWShutdownPromise = (async () => {
    // Application quit must not wait for Zotero startup or library scans.
    if (!appShutdown) await SWStartupPromise;
    if (SWQuitPromise) await SWQuitPromise;
    else await releaseResources(appShutdown);
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
  } catch (e) {
    Zotero.logError(
      new Error("[similar-works] onMainWindowUnload failed: " + e),
    );
  }
}

function install() {}

function uninstall() {}
