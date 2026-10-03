# Similar Works

<img src="icons/icon-256.png" width="64" height="64" alt="Similar Works" />

[![AI-assisted development: ChatGPT](https://img.shields.io/badge/AI--assisted-ChatGPT-10A37F?style=flat)](https://chatgpt.com/) [![AI-assisted development: DeepSeek](https://img.shields.io/badge/AI--assisted-DeepSeek-4D6BFE?style=flat)](https://www.deepseek.com/)

本项目的代码几乎全部由 ChatGPT 和 DeepSeek 生成。

[English](README.md) | **简体中文**

在 Zotero 中复用已有全文缓存，查找同一文献库中的相似文献。文本处理在本机完成。

## 安装

需要 Zotero 10。从[最新发布](https://github.com/lzcn/zotero-similar-works/releases/latest)下载 XPI，通过 **工具 → 插件 → 从文件安装插件** 安装，然后重启 Zotero。

## 使用

选中文献，在侧栏展开 **Similar Works**。点击刷新重新计算推荐，点击结果打开文献。后台索引和条目变化会更新缓存；索引完成前，推荐可能不完整。

在 **设置 → Similar Works** 中选择 **文本匹配** 或 **语义匹配**。语义匹配目前仅支持 macOS，使用 `Xenova/all-MiniLM-L6-v2`，主要适合英文文献。首次使用从 Hugging Face 下载约 23 MB 权重及分词文件，失败时使用 hf-mirror.com。每篇文献保存一个本地向量；切换到文本匹配会暂停语义索引。

## 数据与备份

可重建的索引位于 Zotero 数据目录的 `similar-works/similarity.sqlite`，进度记录在 `similar-works/index-status.json`。插件不修改 Zotero 原始全文数据库。

## 开发

需要 Node.js 22.13+（22.x）或 24+。依次运行 `npm ci`、`npm run check`。

- `npm run build`：输入未变化时复用有效产物。
- `npm run build:force`：强制重建。
- `npm run check`：格式、静态检查、测试和类型检查；复用有效 XPI。
- `npm run release`：完整检查后，在 `release/v<版本>/` 准备 XPI、`SHA256SUMS` 和 `updates.json`。

`npm run test:host` 使用临时配置和数据目录验证安装包启动、本地化及资源释放。通过 `ZOTERO_BINARY` 指定其他宿主程序。

构建产物：`dist/zotero-similar-works.xpi`。安装后在 Zotero 中验证改动。本地发布准备不创建 tag 或上传文件。共同开发规范见工作区根目录 `AGENTS.md`。

## 许可证

Copyright © 2026 Zhi Lu. [AGPL-3.0-or-later](LICENSE)。第三方库保留各自许可证。
