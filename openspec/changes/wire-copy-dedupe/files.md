# Files：wire-copy-dedupe

## 新增
- `packages/backend/src/content/wire.ts`
- `database/migrations/0058_article_wire_fingerprint.sql`
- `database/migrations/0059_article_wire_fingerprint_idx.sql`
- `tests/wire-copy.standalone.test.ts`
- `openspec/changes/wire-copy-dedupe/**`

## 引擎补丁
- `packages/backend/src/events/hot.ts` — currentSignals + rule version
- `packages/backend/src/events/group.ts` — align fingerprints on recordSignal
- `packages/backend/src/content/materials.ts` — set fingerprint on write
- `packages/backend/src/content/extract.ts` — set fingerprint when body arrives
- `packages/backend/src/reports/edition.ts` — independent source counts
- `packages/backend/src/publication/coverage.ts` — factSources keys
- `tests/hot.test.ts` — wire-copy participant collapse

## 不改
- `industry/selection.ts`
- 热榜 / B 站匹配
