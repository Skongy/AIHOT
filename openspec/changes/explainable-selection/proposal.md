# Proposal：可解释的精选 / 热点（explainable-selection）

> 状态：实施中。在卡片与详情向读者说明「为何入选 / 为何算热」，不做成后台仪表盘。不改 `industry/selection.ts` 门槛数字；不做 B 站热榜。

## Why

精选只亮分数与推荐理由，读者看不出分数相对哪道门槛、信源分级如何、五轴从哪来；热点「为什么热」也不说明通稿合并。需要把**已有**评分轴与门槛对照、源分级、通稿去重提示，以最少 UI 暴露给读者。

## What Changes

- 评分 JSON 在保留 `attentionScore` 计算不变的前提下，**可选**输出 `contentType` 与五轴 `axes`，写入 `analyses.output`
- 站点详情（及卡片紧凑提示）暴露只读 `selectionExplain`：分数、门槛、是否过线、源分级、可选轴与内容类型、通稿合并说明（若适用）
- 事件页 `whyHot` 在发生通稿合并时附一句说明；`sourceCount` 与独立证据键一致
- OpenSpec 新 capability；单测覆盖 schema / explain 组装；中文 PR

## Capabilities

### New Capabilities
- `selection-explain`：面向读者的精选 / 热点可解释字段与最小展示

### Modified Capabilities
- （无主规格改写门槛或热榜接入）

## Impact

- 提示词：`industry/prompts/selection-score.md`（输出契约放宽；计分公式不变）
- 引擎：`editorial/analyze.ts`、`publication/selection-explain.ts`（新）、`publication/detail.ts`、`publication/items.ts`、`publication/stories.ts`
- 合约 / Web：`contracts/site.ts`、详情轨「为何入选」、Score 悬停提示、事件「为什么热」
- **不改** `industry/selection.ts`；**不做** B 站/贴吧热榜

## Out of Scope

- 改门槛数字或 SelectBench 自动写回
- 管理后台式轴雷达 / 全量诊断面板
- 回填历史 analyses 的轴（旧稿无轴时只展示分数·门槛·分级）

## 需要用户决定的问题

- 无（默认：详情为主、卡片悬停/短提示；轴缺失时降级）
