# Similar Works

[![Built with ChatGPT](https://img.shields.io/badge/Built_with-ChatGPT-10A37F?style=flat)](https://chatgpt.com/) [![Built with DeepSeek](https://img.shields.io/badge/Built_with-DeepSeek-4D6BFE?style=flat)](https://www.deepseek.com/)

[中文](README.zh-CN.md)

Find up to 10 similar papers in your Zotero library. Click refresh to update the list, then click a result to open the item. Uses Zotero's full-text cache. All processing stays on your computer.

## Build and install

Requires Node.js 22.13+ (22.x) or 24+ and Zotero 7–10. Only source code is published for now.

```sh
npm ci             # Install dependencies
npm run check      # Run tests, build, and check code
npm run release    # Create a checked local release
```

In Zotero's Plugins Manager, choose **Install Plugin From File** and open `release/v0.1.0/similar-works-0.1.0.xpi`.

When upgrading from an older development version, disable the old plugin and restart Zotero first. Existing data will be moved automatically.

## License

Copyright © 2026 Zhi Lu. [AGPL-3.0-or-later](LICENSE).
