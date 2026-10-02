# Similar Works

<img src="icons/icon-256.png" width="64" height="64" alt="Similar Works" />

[中文](README.zh-CN.md)

[![Built with ChatGPT](https://img.shields.io/badge/Built_with-ChatGPT-10A37F?style=flat)](https://chatgpt.com/) [![Built with DeepSeek](https://img.shields.io/badge/Built_with-DeepSeek-4D6BFE?style=flat)](https://www.deepseek.com/)

Find similar papers in your Zotero library. Uses the existing full-text cache, with all processing on your computer.

## Features

- Recommend up to 10 similar papers in the same library.
- Refresh recommendations and open results from the item sidebar.
- Maintain a local incremental index for English, Chinese, Japanese, and Korean text.

## Installation

Requires Zotero 7–10.

Open **Tools → Plugins** in Zotero, select **Install Plugin From File** from the gear menu, choose the `.xpi` file, and restart Zotero.

## Usage

Select an item and expand Similar Works to calculate recommendations automatically. Cached results appear immediately. When an item changes, its affected recommendations update in the background. Results are revalidated after an IDF rebuild or after 24 hours. Refresh forces a new calculation; click a result to open it.

Indexing runs slowly in the background. Queries use 256-feature, field-weighted BM25 fingerprints, Block-Max WAND to retrieve up to 300 candidates, and sparse cosine reranking. SimHash filters probable duplicates. Cached Top-50 lists update incrementally; the sidebar shows 10 results. First-time indexing must finish before full-text recommendations are available.

## Data and backup

The index is stored in `similar-works/similarity.sqlite` in your Zotero data directory. It can be rebuilt and does not modify Zotero’s original full-text database.

## Development

Requires Node.js 22.13+ (22.x) or 24+. Run these commands in the plugin directory:

```sh
npm ci             # Install locked dependencies
npm run build      # Check types and build the XPI
npm run check      # Check formatting, lint, tests, and build
npm run release    # Run all checks and prepare local release files
```

For local testing, install `dist/zotero-similar-works.xpi`, restart Zotero, and test the plugin. Rebuild and reinstall after changes.

Release files are prepared in `release/v0.1.0/`: `zotero-similar-works-0.1.0.xpi`, `SHA256SUMS`, and `updates.json`. `npm run release` does not upload files. For publication, upload the XPI and `updates.json` as assets of the corresponding version’s Release.

## License

Copyright © 2026 Zhi Lu. [AGPL-3.0-or-later](LICENSE). Third-party libraries keep their own licenses.
