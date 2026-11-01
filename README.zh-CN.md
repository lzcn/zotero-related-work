# Related Work

<img src="icons/icon-256.png" width="64" height="64" alt="Related Work" />

[English](README.md) | **简体中文**

在 Zotero 文献库中查找相似文献，文本处理在本机完成。

## 安装

需要 Zotero 10。从 [Releases](https://github.com/lzcn/zotero-related-work/releases/latest) 下载 XPI，通过 **工具 → 插件 → 从文件安装插件** 安装，然后重启 Zotero。

## 使用

- 选择文献，展开侧栏中的 **相关研究**。点击结果跳转，点击 **来自** 返回上一篇文献。
- 选择 **建议标签**，点击 **添加所选**。
- 打开 **工具 → 标签管理**，合并、重命名、统一格式或移除标签，核对后应用。

在设置中调整标签命名和受保护标签。推荐结合文本匹配与 macOS 本地语义匹配。首次使用下载约 90 MB 模型权重及分词文件；准备期间和其他平台仍提供文本结果。语义匹配主要适合英文文献，相似度关系图暂不开放。

界面以 Bear 配色为基础，采用固定样式，推荐列表和标签表格保持紧凑。颜色跟随系统的浅色或深色外观；设置页使用 Zotero 原生控件。

## 数据

可重建缓存位于 Zotero 数据目录的 `related-work/`，原始全文数据库保持不变。标签操作会修改 Zotero 原生标签。

## 开发

需要 Node.js 22.13+（22.x）或 24+。

```sh
npm ci
npm run check
npm run build
```

产物：`dist/zotero-related-work.xpi`。`npm run test:host` 使用临时 Zotero 目录；`npm run release` 在 `release/v<版本>/` 准备本地文件，不上传。

## 许可证

Copyright © 2026 Zhi Lu. [AGPL-3.0-or-later](LICENSE)。代码借助 ChatGPT 和 DeepSeek 开发。
