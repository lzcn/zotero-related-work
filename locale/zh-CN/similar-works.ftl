similar-works-header =
    .label = 相关研究
similar-works-sidenav =
    .tooltiptext = 相关研究
similar-works-refresh =
    .tooltiptext = 刷新相似文献
similar-works-computing = 正在计算相似度...
similar-works-empty = 当前文献库中没有相似文献
similar-works-no-text = 此条目没有可分析的全文或摘要
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

similar-works-pref-intro = 自动查找相关文献。在 macOS 上，本地模型就绪后会结合语义匹配改进文本结果。首次使用需下载模型，文献内容不会上传。
similar-works-pref-index-heading = 索引状态
similar-works-pref-build = 当前构建
similar-works-pref-index = 文本索引
similar-works-pref-vectors = 语义向量
similar-works-pref-model = 模型
similar-works-pref-model-value = { $model } · { $dimensions } 维 · { $version }
similar-works-pref-index-value = { $known ->
    [1] { $phase } · 已索引 { $count } / { $total } 篇 · 待处理 { $pending } 篇
   *[0] { $phase } · 已索引 { $count } 篇 · 待处理 { $pending } 篇
    }
similar-works-pref-vector-value = { $phase } · 已生成 { $count } / { $total } 篇 · 待处理 { $pending } 篇
similar-works-pref-index-progress =
    .aria-label = 文本索引进度
similar-works-pref-vector-progress =
    .aria-label = 语义向量生成进度
similar-works-state-preparing = 正在加载索引
similar-works-state-waiting = 等待处理
similar-works-state-scanning = 正在扫描文献库
similar-works-state-indexing = 正在索引
similar-works-state-idle = 已完成
similar-works-state-disabled = 已暂停
similar-works-state-stopped = 已停止
similar-works-state-error = 处理失败
similar-works-state-loading = 正在加载模型
similar-works-state-downloading = 正在下载模型

similar-works-tags-suggested = 推荐标签
similar-works-tags-organize = 标签管理
similar-works-tags-menu =
    .label = 标签管理
similar-works-tags-add = 添加选中的标签
similar-works-tags-empty = 暂无推荐标签。
similar-works-tags-added = 已添加 { $count } 个标签。
similar-works-tags-search =
    .placeholder = 搜索已有标签…
    .aria-label = 搜索已有标签
similar-works-tags-duplicates = 可能重复
similar-works-tags-keep = 名称
similar-works-tags-preview = 已选 { $tags } 个标签，涉及 { $count } 个条目
similar-works-tags-close = 关闭
similar-works-tags-merged = 已将 { $count } 个标签统一为“{ $name }”。
similar-works-tags-readonly = 当前文献库或条目不可编辑。
similar-works-tags-changed = 标签已变化，请刷新列表后重新选择。
similar-works-tags-cancelled = 操作已取消。
similar-works-tags-error = 无法更新标签：{ $message }

similar-works-tags-refresh = 刷新
similar-works-tags-existing = 已有
similar-works-tags-new = 新标签
similar-works-tags-invalid-name = 请输入有效的标签名称，不含控制字符，长度不超过 255 个字符。

similar-works-pref-tags-heading = 标签名称
similar-works-pref-tag-style =
    .value = 名称格式
similar-works-pref-tag-hashtag =
    .label = 在开头加 #
similar-works-pref-tag-help = 用于新标签推荐和格式转换预览。

similar-works-pref-exclude-colored-tags =
    .label = 排除有颜色的标签
similar-works-pref-excluded-tags =
    .value = 排除标签
similar-works-pref-excluded-tags-help = 每行一个标签名称，保护该名称及同类写法。
similar-works-tags-protected = 所选名称已被排除。请刷新列表，或检查设置中的“标签名称”。

similar-works-tags-select-all = 全选
similar-works-tags-selection-count = 已选 { $selected } 个，共 { $total } 个标签
similar-works-tags-action = 操作
similar-works-tags-format = 重命名
similar-works-tags-merge-action = 合并
similar-works-tags-preparing = 正在准备预览…
similar-works-tags-format-preview = 修改 { $count } 个名称，涉及 { $items } 个条目，合并 { $merges } 个标签
similar-works-tags-formatted = 已转换 { $count } 个标签的格式。
similar-works-tags-no-matches = 没有匹配的标签。

similar-works-tags-delete-action = 删除

similar-works-tags-delete-button = 删除

similar-works-tags-merge-button = 合并

similar-works-tags-rename-button = 重命名

similar-works-tags-delete-preview = 从 { $count } 个条目移除 { $tags } 个标签，保留条目。

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
similar-works-graph-hint = 选择文献查看详情和相似度，双击在 Zotero 中显示。
similar-works-graph-stats = { $nodes } 篇文献 · { $edges } 条连接
similar-works-graph-loading = 正在比较文献…
similar-works-graph-changed = 文献库或索引已变化，刷新以更新连接。
similar-works-graph-cancelled = 已取消比较
similar-works-graph-error = 无法加载关系图：{ $message }
similar-works-graph-unavailable = 此文献已不可用
similar-works-graph-no-index = 此文献的相似度索引尚未就绪，索引完成后可刷新。
similar-works-graph-years =
    .title = 发表年份：越新的文献颜色越深，年份未知时显示灰色。
