similar-works-header =
    .label = 相关研究
similar-works-sidenav =
    .tooltiptext = 相关研究
similar-works-refresh =
    .tooltiptext = 刷新相似文献
similar-works-computing = 查找相关文献…
similar-works-empty = 没有相关文献
similar-works-no-text = 没有全文或摘要
similar-works-unavailable = 相似度索引不可用
similar-works-based-on-weak = 仅元数据
similar-works-updated = 已更新

similar-works-cached = 已缓存
similar-works-updating = 更新中...
similar-works-preparing = 正在准备推荐...

similar-works-progress =
    .aria-label = 相似度计算进度

similar-works-pref-limit =
    .value = 最多显示条数
similar-works-pref-metadata =
    .label = 包含没有全文的文献

similar-works-pref-index-heading = 状态
similar-works-pref-index = 文献整理
similar-works-pref-error = 准备失败，请重启 Zotero 重试。
similar-works-pref-index-value = { $known ->
    [1] { $phase } · 已处理 { $count } / { $total } 篇
   *[0] { $phase } · 已处理 { $count } 篇
    }
similar-works-pref-index-progress =
    .aria-label = 文本索引进度
similar-works-state-preparing = 正在加载索引
similar-works-state-waiting = 等待处理
similar-works-state-scanning = 正在扫描文献库
similar-works-state-indexing = 正在索引
similar-works-state-idle = 已完成
similar-works-state-disabled = 已暂停
similar-works-state-stopped = 已停止
similar-works-state-error = 处理失败
similar-works-state-loading = 正在准备匹配
similar-works-state-downloading = 正在准备所需文件

similar-works-tags-suggested = 推荐标签
similar-works-tags-organize = 标签管理
similar-works-tags-menu =
    .label = 标签管理
similar-works-tags-add = 添加所选
similar-works-tags-empty = 暂无建议标签
similar-works-tags-added = 已添加 { $count } 个标签
similar-works-tags-search =
    .placeholder = 搜索已有标签…
    .aria-label = 搜索已有标签
similar-works-tags-duplicates = 可能重复
similar-works-tags-keep = 名称
similar-works-tags-preview = 已选 { $tags } 个标签，涉及 { $count } 个条目
similar-works-tags-close =
    .label = 关闭
similar-works-tags-merged = 已将 { $count } 个标签统一为“{ $name }”。
similar-works-tags-readonly = 当前文献库或条目不可编辑。
similar-works-tags-changed = 标签已变化，请刷新后重选。
similar-works-tags-cancelled = 操作已取消。
similar-works-tags-error = 无法更新标签：{ $message }

similar-works-tags-refresh =
    .label = 刷新
similar-works-tags-existing = 已有
similar-works-tags-invalid-name = 请输入有效名称（最多 255 字符）。

similar-works-pref-tags-heading = 标签名称
similar-works-pref-tag-style =
    .value = 名称格式
similar-works-pref-tag-hashtag =
    .label = 在开头加 #

similar-works-pref-exclude-colored-tags =
    .label = 排除有颜色的标签
similar-works-pref-excluded-tags =
    .value = 排除标签
similar-works-pref-excluded-tags-help = 每行一个名称，含同名变体。
similar-works-tags-protected = 标签已被排除，请检查设置。

similar-works-tags-select-all = 全选
similar-works-tags-selection-count = { $visible } / { $total } · 已选 { $selected }
    { $hidden ->
        [0] { "" }
       *[other] · { $hidden } 项隐藏
    }
similar-works-tags-action = 操作
similar-works-tags-format = 重命名
similar-works-tags-merge-action = 合并
similar-works-tags-preparing = 正在准备预览…
similar-works-tags-format-preview = 改名 { $count } · 条目 { $items } · 合并 { $merges }
similar-works-tags-formatted = 已转换 { $count } 个标签的格式。
similar-works-tags-no-matches = 没有匹配的标签。

similar-works-tags-delete-action = 删除

similar-works-tags-delete-button =
    .label = 删除

similar-works-tags-merge-button =
    .label = 合并

similar-works-tags-rename-button =
    .label = 重命名

similar-works-tags-delete-preview = 从 { $count } 个条目移除 { $tags } 个标签？

similar-works-tags-rename-preview = 重命名 { $count } 个条目上的标签。

similar-works-tags-deleted = 已删除 { $count } 个标签。

similar-works-tags-renamed = 已改名为“{ $name }”。

similar-works-pref-tag-sentence =
    .label = 句首大写
similar-works-pref-tag-title =
    .label = 每词首字母大写

similar-works-graph-title = 相关研究关系图
    .label = 相关研究关系图
similar-works-graph-show = 在关系图中显示
similar-works-graph-search =
    .placeholder = 搜索文献
    .aria-label = 搜索文献
similar-works-graph-fit = 适应窗口
similar-works-graph-refresh = 刷新
similar-works-graph-cancel = 取消
similar-works-graph-canvas =
    .aria-label = 文献相似度关系图。拖动平移，捏合或按住 Ctrl/Command 滚动缩放。按 +、− 和 0 缩放或适应窗口。
similar-works-graph-resize =
    .aria-label = 调整文献详情宽度
similar-works-graph-empty = 当前视图没有文献
similar-works-graph-open = 在 Zotero 中显示
similar-works-graph-connections = 相似文献
similar-works-graph-hint = 单击选择，双击打开。
similar-works-graph-stats = { $nodes } 篇文献 · { $edges } 条连接
similar-works-graph-loading = 正在比较文献…
similar-works-graph-changed = 文献库已变化，请刷新。
similar-works-graph-cancelled = 已取消比较
similar-works-graph-error = 无法加载关系图：{ $message }
similar-works-graph-unavailable = 此文献已不可用
similar-works-graph-no-index = 尚未就绪，请稍后刷新。
similar-works-graph-years =
    .title = 发表年份：越新的文献颜色越深，年份未知时显示灰色。

similar-works-tags-clear-selection =
    .label = 清除选择

similar-works-pref-vectors = 相关文献匹配

similar-works-pref-vector-value = { $phase } · 已处理 { $count } / { $total } 篇

similar-works-pref-vector-progress =
    .aria-label = 相关文献匹配进度

similar-works-source = 来自

similar-works-tags-window =
    .title = 标签管理

similar-works-tags-new = 新标签

similar-works-tags-name-column = 名称
similar-works-tags-count-column = 条目数
similar-works-tags-group-column = 匹配
similar-works-tags-format-action = 统一格式
similar-works-tags-match-name = 名称变体
similar-works-tags-match-plural = 单复数
similar-works-tags-match-abbreviation = 缩写
similar-works-tags-match-spelling = 拼写相近

similar-works-tags-collision = 该名称已存在，标签将合并。
similar-works-tags-format-button =
    .label = 统一格式

similar-works-tags-match-alias = 术语别名
