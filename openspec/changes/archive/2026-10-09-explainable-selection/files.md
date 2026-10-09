# Files：explainable-selection

## OpenSpec
- `openspec/changes/explainable-selection/*`

## Prompt / scoring
- `industry/prompts/selection-score.md` — 允许可选输出 contentType + axes
- `packages/backend/src/editorial/analyze.ts` — ScoreSchema、均轴、写入 output

## Publication / API
- `packages/backend/src/publication/selection-explain.ts` — 组装 SelectionExplain（新）
- `packages/backend/src/publication/detail.ts` — 详情挂 selectionExplain
- `packages/backend/src/publication/items.ts` — 列表挂 selectionHint（tier/threshold）
- `packages/backend/src/publication/stories.ts` — whyHot.wireDedupeNote；sourceCount 独立键
- `packages/contracts/src/site.ts` — SelectionExplain / selectionHint / whyHot 字段

## Web
- `apps/web/app/components/ui/Score.tsx` — title 带门槛分级
- `apps/web/app/components/ui/SelectionExplain.tsx` — 详情块（新）
- `apps/web/app/routes/item.tsx` — 挂载详情块
- `apps/web/app/features/feed/FeedItem.tsx` — Score 传入 hint
- `apps/web/app/routes/story.tsx` — 通稿说明

## Docs / tests
- `docs/selection.md` — 简述读者可见解释
- `tests/selection-explain.standalone.test.ts`
