# v0.1.0 离线升级准备

2026-10-02，在 Zotero 已退出的情况下完成文件准备：

- 插件名 Similar Works，ID `similar-works@lzcn`，配置前缀 `extensions.zotero.similarworks`。
- 已有向量数据目录由 `related-work` 整体移动为 `similar-works`，包括 SQLite 数据库和 WAL；未打开或修改数据库内容。
- 旧插件安装包移出 profile 的 extensions 加载目录，当时的开发包已放入该目录；最终发布 ID 已改为 `similar-works@lzcn`，需安装最终新包。是否被 Zotero 首次加载仍待确认。
- 已继承有效的旧插件配置并移除旧配置键；废弃的 maxResults/includeMetadataOnly 控件配置不继承，仍默认 10 篇、包含仅元数据文献。
- Zotero 自身的 fulltext.sqlite、主数据库和其他插件文件未修改。
- 原插件包、数据目录、prefs.js 和 extensions.json 的回退副本保存在本地 `.local-backups/20261002-012746/`，不提交到 Git。

本次按用户要求不启动 Zotero，不运行测试。后续需要验收首次加载、复用旧向量、点击刷新进度与推荐结果。本记录不代表运行验收通过。

安装修正：本机 Zotero 10.0.5 要求 manifest 的 applications.zotero.update_url 必填；已补齐 Similar Works 更新地址并重新打包。更新服务尚未部署，修正后的安装包尚未做实际安装验收。

发布 ID 最终定为 similar-works@lzcn；旧开发 ID 仅用于迁移兼容，数据库目录不再变化。此次不操作本机 Zotero profile，不启动 Zotero、不运行测试。
