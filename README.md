# Similar Works

<img src="icons/icon-256.png" width="64" height="64" alt="Similar Works" />

[中文](README.zh-CN.md)

Find similar papers in the same Zotero library using the existing full-text cache. Text processing stays on your computer.

## Install and use

Requires Zotero 10. Download the XPI from the [latest release](https://github.com/lzcn/zotero-similar-works/releases/latest), install it through **Tools → Plugins → Install Plugin From File**, and restart Zotero.

Select a paper and expand **Similar Works** in the sidebar. Refresh recalculates recommendations; clicking a result opens the paper. Background indexing and changed items update cached results. Recommendations may be incomplete until indexing finishes.

In **Settings → Similar Works**, choose **Text** or **Semantic**. Semantic currently supports macOS and uses MiniLM-L6, mainly for English papers. Its first use downloads about 23 MB of weights plus tokenizer files from Hugging Face, falling back to hf-mirror.com. It stores one local vector per paper; switching to Text pauses semantic indexing.

## Data

The rebuildable index is in `similar-works/similarity.sqlite` under the Zotero data directory. Progress is recorded in `similar-works/index-status.json`. The plugin does not modify Zotero's original full-text database.

## Development

Use Node.js 22.13+ (22.x) or 24+. Run `npm ci`, then `npm run check`.

- `npm run build`: reuse valid output when inputs have not changed.
- `npm run build:force`: rebuild from scratch.
- `npm run check`: formatting, lint, tests and type checking; reuse valid XPI output.
- `npm run release`: full checks, then prepare the XPI, `SHA256SUMS` and `updates.json` under `release/v<version>/`.

`npm run test:host` verifies packaged startup, localization and cleanup with temporary profile and data directories. Set `ZOTERO_BINARY` to select another host executable.

Build output: `dist/zotero-similar-works.xpi`. Install and verify changes in Zotero. Release preparation does not create a tag or upload files. Shared working rules live in the plugin workspace's root `AGENTS.md`.

## License

Copyright © 2026 Zhi Lu. [AGPL-3.0-or-later](LICENSE). Third-party licenses remain applicable.
