# Design：explainable-selection

## 原则

1. **解释已有判断，不另做一套分。** `attentionScore` 仍由五轴×类型权重得到；门槛仍是 `SELECTION.thresholds[tier]`。
2. **读者面，不是 Admin。** 只暴露分数、门槛对照、分级、可选五轴短条、通稿合并一句；不暴露 receipt、模型名、预筛理由。
3. **旧稿可降级。** 历史 `analyses.output` 无轴时，仍可展示分数 / 门槛 / 分级（门槛与分级可从 output 或 `sources.tier` 取得）。
4. **通稿说明可选。** 仅当同指纹存在其他报道时出现；热点 `whyHot` 仅当本事件报道数 > 独立证据键时出现。

## 数据流

```
score LLM → { attentionScore, contentType?, axes? }
  → analyses.output (+ threshold, scores, sourceTier, scoreAxes, contentType)
  → SiteItemDetail.selectionExplain / FeedItemSummary.selectionHint
  → 详情「为何入选」+ 卡片 Score title
```

两次独立评分的轴取整均值；`contentType` 取首次成功解析的值（两次不一致时仍以加权和为准，类型仅供展示）。

## UI

- 详情右侧轨：在评分/理由附近增加「为何入选」：过线对照、分级标签、五轴（有则）、通稿注。
- 卡片：`ScoreLabel` 的 `title` 带「分数 · 门槛 · 分级」，不新增大块文案。
- 事件：「为什么热」下追加通稿合并句（若有）。
