// Legacy names appear only here to migrate existing installations safely.
var SWMigration = {
 async prepare() {
  var { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");
  for (var id of ["related-work@zhi.dev", "similar-works@zhi.dev"]) {
   var legacy = await AddonManager.getAddonByID(id);
   if (legacy?.isActive) throw new Error("Disable the old plugin and restart Zotero before installing Similar Works so its database is closed.");
  }
  var oldDir = PathUtils.join(Zotero.DataDirectory.dir, "related-work");
  var newDir = PathUtils.join(Zotero.DataDirectory.dir, "similar-works");
  var oldDB = PathUtils.join(oldDir, "similarity.sqlite");
  var newDB = PathUtils.join(newDir, "similarity.sqlite");
  if (await IOUtils.exists(oldDB)) {
   // Never open an empty new database or silently choose between two existing libraries.
   if (await IOUtils.exists(newDir)) throw new Error("Both old and new plugin data directories exist; migration stopped to protect existing vectors.");
   await IOUtils.move(oldDir, newDir, { noOverwrite: true });
  }
  if (typeof Services !== "undefined" && Services.prefs?.prefHasUserValue) {
   for (const name of ["recommendationCount", "minTokenLength", "maxTextChars", "backgroundIndexing",
    "indexDelayMs", "allowMetadataOnlyRecommendations", "minFulltextTerms",
    "backgroundStartupDelayMs", "requestMissingFulltext"]) {
    var oldName = "extensions.zotero.relatedwork." + name;
    if (Services.prefs.prefHasUserValue(oldName)) {
     if (!Services.prefs.prefHasUserValue("extensions.zotero.similarworks." + name)) {
      Zotero.Prefs.set("similarworks." + name, Zotero.Prefs.get("relatedwork." + name));
     }
     Services.prefs.clearUserPref(oldName);
    }
   }
  }
  // Obsolete exposed controls have no equivalent in the minimal interface.
  for (const name of ["maxResults", "includeMetadataOnly", "recommendationRefreshIntervalMs"]) {
   var obsolete = "extensions.zotero.relatedwork." + name;
   if (Services.prefs.prefHasUserValue(obsolete)) Services.prefs.clearUserPref(obsolete);
  }
  return newDB;
 }
};
