// Verify persisted indexes across two real Zotero launches in disposable data.
import { spawn } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  open,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Script } from "node:vm";
import { URL } from "node:url";
import process from "node:process";
import { setTimeout, clearTimeout } from "node:timers";
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";

const root = await mkdtemp(join(tmpdir(), "related-work-restart-"));
const profile = join(root, "profile"),
  data = join(root, "data"),
  marker = join(root, "result.json");
await mkdir(join(profile, "extensions"), { recursive: true });
await mkdir(data);
const prefs = {
  "extensions.zotero.dataDir": data,
  "extensions.zotero.useDataDir": true,
  "extensions.zotero.firstRun2": false,
  "extensions.zotero.firstRun.skipFirefoxProfileAccessCheck": true,
  "extensions.autoDisableScopes": 0,
  "extensions.enabledScopes": 15,
  "extensions.zotero.automaticScraperUpdates": false,
  "extensions.zotero.similar-works.backgroundStartupDelayMs": 0,
  "extensions.zotero.similar-works.backgroundIndexing": true,
  "app.update.auto": false,
  "extensions.update.enabled": false,
};
await writeFile(
  join(profile, "user.js"),
  Object.entries(prefs)
    .map(
      ([key, value]) =>
        `user_pref(${JSON.stringify(key)}, ${JSON.stringify(value)});`,
    )
    .join("\n"),
);
const files = unzipSync(
  await readFile(new URL("../dist/zotero-related-work.xpi", import.meta.url)),
);
files["src/corpus.js"] = strToU8(
  strFromU8(files["src/corpus.js"]).replace(
    "  async _loadAll() {",
    "  async _loadAll() { if (typeof SWRestartLoadGate !== 'undefined') await SWRestartLoadGate;",
  ),
);
files["bootstrap.js"] = strToU8(
  strFromU8(files["bootstrap.js"]) +
    `
var restartOriginalStartup = startup;
startup = async function(data) {
  await Zotero.initializationPromise;
  let releaseLoad;
  if (await IOUtils.exists(${JSON.stringify(marker)}))
    SWScope.SWRestartLoadGate=new Promise(resolve=>{releaseLoad=resolve;});
  await restartOriginalStartup(data);
  setTimeout(async () => {
    const result = {};
    try {
      const indexer = SWScope.SWIndexer, corpus = indexer.corpus, semantic = SWScope.SWSemantic;
      const previous = await IOUtils.exists(${JSON.stringify(marker)})
        ? JSON.parse(await IOUtils.readUTF8(${JSON.stringify(marker)})) : null;
      if (previous) {
        await corpus.opened;
        const key=previous.keys[0], slash=key.indexOf('/');
        const item=await Zotero.Items.getByLibraryAndKeyAsync(Number(key.slice(0,slash)),key.slice(slash+1));
        const selecting=Zotero.getActiveZoteroPane().selectItem(item.id);
        const doc=Zotero.getMainWindow().document;
        let section;
        for(let i=0;i<100 && !section;i++) {
          section=[...doc.querySelectorAll('item-pane-custom-section')].find(el=>el.dataset.pane?.includes('similar-works'));
          if(!section) await new Promise(resolve=>setTimeout(resolve,20));
        }
        if (!section) throw new Error('Native sidebar missing during restart');
        section.querySelector('collapsible-section').open=true;
        const body=section.querySelector('[data-type="body"]');
        const pending=SWScope.SWSection.renderBody({body,item,tabType:'library'});
        try {
          for (let i=0;i<100 && !body.querySelector('.sw-row');i++) await new Promise(resolve=>setTimeout(resolve,20));
          if (!body.querySelector('.sw-row') || corpus.progress.phase==='ready' || semantic._native)
            throw new Error('Cached recommendations waited for index or inference');
          result.cachedBeforeIndexLoad=true;
        } finally { releaseLoad(); }
        await Promise.all([pending,selecting]);
      }
      await corpus.ready;
      await semantic.start(corpus);
      semantic.pause();
      if (!previous) {
        const keys = [];
        for (let i=0;i<8;i++) {
          const item = new Zotero.Item('journalArticle');
          item.libraryID = Zotero.Libraries.userLibraryID;
          item.setField('title','Graph neural networks for molecule prediction ' + i);
          await item.saveTx({skipSelect:true});
          await indexer.ensureNow(item);
          const key = indexer.docKey(item), hash = corpus.docs.get(key).hash;
          const vector = new Float32Array(384); vector[0]=1;
          await corpus._db.execute('INSERT OR REPLACE INTO embeddings (key,sourceHash,model,vector,updatedAt) VALUES (?,?,?,?,?)',
            [key,hash,semantic.version,semantic.encode(vector),Date.now()]);
          keys.push(key);
        }
        await indexer._scanPromise;
        await indexer._drainPromise;
        await corpus.saveHybridRecommendations(keys[0],true,[{key:keys[1],score:0.9,lexicalScore:0.7,semanticScore:1,weak:true}],
          {queryHash:corpus.docs.get(keys[0]).hash,revision:corpus.revision,epoch:corpus.search.epoch},semantic.version);
        result.keys=keys;
        result.hashes=keys.map(key=>corpus.docs.get(key).hash);
        result.revision=corpus.revision;
        result.phase='prepared';
      } else {
        if (!previous.ok || previous.phase!=='prepared') throw new Error('Missing first-launch state');
        for (const [i,key] of previous.keys.entries()) {
          if (corpus.docs.get(key)?.hash!==previous.hashes[i] || semantic.vectors.get(key)?.hash!==previous.hashes[i])
            throw new Error('Persisted index or vector was not reused: '+key);
        }
        let writes=0, rebuilds=0;
        const execute=corpus._db.execute.bind(corpus._db);
        corpus._db.execute=async function(sql,...args) {
          if (sql.includes('INSERT OR REPLACE INTO source_updates')) writes++;
          return execute(sql,...args);
        };
        const upsert=corpus._upsertDoc.bind(corpus);
        corpus._upsertDoc=async (...args)=>{rebuilds++;return upsert(...args);};
        const started=Date.now();
        await indexer._scanPromise;
        await indexer._drainPromise;
        await indexer.enqueueLibrary();
        await indexer._drainPromise;
        const elapsed=Date.now()-started;
        if (writes || rebuilds || corpus.revision!==previous.revision || elapsed>=10000)
          throw new Error('Warm scan repeated work: '+JSON.stringify({writes,rebuilds,elapsed,revision:corpus.revision}));
        semantic.enable();
        if (semantic._queue.length || semantic._native) throw new Error('Unchanged vectors started inference');
        semantic.pause();
        const key=previous.keys[0], slash=key.indexOf('/');
        const changed=await Zotero.Items.getByLibraryAndKeyAsync(Number(key.slice(0,slash)),key.slice(slash+1));
        changed.setField('title','Changed combinatorial optimization with adjoint matching');
        await changed.saveTx({skipSelect:true});
        await indexer.ensureNow(changed);
        await indexer._drainPromise;
        if (rebuilds!==1 || corpus.docs.get(key).hash===previous.hashes[0]) throw new Error('Changed item was not rebuilt exactly once');
        for (let i=1;i<previous.keys.length;i++)
          if (corpus.docs.get(previous.keys[i]).hash!==previous.hashes[i]) throw new Error('Unrelated document changed');
        result.phase='restarted';
        result.documents=previous.keys.length;
        result.warmScanMs=elapsed;
        result.warmRebuilds=0;
        result.warmSourceWrites=0;
        result.changedRebuilds=rebuilds;
      }
      await shutdown(data,2);
      if (corpus._db || semantic._native) throw new Error('Restart check leaked resources');
      result.ok=true;
    } catch (error) {releaseLoad?.();result.error=String(error)+'\\n'+error.stack;}
    await IOUtils.writeUTF8(${JSON.stringify(marker)},JSON.stringify(result));
    Services.startup.quit(Components.interfaces.nsIAppStartup.eAttemptQuit);
  },1000);
};
`,
);
new Script(strFromU8(files["bootstrap.js"]), {
  filename: "restart-bootstrap.js",
});
await writeFile(
  join(profile, "extensions/similar-works@lzcn.xpi"),
  zipSync(files),
);
let passed = false;
try {
  for (const phase of ["prepare", "restart"]) {
    const log = await open(join(root, phase + ".log"), "w");
    const child = spawn(
      process.env.ZOTERO_BINARY ||
        "/Applications/Zotero.app/Contents/MacOS/zotero",
      ["-no-remote", "-profile", profile, "-ZoteroDebugText"],
      { stdio: ["ignore", log.fd, log.fd] },
    );
    const exited = new Promise((resolve, reject) => {
      child.once("exit", resolve);
      child.once("error", reject);
    });
    let timer;
    try {
      const code = await Promise.race([
        exited,
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Restart host timed out: " + phase)),
            90000,
          );
        }),
      ]);
      const result = JSON.parse(await readFile(marker, "utf8"));
      if (
        code !== 0 ||
        !result.ok ||
        result.phase !== (phase === "prepare" ? "prepared" : "restarted")
      )
        throw new Error(JSON.stringify({ phase, code, result }));
      if (phase === "restart")
        console.log("PASS restart cache reuse: " + JSON.stringify(result));
    } finally {
      clearTimeout(timer);
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGTERM");
        const kill = setTimeout(() => child.kill("SIGKILL"), 5000);
        await exited.catch(() => {});
        clearTimeout(kill);
      }
      await log.close();
    }
  }
  passed = true;
} finally {
  if (passed) await rm(root, { recursive: true, force: true });
  else console.error("Restart test data retained at " + root);
}
