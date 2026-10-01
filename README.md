# Similar Works

![AI Assisted · ChatGPT](.github/badges/ai-assisted-chatgpt.svg) ![AI Assisted · DeepSeek](.github/badges/ai-assisted-deepseek.svg)

[中文](README.zh-CN.md)

Find up to 10 similar papers in your Zotero library. Click refresh to update the list, then click a result to open the item. Uses Zotero's full-text cache. All processing stays on your computer.

## Build and install

Requires Node.js 22.13+ (22.x) or 24+ and Zotero 7–10. Only source code is published for now.

```sh
npm ci             # Install dependencies
npm run check      # Run tests, build, and check code
npm run release    # Create the local install package
```

In Zotero's Plugins Manager, choose **Install Plugin From File** and open `dist/similar-works.xpi`.

When upgrading from an older development version, disable the old plugin and restart Zotero first. Existing data will be moved automatically.

## License

Copyright © 2026 Zhi Lu. [AGPL-3.0-or-later](LICENSE).
