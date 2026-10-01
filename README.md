# Similar Works v0.1.0

在 Zotero 条目和阅读器右侧栏推荐同一文献库中最相似的前 10 篇文献。点击刷新圈后立即显示计算状态与细进度条，完成后显示“已更新”；推荐标题最多两行，点击结果跳转到对应条目。后台不展示建库数量，也不自动刷新推荐列表。

## 数据和计算

- 复用 Zotero 已提取的 `.zotero-ft-cache`，不自行解析 PDF，也不要求 Zotero 重建缺失的全文索引。无可用全文时使用标题、摘要和作者。
- 后台只建立每篇文献的词频向量，持久化到 `<Zotero 数据目录>/similar-works/similarity.sqlite`。启动延迟 15 秒，逐篇间隔 1 秒；长文分词分批让出主线程。
- `source_updates` 记录 Item 修改时间、文本来源指纹及检查时间；`doc_updates` 记录向量更新时间。全文指纹使用附件 key、缓存修改时间、大小；元数据使用内容指纹。无内容变化时不重复分词。
- 监听 Item 和全文索引变更，增量更新向量；子附件归并到父文献，删除与移入回收站清理相应向量。
- 每次点击刷新，检查当前文献向量，再用当前已建立的同库向量在线计算 TF-IDF 余弦分数并排序。计算在短批次之间休息，让界面保持响应；切换文献取消旧显示任务，计算期间保留已有结果。
- 不在后台预计算全库两两相似度矩阵，不持久化推荐分数。旧版本可能留下的 `recommendations` 表不再读取或写入，暂保留用于兼容回退。
- 数据库尚在加载时，刷新请求显示计算状态并等待加载完成，随后继续执行，不需要再次点击。

词频向量和词项总数决定存储大小，不会额外保存 n×n 分数矩阵。单次刷新耗时随候选文献和词项数增长；TF-IDF 的全库文档频率在每次计算时取快照，避免后台更新混用不同权重。百分比是余弦分数，不是相关概率；这是一种词汇统计相似度。

## 安装与升级

发布仓库：https://github.com/lzcn/zotero-similar-works

公开版本可从 [Releases](https://github.com/lzcn/zotero-similar-works/releases) 下载 `similar-works.xpi`。

```sh
./build.sh
```

Zotero → Tools → Plugins → Tools for all plugins → Install Plugin From File → 选择 `similar-works.xpi`。

显示名为 Similar Works；源码目录、安装包、图标、翻译文件与数据目录统一使用 `similar-works`。插件 ID 为 `similar-works@zhi.dev`，配置前缀为 `extensions.zotero.similarworks`。

升级旧版时先停用旧插件并重启 Zotero，使数据库连接关闭，再安装新版。首次启动把整个旧数据目录 `related-work` 移动为 `similar-works`，包括数据库和 WAL 文件，复用已有向量；同时迁移旧配置并清理旧配置键。目标目录已经存在时停止迁移，避免覆盖或错误使用空库。旧标识仅在迁移兼容代码里出现。

`<Zotero 数据目录>/fulltext.sqlite` 是 Zotero 自身的全文检索数据库，不是本插件创建的文件，必须保留原名。插件读取 Zotero 提取的全文缓存，自建词频向量存于 `similar-works/similarity.sqlite`。

需要 Zotero 7–10；当前验收环境为 Zotero 10.0.5。Zotero 10 安装校验要求 `applications.zotero.update_url`，manifest 保留 `https://raw.githubusercontent.com/lzcn/zotero-similar-works/main/updates.json`。更新清单由构建脚本生成，安装包来自本仓库 Release；发布草稿公开之前，其下载地址不可用。

内部 `recommendationCount = 10`、`allowMetadataOnlyRecommendations = true`，均不提供设置界面。扫描版或缺失全文的文献会回退到元数据。零词项重叠时不推荐；可用候选不足时显示少于 10 篇。

## 开发与验证

```sh
node tests/test.js
node --test tests/*.test.js
./build.sh
```

84 项算法断言，18 组模拟 Zotero/DOM/SQLite 集成测试。覆盖附件归并、增量通知、删除清理、在线排序、点击与切换竞争、分词让出线程、未变化全文跳过读取、修改时间持久化、数据库加载期间刷新、bootstrap 与 Fluent。模拟测试不代替实机安装与界面验收。

本次 v0.1.0 按要求仅做离线源码、打包和升级文件准备，不启动 Zotero，不运行测试。上列测试数量描述现有测试集，不表示本次发布构建已验收。旧数据库中的历史分数缓存不再使用，保留原文件便于回退。
