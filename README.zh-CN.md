# Similar Works

[![Built with ChatGPT](https://img.shields.io/badge/Built_with-ChatGPT-10A37F?style=flat)](https://chatgpt.com/) [![Built with DeepSeek](https://img.shields.io/badge/Built_with-DeepSeek-4D6BFE?style=flat)](https://www.deepseek.com/)

[English](README.md)

在 Zotero 右侧栏推荐同一文献库中相似的前 10 篇文献。点击刷新更新列表，点击结果打开对应条目。复用 Zotero 全文缓存，所有处理都在本机完成。

## 构建与安装

需要 Node.js 22.13+（22.x）或 24+，以及 Zotero 7–10。目前仅公开源码。

```sh
npm ci             # 安装依赖
npm run check      # 测试、构建和代码检查
npm run release    # 检查并生成本地版本包
```

在 Zotero 插件管理页面选择 **Install Plugin From File**，打开 `release/v0.1.0/similar-works-0.1.0.xpi`。

从旧开发版升级时，先停用旧插件并重启 Zotero；已有数据会自动迁移。

## 许可证

Copyright © 2026 Zhi Lu. [AGPL-3.0-or-later](LICENSE).
