# Similar Works

<img src="icons/icon-256.png" width="64" height="64" alt="Similar Works" />

[English](README.md)

[![Built with ChatGPT](https://img.shields.io/badge/Built_with-ChatGPT-10A37F?style=flat)](https://chatgpt.com/) [![Built with DeepSeek](https://img.shields.io/badge/Built_with-DeepSeek-4D6BFE?style=flat)](https://www.deepseek.com/)

在 Zotero 侧栏查找同一文献库中的相似文献，复用已有全文缓存，所有处理都在本机完成。

## 功能

- 推荐同一文献库中的相关文献。
- 点击刷新更新推荐，点击结果跳转到对应条目。
- 增量维护本地索引，支持英文与中日韩文本。

## 安装

需要 Zotero 10。从[最新发布](https://github.com/lzcn/zotero-similar-works/releases/latest)下载 `.xpi` 安装包。

在 Zotero 的“工具 → 插件”中，点击齿轮菜单，选择“从文件安装插件”，选择 `.xpi` 文件后重启。

## 使用

在 **设置 → Similar Works** 中选择 **Text** 使用文本匹配，或 **Semantic** 使用本地神经网络向量。Semantic 目前支持 macOS，使用 MiniLM-L6，主要适合英文论文。首次使用会下载约 23 MB 模型权重及分词文件，优先从 Hugging Face 下载，失败时使用 hf-mirror.com 镜像；文献内容不上传。

选中文献，在右侧栏展开 Similar Works，自动计算推荐。已有缓存立即显示；索引变化或缓存超过 24 小时后，后台更新结果。点击刷新可强制重算，点击结果打开文献。

Semantic 在独立 Worker 中逐篇运行，只保存每篇论文的一个向量；已有向量复用，条目变化后重建。后台尚未完成时，推荐可能不完整。切换到 Text 会暂停语义索引。

索引在后台逐步建立。推荐根据标题、摘要和正文匹配，过滤低分结果和疑似重复文献。首次全文索引完成前，结果可能不完整。

## 数据与备份

索引保存在 Zotero 数据目录的 `similar-works/similarity.sqlite`。词频索引和推荐结果均保存在这里。它是可重新生成的缓存，不修改 Zotero 原始全文数据库。

后台索引进度可在 Zotero 数据目录的 `similar-works/index-status.json` 中查看，包括已索引条目数、总数和当前状态。

## 开发

需要 Node.js 22.13+（22.x）或 24+。在插件目录中执行：

```sh
npm ci             # 安装锁定依赖
npm run build      # 类型检查并生成 XPI
npm run check      # 格式、静态检查、测试与构建
npm run release    # 完整检查并准备本地发布文件
```

本地调试：安装 `dist/zotero-similar-works.xpi`，重启 Zotero 并检查插件功能。修改后重新构建并安装。

本地发布文件位于 `release/`，包含安装包、`SHA256SUMS` 和 `updates.json`。此命令不会上传文件或创建 Git tag。

## 许可证

Copyright © 2026 Zhi Lu. [AGPL-3.0-or-later](LICENSE)。第三方库保留各自的许可证。
