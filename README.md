# Related Work

<img src="icons/icon-256.png" width="64" height="64" alt="Related Work" />

**English** | [简体中文](README.zh-CN.md)

Find similar papers in your Zotero library. Text processing stays on your computer.

## Install

Requires Zotero 10. Download the XPI from [Releases](https://github.com/lzcn/zotero-related-work/releases/latest), install it through **Tools → Plugins → Install Plugin From File**, and restart Zotero.

## Use

- Select a paper and open **Related Work** in the sidebar. Click a result to navigate; **From** returns to the previous paper.
- Select **Suggested tags**, then click **Add selected**.
- Open **Tools → Tag Manager** to merge, rename, format or remove tags. Review changes before applying.

Settings control tag naming and protected tags. Recommendations combine text matching with local semantic matching on macOS. First use downloads about 90 MB of model weights plus tokenizer files; text results remain available during preparation and on other platforms. Semantic matching mainly supports English papers. The similarity graph is currently unavailable.

The interface uses a fixed Bear-inspired palette with compact recommendation lists and tag tables. Colors follow the system’s light or dark appearance; Settings use Zotero’s native controls.

## Data

Rebuildable caches live under `related-work/` in the Zotero data directory. The plugin leaves Zotero's original full-text database unchanged. Tag operations update native Zotero tags.

## Development

Use Node.js 22.13+ (22.x) or 24+.

```sh
npm ci
npm run check
npm run build
```

Output: `dist/zotero-related-work.xpi`. `npm run test:host` uses disposable Zotero directories. `npm run release` prepares local files under `release/v<version>/` without uploading.

## License

Copyright © 2026 Zhi Lu. [AGPL-3.0-or-later](LICENSE). Code developed with ChatGPT and DeepSeek.
