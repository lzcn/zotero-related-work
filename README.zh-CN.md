# Similar Works

<img src="icons/icon-256.png" width="64" height="64" alt="Similar Works" />

[English](README.md)

[![Built with ChatGPT](https://img.shields.io/badge/Built_with-ChatGPT-10A37F?style=flat)](https://chatgpt.com/) [![Built with DeepSeek](https://img.shields.io/badge/Built_with-DeepSeek-4D6BFE?style=flat)](https://www.deepseek.com/)

在 Zotero 侧栏查找同一文献库中的相似文献，复用已有全文缓存，所有处理都在本机完成。

## 功能

- 推荐最多 10 篇相似文献。
- 点击刷新更新推荐，点击结果跳转到对应条目。
- 增量维护本地索引，支持英文与中日韩文本。

## 安装

需要 Zotero 7–10。

在 Zotero 的“工具 → 插件”中，点击齿轮菜单，选择“从文件安装插件”，选择 `.xpi` 文件后重启。

## 使用

选中文献，在右侧栏展开 Similar Works，自动计算推荐。已有缓存立即显示；索引变化或缓存超过 24 小时后，后台更新结果。点击刷新可强制重算，点击结果打开文献。

索引与推荐计算共用分批执行的队列，当前条目的请求在后台分词批次之间优先处理。只对有共同词项的文献计算相似度；索引更新稳定后再更新旧缓存。折叠面板或切换条目会取消计算。

## 数据与备份

索引保存在 Zotero 数据目录的 `similar-works/similarity.sqlite`。词频索引和推荐结果均保存在这里。它是可重新生成的缓存，不修改 Zotero 原始全文数据库。

## 开发

需要 Node.js 22.13+（22.x）或 24+。在插件目录中执行：

```sh
npm ci             # 安装锁定依赖
npm run build      # 类型检查并生成 XPI
npm run check      # 格式、静态检查、测试与构建
npm run release    # 完整检查并准备本地发布文件
```

本地调试：安装 `dist/zotero-similar-works.xpi`，重启 Zotero 并检查插件功能。修改后重新构建并安装。

发布文件位于 `release/v0.1.0/`，包含 `zotero-similar-works-0.1.0.xpi`、`SHA256SUMS` 和 `updates.json`。`npm run release` 不上传文件；正式发布时，将安装包和 `updates.json` 上传到对应版本的 Release assets。

## 许可证

Copyright © 2026 Zhi Lu. [AGPL-3.0-or-later](LICENSE)。第三方库保留各自的许可证。

索引在后台缓慢建立。每篇保存 256 个特征，标题、摘要、正文按 4/2/1 加权，并用 BM25 饱和权重生成指纹。Block-Max WAND 召回最多 300 个候选，再用稀疏余弦排序和 SimHash 过滤疑似重复。缓存保存前 50 个结果，侧栏显示 10 个；首次全文索引完成前，结果可能不完整。
