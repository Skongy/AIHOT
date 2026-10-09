# Proposal：通稿去重计入独立参与方（wire-copy-dedupe）

> 状态：实施中。多家转载同一通稿时，热度与多源证据只算 **1** 个独立参与方。不做 B 站热榜匹配；不改 `industry/selection.ts` 门槛数字。

## Why

热点与日报用「独立参与方 / 信源数」衡量覆盖面。通稿被多家媒体原样或微改转载时，按源计数会虚高，把同一篇通稿当成多方独立报道。需要在事件聚合层把通稿族合并为同一参与方。

## What Changes

- 文章增加 `wire_fingerprint`（标题+正文开头规范化后的指纹）
- `currentSignals`：在 owner/signal_group 之后、source 之前，优先用 `wire:<fingerprint>` 作为 `participant_key`
- 归组写入信号时，对同事件近重复报道对齐指纹
- 日报「几家信源」计数改用独立证据键（通稿合并）
- 单测覆盖相似度与热度计数；OpenSpec 新 capability

## Capabilities

### New Capabilities
- `event-wire-dedupe`：通稿近重复合并为同一热度/多源证据参与方

### Modified Capabilities
- （无主规格修改；热点门槛数字与热榜接入不在本变更）

## Impact

- 引擎：`content/wire.ts`（新）、`events/hot.ts`、`events/group.ts`、`content/materials.ts`、`content/extract.ts`、`reports/edition.ts`、`publication/coverage.ts`
- 迁移：`articles.wire_fingerprint` + 索引
- 测试：standalone wire 相似度；hot 通稿合并用例
- **不改** `industry/selection.ts`；**不做** B 站/贴吧热榜

## Out of Scope

- 热点门槛数字（T 源数 / 热榜条件）与 B 站匹配
- 自动改精选评分门槛
- 大规模回填历史 fingerprint（新写入与归组对齐覆盖增量；缺指纹时回退 `source:id`）

## 需要用户决定的问题

- 无（采用默认：相似度阈值 0.88；指纹取标题+正文前 400 字规范化哈希）
