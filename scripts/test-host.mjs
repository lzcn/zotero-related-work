// Test the packaged plugin against an isolated Zotero profile and database.
import { spawn } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  open,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync, unzipSync, strFromU8, strToU8 } from "fflate";
import process from "node:process";
import { URL } from "node:url";
import { setTimeout, clearTimeout } from "node:timers";

const root = await mkdtemp(join(tmpdir(), "similar-works-host-"));
const profile = join(root, "profile");
const dataDirectory = join(root, "data");
const marker = join(root, "result.json");
await mkdir(join(profile, "extensions"), { recursive: true });
await mkdir(dataDirectory);
const prefs = {
  "intl.locale.requested": process.env.SW_HOST_LOCALE || "en-US",
  "extensions.zotero.dataDir": dataDirectory,
  "extensions.zotero.useDataDir": true,
  "extensions.zotero.firstRun2": false,
  "extensions.zotero.firstRun.skipFirefoxProfileAccessCheck": true,
  "extensions.autoDisableScopes": 0,
  "extensions.enabledScopes": 15,
  "extensions.zotero.automaticScraperUpdates": false,
  "extensions.zotero.similar-works.backgroundStartupDelayMs": 0,
  "extensions.zotero.similar-works.recommendationMethod": "text",
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
files["bootstrap.js"] = strToU8(
  strFromU8(files["bootstrap.js"]) +
    `
var SWOriginalStartup = startup;
startup = async function(data) {
  await Zotero.initializationPromise;
  const oldDirectory = PathUtils.join(Zotero.DataDirectory.dir, "similar-works");
  await IOUtils.makeDirectory(PathUtils.join(oldDirectory, "models"), {createAncestors:true});
  await IOUtils.writeUTF8(PathUtils.join(oldDirectory,"models","migration-marker"),"preserved model cache");
  const {Sqlite} = ChromeUtils.importESModule("resource://gre/modules/Sqlite.sys.mjs");
  const oldDB = await Sqlite.openConnection({path:PathUtils.join(oldDirectory,"similarity.sqlite")});
  await oldDB.execute("CREATE TABLE migration_probe (value TEXT)");
  await oldDB.execute("INSERT INTO migration_probe VALUES ('preserved index')");
  await oldDB.close();
  await SWOriginalStartup(data);
  setTimeout(async () => {
    const result = {};
    try {
      if (!SWReady || !SWScope.SWSection._registered) throw new Error("Sidebar did not register");
      await SWScope.SWIndexer.corpus.ready;
      const movedDirectory = PathUtils.join(Zotero.DataDirectory.dir,"related-work");
      if (await IOUtils.exists(oldDirectory)) throw new Error("Legacy directory was not migrated");
      if (await IOUtils.readUTF8(PathUtils.join(movedDirectory,"models","migration-marker")) !== "preserved model cache") throw new Error("Model cache was lost in migration");
      const migrated = await SWScope.SWIndexer.corpus._db.execute("SELECT value FROM migration_probe");
      if (migrated[0].getResultByName("value") !== "preserved index") throw new Error("Index was lost in migration");
      for (let i = 0; i < 100 && !SWScope.SWSection._preferencePane; i++)
        await new Promise(resolve => setTimeout(resolve, 50));
      if (!SWScope.SWSection._preferencePane) throw new Error("Settings did not register");
      const registered = SWScope.SWSection._registered;
      await SWOriginalStartup(data);
      if (SWScope.SWSection._registered !== registered) throw new Error("Duplicate registration");
      const doc = Zotero.getMainWindow().document;
      if (doc.querySelectorAll("#similar-works-style").length !== 1) throw new Error("Duplicate stylesheet");
      const item = new Zotero.Item("journalArticle");
      item.libraryID = Zotero.Libraries.userLibraryID;
      item.setField("title", "A long source title with several words ".repeat(6));
      item.setField("abstractNote", "An abstract that must wrap inside the native sidebar. ".repeat(30));
      await item.saveTx({skipSelect: true});
      await Zotero.getActiveZoteroPane().selectItem(item.id);
      await new Promise(resolve => setTimeout(resolve, 1000));
      const sidebar = doc.getElementById("zotero-item-pane");
      const view = doc.getElementById("zotero-view-item");
      const section = [...doc.querySelectorAll("item-pane-custom-section")].find(el => el.dataset.pane?.includes("similar-works"));
      if (!section) throw new Error("Native sidebar section is missing");
      section.querySelector("collapsible-section").open = true;
      SWScope.SWSection.ensureSkeleton(section.querySelector('[data-type="body"]'));
      const list = section.querySelector(".sw-list");
      const row = doc.createElementNS("http://www.w3.org/1999/xhtml", "button");
      row.className = "sw-row";
      row.innerHTML = '<span class="sw-rank">1</span><div class="sw-main"><div class="sw-title">'
        + "A-long-title-without-spaces".repeat(30) + '</div><div class="sw-meta">'
        + "A long author name ".repeat(60) + '</div></div><div class="sw-side"><span class="sw-num">99%</span></div>';
      list.replaceChildren(row);
      for (const width of [280, 400]) {
        sidebar.setAttribute("width", String(width));
        await new Promise(resolve => setTimeout(resolve, 100));
        const bounds = view.getBoundingClientRect();
        if (bounds.width > sidebar.getBoundingClientRect().width || view.scrollWidth > view.clientWidth + 1 || row.getBoundingClientRect().right > bounds.right)
          throw new Error("Long recommendation text stretches Zotero's native info and abstract pane");
      }
      list.replaceChildren();
      const body = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
      doc.documentElement.appendChild(body);
      SWScope.SWSection.ensureSkeleton(body);
      await doc.l10n.translateFragment(body);
      if (!body.querySelector("progress").getAttribute("aria-label")) throw new Error("Missing localized progress label");
      body.remove();
      const testTagWindows = [];
      const waitFor = async (predicate, step, attempts = 100) => {
        for (let n = 0; n < attempts; n++) {
          if (predicate()) return;
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        throw new Error("Tag UI did not finish loading: " + step + " " + JSON.stringify(testTagWindows.filter(win=>!win.closed).map(win=>({mode:win.document.getElementById("mode")?.value,target:win.document.getElementById("target")?.value,preview:win.document.getElementById("preview")?.textContent,checked:[...win.document.querySelectorAll("#tags input")].filter(input=>input.checked).map(input=>input.value)}))));
      };
      const tagAPI = SWScope.SWTags;
      const tagMenu = doc.getElementById("similar-works-organize-tags");
      if (!tagMenu) throw new Error("Missing tag menu");
      await doc.l10n.translateElements([tagMenu]);
      if (tagMenu.label !== ${JSON.stringify(process.env.SW_HOST_LOCALE === "zh-CN" ? "标签管理" : "Tag Manager")}) throw new Error("Unexpected tag menu label: " + tagMenu.label);
      if (!tagMenu.classList.contains("menuitem-iconic")) throw new Error("Tag menu icon slot missing");
      const tagIcon = new doc.defaultView.Image();
      await new Promise((resolve, reject) => {
        tagIcon.onload = resolve;
        tagIcon.onerror = () => reject(new Error("Tag menu icon failed to load"));
        tagIcon.src = tagMenu.getAttribute("image");
      });
      if (tagIcon.naturalWidth !== 16 || tagIcon.naturalHeight !== 16) throw new Error("Unexpected tag icon dimensions");
      const peers = [];
      for (const name of ["Deep Learning", "deep-learning"]) {
        const peer = new Zotero.Item("journalArticle");
        peer.libraryID = item.libraryID;
        peer.setField("title", "Tagged similar paper");
        peer.addTag(name, name === "deep-learning" ? 1 : 0);
        await peer.saveTx({skipSelect:true});
        peers.push(peer);
      }
      const taggedNote = new Zotero.Item("note");
      taggedNote.parentItemID = item.id;
      taggedNote.setNote("<p>A note to retain during tag merge</p>");
      taggedNote.addTag("deep-learning");
      await taggedNote.saveTx({skipSelect:true});
      const noteBeforeMerge = taggedNote.getNote();
      const tagBody = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
      doc.documentElement.appendChild(tagBody);
      SWScope.SWSection.ensureSkeleton(tagBody);
      tagBody._swToken = 1;
      const tagProps = {body:tagBody,item,tabType:"library"};
      await SWScope.SWSection.presentTags(tagProps, peers.map((peer, index) => ({item:peer,score:0.9-index*0.1})), SWScope.SWIndexer.docKey(item), 1);
      const recommended = [...tagBody.querySelectorAll('.sw-tag-option input')].find(input => input.value === "Deep Learning");
      if (!recommended || recommended.value !== "Deep Learning" || recommended.checked) throw new Error("Tag recommendations were not opt-in");
      recommended.checked = true;
      recommended.dispatchEvent(new doc.defaultView.Event("change", {bubbles:true}));
      tagBody.querySelector('.sw-tag-apply').click();
      await waitFor(() => item.hasTag("Deep Learning"), "apply suggestion");
      if (item.getTags().find(tag => tag.tag === "Deep Learning").type) throw new Error("Applied tag was not manual");
      await Zotero.DB.executeTransaction(async () => {
        await Zotero.Tags.setColor(item.libraryID, "Deep Learning", "#336699", 0);
        await Zotero.Tags.setColor(item.libraryID, "deep-learning", "#993333", 1);
      });
      if ((await tagAPI.catalog(item.libraryID,true)).some(name=>tagAPI.words(name).join(" ").toLowerCase() === "deep learning")) throw new Error("Colored tags appeared in management");
      for (const [sources,destination] of [[["deep-learning"],"Topic"],[["Graph Neural Networks"],"Deep Learning"]]) {
        try {
          await tagAPI.merge(item.libraryID,sources,destination);
          throw new Error("Colored tag could be changed or used as a destination");
        } catch (error) { if (error.message !== "similar-works-tags-protected") throw error; }
      }
      if (!peers[1].hasTag("deep-learning") || Zotero.Tags.getColor(item.libraryID,"Deep Learning").color !== "#336699") throw new Error("Protected tag data changed");
      Zotero.Prefs.set("extensions.zotero.similar-works.excludeColoredTags",false,true);
      const tagDialog = tagAPI.open(doc.defaultView, item.libraryID);
      await waitFor(() => tagDialog.document?.querySelectorAll('#tags input').length >= 2, 'load tag dialog');
      await tagDialog.document.l10n.ready;
      testTagWindows.push(tagDialog);
      const td = tagDialog.document;
      for (const name of ["Deep Learning", "deep-learning"]) {
        const input = [...td.querySelectorAll('#tags input')].find(input => input.value === name);
        if (input?.closest('label').querySelector('.tag-count')?.textContent.trim() !== "(2)") throw new Error("Tag usage count did not include native note/manual/automatic membership: " + name);
      }
      if (td.getElementById('duplicates').checked) throw new Error("Tag Manager did not default to all tags");
      td.getElementById('mode').value = "merge";
      td.getElementById('mode').dispatchEvent(new tagDialog.Event("change",{bubbles:true}));
      await waitFor(() => td.querySelectorAll('#tags input').length >= 2, 'render merge action');
      for (const checkbox of td.querySelectorAll('#tags input')) {
        checkbox.checked = true;
        checkbox.dispatchEvent(new tagDialog.Event("change", {bubbles:true}));
      }
      await waitFor(() => !td.getElementById('merge').disabled, 'preview merge');
      td.getElementById('target').value = "Deep Learning";
      if (!(await tagAPI.preview(item.libraryID, ["Deep Learning", "deep-learning"]) === 4)) throw new Error("Merge preview did not count all distinct items");
      td.getElementById('merge').click();
      await waitFor(() => peers[1].hasTag("Deep Learning") && !peers[1].hasTag("deep-learning"), "apply merge");
      await waitFor(() => !td.getElementById('refresh').disabled, 'merge result');
      await waitFor(() => td.querySelector('.tag-count')?.textContent.trim() === "(4)", 'refresh merged usage count');
      if (tagDialog.closed || !taggedNote.hasTag("Deep Learning") || taggedNote.getNote() !== noteBeforeMerge || Zotero.Tags.getColor(item.libraryID, "Deep Learning").color !== "#336699") throw new Error("Merge changed note content, target color or closed results");
      Zotero.Prefs.set("extensions.zotero.similar-works.excludeColoredTags",true,true);
      peers[1].addTag("Representation learning");
      peers[1].addTag("Representaton learning");
      await peers[1].saveTx({skipSelect:true});
      td.getElementById('duplicates').checked = true;
      td.getElementById('refresh').click();
      await waitFor(() => [...td.querySelectorAll('#tags input')].some(input => input.value === "Representaton learning"), 'broader duplicate candidates');
      const duplicateNames = [...td.querySelectorAll('#tags input')].map(input => input.value);
      if (!duplicateNames.includes("Representation learning") || duplicateNames.includes("Deep Learning") || !peers[1].hasTag("Representaton learning")) throw new Error("Duplicate filtering changed tags or included protected names");
      peers[1].removeTag("Representation learning");
      peers[1].removeTag("Representaton learning");
      await peers[1].saveTx({skipSelect:true});
      td.getElementById('duplicates').checked = false;
      peers[0].addTag("Graph Neural Networks");
      await peers[0].saveTx({skipSelect:true});
      const topic = new Zotero.Item("journalArticle");
      topic.libraryID = item.libraryID;
      topic.setField("title", "Graph Neural Networks for molecule prediction");
      topic.setField("abstractNote", "Graph Neural Networks improve molecule prediction. We evaluate molecule prediction.");
      await topic.saveTx({skipSelect:true});
      tagBody._swToken = 2;
      await SWScope.SWSection.presentTags({body:tagBody,item:topic}, [], SWScope.SWIndexer.docKey(topic), 2);
      const newOption = tagBody.querySelector('.sw-tag-new')?.closest('label')?.querySelector('input');
      if (!newOption || newOption.checked || !tagBody.querySelector('.sw-tag-new').textContent) throw new Error("Missing opt-in new topic tag");
      const oldLabel = tagBody.querySelector('.sw-tag-existing');
      const newLabel = tagBody.querySelector('.sw-tag-new');
      if (!oldLabel || doc.defaultView.getComputedStyle(oldLabel).color === doc.defaultView.getComputedStyle(newLabel).color) throw new Error("Existing and new tags do not have distinct colors");
      const newName = newOption.value;
      newOption.checked = true;
      newOption.dispatchEvent(new doc.defaultView.Event("change", {bubbles:true}));
      tagBody.querySelector('.sw-tag-apply').click();
      await waitFor(() => topic.hasTag(newName), "create selected new tag");
      if (topic.getTags().find(tag=>tag.tag === newName).type) throw new Error("New tag was not manual");
      peers[0].addTag("odd   tag");
      await peers[0].saveTx({skipSelect:true});
      td.getElementById('duplicates').checked = false;
      td.getElementById('search').value = "odd";
      td.getElementById('refresh').click();
      await waitFor(() => td.querySelector('#tags input')?.value === "odd   tag", 'load normalization candidate');
      td.getElementById("mode").value = "format";
      td.getElementById("mode").dispatchEvent(new tagDialog.Event("change",{bubbles:true}));
      await waitFor(() => td.querySelector('#tags input')?.value === "odd   tag", "render single rename");
      const normalize = td.querySelector('#tags input');
      normalize.checked = true;
      normalize.dispatchEvent(new tagDialog.Event("change", {bubbles:true}));
      await waitFor(() => !td.getElementById('merge').disabled, 'preview normalization');
      if (td.getElementById('target').value !== "Odd tag") throw new Error("Normalization did not suggest a clean name");
      td.getElementById('merge').click();
      await waitFor(() => peers[0].hasTag("Odd tag") && !peers[0].hasTag("odd   tag"), 'apply normalization');
      await waitFor(() => !td.getElementById('refresh').disabled, 'normalization result');
      if (tagDialog.closed || taggedNote.getNote() !== noteBeforeMerge) throw new Error("Normalization changed unrelated note content");
      tagDialog.close();
      tagBody.remove();

      const settings = Zotero.Utilities.Internal.openPreferences("similar-works-preferences");
      let method;
      for (let n = 0; n < 100; n++) {
        method = settings.document.getElementById("similar-works-method");
        if (method?.querySelector("menuitem")?.label) break;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (!method || !method.querySelector("menuitem").label || !settings.document.getElementById("similar-works-limit")) throw new Error("Settings controls did not load");
      const buildLabel = settings.document.getElementById("similar-works-build");
      for (let n = 0; n < 100 && !buildLabel?.textContent.trim(); n++) await new Promise(resolve => setTimeout(resolve, 50));
      if (!buildLabel?.textContent.match(/[0-9a-f]{12}/) || !settings.document.getElementById("similar-works-model").textContent.includes("384")) throw new Error("Build or model diagnostics did not load in native Settings");
      const mainWindow = Zotero.getMainWindow();
      const originalStatus = mainWindow.similarWorksStatus;
      const snapshot = originalStatus();
      mainWindow.similarWorksStatus = () => ({...snapshot, state:"indexing", indexedItems:3, totalItems:10, queuedItems:7, indexProgress:{phase:"ready",done:3,total:10}, vectorTotal:10, semantic:{state:"indexing",indexedItems:2,queuedItems:8,error:null}});
      for (let n = 0; n < 50 && settings.document.getElementById("similar-works-vector-progress").value !== 2; n++) await new Promise(resolve => setTimeout(resolve, 50));
      if (settings.document.getElementById("similar-works-index-progress").value !== 3 || settings.document.getElementById("similar-works-vector-progress").value !== 2 || settings.document.getElementById("similar-works-vector-progress").hidden) throw new Error("Settings progress did not refresh with indexing state");
      if (${JSON.stringify(process.env.SW_HOST_SCREENSHOT || "")}) {
        const image = await settings.browsingContext.currentWindowGlobal.drawSnapshot(undefined, 1, "white");
        const canvas = settings.document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
        canvas.width = image.width; canvas.height = image.height;
        canvas.getContext("2d").drawImage(image, 0, 0); image.close();
        const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
        await IOUtils.write(${JSON.stringify(process.env.SW_HOST_SCREENSHOT || "")}, new Uint8Array(await blob.arrayBuffer()));
      }
      mainWindow.similarWorksStatus = originalStatus;
      method.value = "semantic";
      method.dispatchEvent(new settings.Event("command", { bubbles: true }));
      if (Zotero.Prefs.get(method.getAttribute("preference"), true) !== "semantic") throw new Error("Settings selection was not saved");
      method.value = "text";
      method.dispatchEvent(new settings.Event("command", { bubbles: true }));
      const style = settings.document.getElementById("similar-works-tag-style");
      const hashtag = settings.document.getElementById("similar-works-tag-hashtag");
      if (!style || style.querySelectorAll("menuitem").length !== 2 || settings.document.getElementById("similar-works-tag-case") || settings.document.getElementById("similar-works-tag-hyphens")) throw new Error("Naming options were not simplified");
      for(const value of ["title","sentence"]) {
        style.value=value;style.dispatchEvent(new settings.Event("command",{bubbles:true}));
        if (Zotero.Prefs.get(style.getAttribute("preference"),true)!==value) throw new Error("Case preset did not auto-save");
      }
      if(tagAPI.formatName("gan yolo co-attention PyTorch")!=="GAN YOLO co-attention PyTorch") throw new Error("Scientific dictionary did not load");
      hashtag.checked=true;hashtag.dispatchEvent(new settings.Event("command",{bubbles:true}));
      if(tagAPI.formatName("deep learning")!=="#Deep learning") throw new Error("Hashtag setting did not save");
      const excludedTags = settings.document.getElementById("similar-works-excluded-tags");
      const excludeColored = settings.document.getElementById("similar-works-exclude-colored-tags");
      if (!excludedTags || !excludeColored.checked || !excludeColored.label) throw new Error("Tag protection controls did not load");
      excludedTags.value = ["Graph Neural Networks", "Special Status"].join(String.fromCharCode(10));
      excludedTags.dispatchEvent(new settings.Event("input", {bubbles:true}));
      excludedTags.dispatchEvent(new settings.Event("change", {bubbles:true}));
      await waitFor(() => Zotero.Prefs.get(excludedTags.getAttribute("preference"),true) === excludedTags.value, 'save excluded tags');
      if ((await tagAPI.catalog(item.libraryID,true)).includes("Graph Neural Networks")) throw new Error("Manual exclusion did not hide a tag");
      try { await tagAPI.merge(item.libraryID,["Odd tag"],"#SpecialStatus"); throw new Error("Excluded destination accepted"); }
      catch (error) { if (error.message !== "similar-works-tags-protected") throw error; }
      settings.close();
      peers[0].addTag("format HTTP parser");
      peers[1].addTag("#format_HTTP_parser");
      await peers[0].saveTx({skipSelect:true});
      await peers[1].saveTx({skipSelect:true});
      const formatDialog = tagAPI.open(doc.defaultView,item.libraryID);
      await waitFor(() => formatDialog.document?.querySelectorAll('#tags input').length >= 2, 'load naming variants');
      const fd = formatDialog.document;
      for (const checkbox of [...fd.querySelectorAll('#tags input')].filter(input=>["format HTTP parser","#format_HTTP_parser"].includes(input.value))) {
        checkbox.checked = true;
        checkbox.dispatchEvent(new formatDialog.Event("change", {bubbles:true}));
      }
      await waitFor(() => !fd.getElementById('merge').disabled, 'preview configured format');
      if (fd.getElementById('target').value !== "#Format HTTP parser") throw new Error("Naming preview ignored saved settings");
      fd.getElementById('merge').click();
      await waitFor(() => peers.every(peer=>peer.hasTag("#Format HTTP parser")), 'apply configured format');
      await waitFor(() => !fd.getElementById('refresh').disabled, 'configured format result');
      if (peers[0].hasTag("format HTTP parser") || peers[1].hasTag("#format_HTTP_parser") || taggedNote.getNote() !== noteBeforeMerge) throw new Error("Naming merge did not preserve unrelated data");
      formatDialog.close();
      for (let index = 0; index < 230; index++) peers[0].addTag("BulkTag"+index);
      await peers[0].saveTx({skipSelect:true});
      const bulkDialog = tagAPI.open(doc.defaultView,item.libraryID);
      await waitFor(() => bulkDialog.document?.querySelectorAll('#tags input').length > 230, 'display all tags without a cutoff');
      const bd = bulkDialog.document;
      if (Zotero.isMac) {
        bulkDialog.dispatchEvent(new bulkDialog.KeyboardEvent("keydown",{key:"w",metaKey:true,isComposing:true,cancelable:true}));
        bulkDialog.dispatchEvent(new bulkDialog.KeyboardEvent("keydown",{key:"w",ctrlKey:true,cancelable:true}));
        if (bulkDialog.closed) throw new Error("IME or Control-W closed Tag Manager");
        bulkDialog.dispatchEvent(new bulkDialog.KeyboardEvent("keydown",{key:"f",metaKey:true,cancelable:true}));
        if (bd.activeElement !== bd.getElementById("search")) throw new Error("Command-F did not focus tag search");
      }
      if (bd.getElementById("mode").value !== "merge") throw new Error("Wrong default tag action");
      bd.getElementById("mode").value = "format";
      bd.getElementById("mode").dispatchEvent(new bulkDialog.Event("change",{bubbles:true}));
      if ([...bd.querySelectorAll('#tags input')].some(input=>['Deep Learning','Graph Neural Networks'].includes(input.value))) throw new Error('Protected tags were visible');
      bd.getElementById('search').value = "BulkTag";
      bd.getElementById('search').dispatchEvent(new bulkDialog.Event("input",{bubbles:true}));
      await waitFor(() => bd.querySelectorAll('#tags input').length === 230, 'filter bulk tags');
      let inputs = [...bd.querySelectorAll('#tags input')];
      inputs[1].click();
      inputs[5].dispatchEvent(new bulkDialog.MouseEvent("click",{bubbles:true,shiftKey:true}));
      await waitFor(() => [...bd.querySelectorAll('#tags input')].filter(input=>input.checked).length === 5, 'shift range selection');
      bd.getElementById('select-all').click();
      await waitFor(() => [...bd.querySelectorAll('#tags input')].every(input=>input.checked), 'select all filtered tags');
      await waitFor(() => !bd.getElementById('merge').disabled, 'preview bulk formatting');
      if (bd.getElementById('mode').value !== "format") throw new Error("Wrong format action");
      if (${JSON.stringify(process.env.SW_TAGS_HOST_SCREENSHOT || "")}) {
        const image = await bulkDialog.browsingContext.currentWindowGlobal.drawSnapshot(undefined, 1, "white");
        const canvas = bd.createElement("canvas");
        canvas.width = image.width; canvas.height = image.height;
        canvas.getContext("2d").drawImage(image, 0, 0); image.close();
        const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
        await IOUtils.write(${JSON.stringify(process.env.SW_TAGS_HOST_SCREENSHOT || "")}, new Uint8Array(await blob.arrayBuffer()));
      }
      bd.getElementById('merge').click();
      await waitFor(() => !bd.getElementById('refresh').disabled, 'finish bulk formatting', 500);
      if (!peers[0].hasTag("#BulkTag0") || !peers[0].hasTag("#BulkTag229") || peers[0].getTags().filter(tag=>tag.tag.startsWith("#BulkTag")).length !== 230) throw new Error("Bulk formatting lost distinct tags");
      if (!peers[0].hasTag("Deep Learning") || taggedNote.getNote() !== noteBeforeMerge) throw new Error("Bulk formatting changed protected or unrelated data");
      bd.getElementById("search").value = "#BulkTag";
      bd.getElementById("search").dispatchEvent(new bulkDialog.Event("input",{bubbles:true}));
      await waitFor(() => bd.querySelectorAll("#tags input").length === 230, "render formatted tags for deletion");
      bd.getElementById("mode").value = "delete";
      bd.getElementById("mode").dispatchEvent(new bulkDialog.Event("change",{bubbles:true}));
      await waitFor(() => bd.querySelectorAll("#tags input").length === 230, "render deletion action");
      const deletionInputs = [...bd.querySelectorAll("#tags input")];
      const removedNames = deletionInputs.slice(0,2).map(input=>input.value);
      deletionInputs[0].click(); deletionInputs[1].click();
      await waitFor(() => !bd.getElementById("merge").disabled && bd.getElementById("target").hidden, "preview delete selection");
      bd.getElementById("merge").click();
      await waitFor(() => !bd.getElementById("refresh").disabled, "finish delete");
      if (removedNames.some(name=>peers[0].hasTag(name)) || peers[0].getTags().filter(tag=>tag.tag.startsWith("#BulkTag")).length !== 228) throw new Error("Bulk deletion did not preserve unselected tags");
      if (!peers[0].hasTag("Deep Learning") || taggedNote.getNote() !== noteBeforeMerge || peers[0].deleted) throw new Error("Deletion changed protected tags or items");
      bulkDialog.dispatchEvent(new bulkDialog.KeyboardEvent("keydown",{key:"w",metaKey:!!Zotero.isMac,ctrlKey:!Zotero.isMac,cancelable:true}));
      await waitFor(() => bulkDialog.closed, "Command-W close tag dialog");
      const corpus = SWScope.SWIndexer.corpus;
      if (!corpus._db) throw new Error("Index did not open");
      const semantic = SWScope.SWSemantic;
      const storedVector = new Float32Array(384); storedVector[0] = 1;
      corpus.docs.set("1/HOST-VECTOR", {hash: "host-vector", weak: false});
      await corpus._db.execute("INSERT OR REPLACE INTO embeddings (key, sourceHash, model, vector, updatedAt) VALUES (?, ?, ?, ?, ?)",
        ["1/HOST-VECTOR", "host-vector", semantic.version, semantic.encode(storedVector), Date.now()]);
      semantic.vectors.delete("1/HOST-VECTOR");
      await semantic._load(corpus);
      if (semantic.vectors.get("1/HOST-VECTOR")?.vector[0] !== 1) {
        const vectorRows = await corpus._db.execute("SELECT vector FROM embeddings WHERE key = ?", ["1/HOST-VECTOR"]);
        const bytes = vectorRows[0].getResultByName("vector");
        throw new Error("Persisted native semantic vector failed to reload: " + JSON.stringify({array:Array.isArray(bytes),length:bytes.length,byteLength:bytes.byteLength,constructor:bytes.constructor?.name}));
      }

      const originalBuild = semantic._build;
      let selectedBuilt = false;
      semantic.corpus.docs.set("1/HOST-PRIORITY", {hash: "priority"});
      semantic._enabled = true;
      semantic._build = async key => {
        selectedBuilt = key === "1/HOST-PRIORITY";
        semantic.pause();
      };
      const selectedAt = Date.now();
      try {
        semantic.enqueue("1/HOST-PRIORITY", true);
        await semantic._running;
        if (!selectedBuilt || Date.now() - selectedAt >= 1000)
          throw new Error("Selected note waited for background indexing delay");
      } finally { semantic._build = originalBuild; }

      const openManager = tagAPI.open(doc.defaultView,item.libraryID);
      await waitFor(() => openManager.document?.querySelectorAll('#tags input').length > 200, 'manager before shutdown');
      if (!tagAPI._dialogs.has(openManager)) throw new Error("Live manager window was not tracked");
      await shutdown(data, 2);
      if (!openManager.closed) throw new Error("Shutdown did not close Tag Manager");
      if (corpus._db || SWScope.SWSection._registered || SWScope.SWSection._preferencePane || SWScope.SWSection._tagObserver || doc.getElementById("similar-works-organize-tags") || SWScope.SWTags._dialogs.size)
        throw new Error("Shutdown leaked resources");
      result.ok = true;
    } catch (error) { result.error = String(error) + "\\n" + error.stack; }
    await IOUtils.writeUTF8(${JSON.stringify(marker)}, JSON.stringify(result));
    Services.startup.quit(Components.interfaces.nsIAppStartup.eAttemptQuit);
  }, 1000);
};
`,
);
await writeFile(
  join(profile, "extensions/similar-works@lzcn.xpi"),
  zipSync(files),
);
const log = await open(join(root, "zotero.log"), "w");
const child = spawn(
  process.env.ZOTERO_BINARY || "/Applications/Zotero.app/Contents/MacOS/zotero",
  ["-no-remote", "-profile", profile, "-ZoteroDebugText"],
  { stdio: ["ignore", log.fd, log.fd] },
);
const exited = new Promise((resolve, reject) => {
  child.once("exit", (code) => resolve(code));
  child.once("error", reject);
});
let timeout;
let passed = false;
try {
  const code = await Promise.race([
    exited,
    new Promise((_, reject) => {
      timeout = setTimeout(
        () => reject(new Error("Zotero host test timed out")),
        45000,
      );
    }),
  ]);
  const result = JSON.parse(await readFile(marker, "utf8"));
  if (code !== 0 || !result.ok)
    throw new Error(JSON.stringify({ code, result }));
  console.log(
    "PASS Packaged startup, single registration, localized progress, narrow-sidebar text containment, native semantic vector reload and foreground scheduling, live build/index diagnostics, native settings saving, opt-in existing/new tag recommendations, native tag merge/normalization, persisted naming presets/hashtag, protected colored/excluded tags, complete tag list, shift/select-all and bulk formatting, shutdown cleanup.",
  );
  passed = true;
} finally {
  clearTimeout(timeout);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGTERM");
    const killTimer = setTimeout(() => child.kill("SIGKILL"), 5000);
    await exited.catch(() => {});
    clearTimeout(killTimer);
  }
  await log.close();
  if (passed) await rm(root, { recursive: true, force: true });
  else console.error(`Host test profile and logs retained at ${root}`);
}
