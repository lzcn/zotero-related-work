# Related Work

<img src="icons/icon-256.png" width="64" height="64" alt="Related Work" />

[![AI-assisted development: ChatGPT](https://img.shields.io/badge/AI--assisted-ChatGPT-10A37F?style=flat)](https://chatgpt.com/) [![AI-assisted development: DeepSeek](https://img.shields.io/badge/AI--assisted-DeepSeek-4D6BFE?style=flat)](https://www.deepseek.com/)

本项目的代码几乎全部由 ChatGPT 和 DeepSeek 生成。

[English](README.md) | **简体中文**

在 Zotero 中复用已有全文缓存，查找同一文献库中的相似文献。文本处理在本机完成。

## 安装

需要 Zotero 10。从[最新发布](https://github.com/lzcn/zotero-related-work/releases/latest)下载 XPI，通过 **工具 → 插件 → 从文件安装插件** 安装，然后重启 Zotero。

## 使用

选择文献并展开侧栏中的 **相关研究**。点击刷新重新计算推荐，点击结果打开文献。后台索引及条目修改会更新缓存；索引完成前，推荐结果可能不完整。

**建议标签** 同时考虑标签与当前文献的匹配程度，以及相似文献的支持。已有标签显示蓝色，新标签显示紫色并标注 **新建**；新标签候选来自标题和摘要中重复出现的主题词。选择标签并点击 **添加所选标签**，插件不会自动添加。已添加的标签不参与推荐，已有标签限定在当前文献库内。文本模式匹配主题词；语义模式还会使用同一本地模型比较候选标签与文献向量，模型就绪前使用文本匹配。

通过 **工具 → 标签管理** 查看全部标签及其条目数量 `(n)`，受保护的标签不显示。支持逐个选择、按住 Shift 点选连续范围，以及 **全选**。搜索和 **可能重复** 用于筛选；重复候选包括格式变化、单复数、词序、模型名称别名和相近拼写，仅供建议，选择合并后才修改标签。全选作用于筛选结果；列表聚焦时也可使用 Cmd/Ctrl+A。

操作分为 **合并**（默认）、**重命名** 和 **删除**。合并将所选标签统一为一个名称；重命名支持手动修改单个名称或分别转换多个标签，仅在目标重名时合并；删除从条目中移除所选标签，保留文献和笔记。核对预览后点击对应操作按钮，修改使用 Zotero 原生标签接口。

标签名称固定使用空格。在设置中选择 **句首大写**（默认）或 **每词首字母大写**，并单独选择是否加 `#`。已知模型名保留标准写法；现有缩写、`PyTorch` 这类混合大小写名称及 `co-attention` 这类词内连字符也会保留。本地 `data/tag-terms.json` 词表结合 Hugging Face Transformers 的模型名称与项目维护的研究术语，随插件打包，不会把标签名称发送到网上。有颜色的标签默认受保护；其他名称在 **排除标签** 中填写，每行一个，其同类写法也受保护。

在 **设置 → Related Work** 中选择 **文本匹配** 或 **语义匹配**。语义匹配目前仅支持 macOS，使用 `Xenova/all-MiniLM-L6-v2`，主要适合英文文献。首次使用从 Hugging Face 下载约 23 MB 权重及分词文件，失败时使用 hf-mirror.com。每篇文献保存一个本地向量；切换到文本匹配会暂停语义索引。

设置页同时显示当前构建、文本索引、语义向量数量和处理进度。模型只需下载一次，文献内容始终在本机处理。

## 数据与备份

可重建的索引位于 Zotero 数据目录的 `related-work/similarity.sqlite`，进度记录在 `related-work/index-status.json`。改名后首次启动时，插件会在打开 SQLite 前将旧 `similar-works/` 目录整体迁移到 `related-work/`，包括模型缓存和进度文件。若新旧目录同时存在，报错且不覆盖任何一边。插件不修改 Zotero 原始全文数据库。

## 开发

需要 Node.js 22.13+（22.x）或 24+。依次运行 `npm ci`、`npm run check`。

- `npm run build`：输入未变化时复用有效产物。
- `npm run build:force`：强制重建。
- `npm run check`：格式、静态检查、测试和类型检查；复用有效 XPI。
- `npm run release`：完整检查后，在 `release/v<版本>/` 准备 XPI、`SHA256SUMS` 和 `updates.json`。

`npm run test:host` 使用临时配置和数据目录验证安装包启动、本地化及资源释放。通过 `ZOTERO_BINARY` 指定其他宿主程序。

构建产物：`dist/zotero-related-work.xpi`。安装后在 Zotero 中验证改动。本地发布准备不创建 tag 或上传文件。共同开发规范见工作区根目录 `AGENTS.md`。

## 许可证

Copyright © 2026 Zhi Lu. [AGPL-3.0-or-later](LICENSE)。第三方库保留各自许可证。
