# Similar Works

![Built with AI · GPT](https://img.shields.io/badge/Built%20with%20AI-GPT-412991?style=flat)

在 Zotero 右侧栏推荐同一文献库中相似的前 10 篇文献。点击刷新计算相似度，点击结果打开对应条目。复用 Zotero 全文缓存，所有计算在本地完成。

## 安装

需要 Zotero 7–10。目前仅公开源码，请自行构建：

```sh
./build.sh
```

在 Zotero 的插件管理页面选择 **Install Plugin From File**，打开生成的 `similar-works.xpi`。

从旧开发版升级时，请先停用旧插件并重启 Zotero；已有数据会自动迁移。
