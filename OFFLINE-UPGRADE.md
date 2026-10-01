# v0.1.0 离线升级准备

2026-10-02，在 Zotero 已退出的情况下完成文件准备：

- 插件名 Similar Works，ID `similar-works@zhi.dev`，配置前缀 `extensions.zotero.similarworks`。
- 已有向量数据目录由 `related-work` 整体移动为 `similar-works`，包括 SQLite 数据库和 WAL；未打开或修改数据库内容。
- 旧插件安装包移出 profile 的 extensions 加载目录，新 `similar-works@zhi.dev.xpi` 放入该目录。是否被 Zotero 首次加载仍待确认。
- 已继承有效的旧插件配置并移除旧配置键；废弃的 maxResults/includeMetadataOnly 控件配置不继承，仍默认 10 篇、包含仅元数据文献。
- Zotero 自身的 fulltext.sqlite、主数据库和其他插件文件未修改。
- 原插件包、数据目录、prefs.js 和 extensions.json 的回退副本保存在本地 `.local-backups/20261002-012746/`，不提交到 Git。

本次按用户要求不启动 Zotero，不运行测试。后续需要验收首次加载、复用旧向量、点击刷新进度与推荐结果。本记录不代表运行验收通过。
