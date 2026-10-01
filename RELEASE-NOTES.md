Similar Works adds a compact sidebar with up to 10 similar items from the current Zotero library.

- Reuses text already extracted by Zotero; builds term-frequency vectors incrementally in the background.
- Calculates TF-IDF cosine similarity when Refresh is clicked, with immediate status and a thin progress bar.
- Stores document vectors and source modification records locally, without an all-pairs similarity matrix or persisted recommendation scores.
- Migrates the legacy plugin data folder to `similar-works` while preserving existing vectors. Disable the old plugin and restart Zotero before upgrading.

Install `similar-works.xpi` via Zotero → Tools → Plugins → Install Plugin From File.

This release is prepared as a draft. The latest v0.1.0 package has not been runtime-tested in Zotero; installation, migration, and sidebar behavior still need acceptance checks. Zotero 7–10 is the declared compatibility range; the local reference installation is 10.0.5.
