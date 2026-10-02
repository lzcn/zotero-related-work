const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const source = fs.readFileSync(path.join(__dirname, "../bootstrap.js"), "utf8");
function fixture({
  failure = false,
  deferred = false,
  deferZotero = false,
} = {}) {
  let resolve;
  const gate = deferred
    ? new Promise((r) => {
        resolve = r;
      })
    : Promise.resolve();
  const state = {
    loads: [],
    starts: 0,
    registered: 0,
    closed: 0,
    injected: [],
    removed: [],
    errors: [],
    observers: new Map(),
    stops: 0,
  };
  const corpus = {
    ready: deferZotero ? Promise.resolve() : gate,
    progress: {
      phase: failure ? "error" : "ready",
      error: "Database unavailable",
    },
    close: async () => state.closed++,
  };
  const context = vm.createContext({
    Zotero: {
      initializationPromise: deferZotero ? gate : Promise.resolve(),
      getMainWindows: () => ["first", "second"],
      logError: (error) => state.errors.push(error),
    },
    Services: {
      obs: {
        addObserver: (observer, topic) => state.observers.set(topic, observer),
        removeObserver: (_observer, topic) => state.observers.delete(topic),
      },
      scriptloader: {
        loadSubScript(_uri, scope) {
          state.loads.push(_uri);
          scope.SWIndexer = {
            corpus,
            start: async () => state.starts++,
            shutdown: async () => {},
            requestStop: () => state.stops++,
          };
          scope.SWSection = {
            register: () => state.registered++,
            shutdown: () => {},
            injectWindow: (win) => state.injected.push(win),
            removeWindow: (win) => state.removed.push(win),
          };
        },
      },
    },
    ChromeUtils: {},
    IOUtils: {},
    PathUtils: {},
    TextDecoder,
    setTimeout,
    clearTimeout,
  });
  vm.runInContext(source, context);
  const data = { id: "similar-works@lzcn", version: "0.1.0", rootURI: "" };
  return { context, state, resolve, data };
}
test("repeated startup and shutdown register and close once", async () => {
  const h = fixture();
  await Promise.all([h.context.startup(h.data), h.context.startup(h.data)]);
  assert.equal(h.state.loads.length, 7);
  assert.equal(new Set(h.state.loads).size, 7);
  assert.ok(h.state.loads.some((uri) => uri.endsWith("search.js")));
  assert.equal(h.state.starts, 1);
  assert.equal(h.state.registered, 1);
  assert.deepEqual(h.state.injected, ["first", "second"]);
  await Promise.all([h.context.shutdown(), h.context.shutdown()]);
  assert.equal(h.state.closed, 1);
  h.context.onMainWindowLoad({ window: "late" });
  assert.equal(h.state.injected.length, 2);
});
test("failed corpus initialization keeps the sidebar available for error feedback", async () => {
  const h = fixture({ failure: true });
  await h.context.startup(h.data);
  assert.equal(h.state.registered, 1);
  assert.equal(h.state.injected.length, 2);
  assert.equal(h.state.closed, 0);
  await h.context.shutdown();
  assert.equal(h.state.closed, 1);
});
test("storage preparation does not delay sidebar registration", async () => {
  const h = fixture({ deferred: true });
  await h.context.startup(h.data);
  assert.equal(h.state.registered, 1);
  assert.deepEqual(h.state.injected, ["first", "second"]);
  await h.context.shutdown();
  h.resolve();
  await new Promise((r) => setImmediate(r));
  assert.equal(h.state.registered, 1);
  assert.equal(h.state.closed, 1);
});
test("shutdown during initialization waits and prevents late UI registration", async () => {
  const h = fixture({ deferred: true, deferZotero: true });
  const starting = h.context.startup(h.data);
  await new Promise((r) => setImmediate(r));
  const stopping = h.context.shutdown();
  h.resolve();
  await Promise.all([starting, stopping]);
  assert.equal(h.state.registered, 0);
  assert.equal(h.state.injected.length, 0);
  assert.equal(h.state.closed, 1);
});

test("application quit closes storage without waiting for Zotero startup", async () => {
  const h = fixture({ deferred: true, deferZotero: true });
  h.context.APP_SHUTDOWN = 2;
  const starting = h.context.startup(h.data);
  await new Promise((r) => setImmediate(r));
  await h.context.shutdown(h.data, 2);
  assert.equal(h.state.closed, 1);
  assert.equal(h.state.observers.size, 0);
  h.resolve();
  await starting;
  assert.equal(h.state.registered, 0);
});

test("confirmed quit cancels work before add-on shutdown is dispatched", async () => {
  const h = fixture();
  await h.context.startup(h.data);
  h.state.observers.get("quit-application-granted").observe();
  await new Promise((r) => setImmediate(r));
  assert.equal(h.state.stops, 1);
  assert.equal(h.state.closed, 1);
  h.context.onMainWindowLoad({ window: "late" });
  assert.equal(h.state.injected.length, 2);
});
