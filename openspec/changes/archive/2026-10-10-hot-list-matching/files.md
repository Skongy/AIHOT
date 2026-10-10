## 行业包

- `industry/sources.json` — 两条热榜
- `industry/selection.ts` — `HOT_SEED_ENTITY_IDS`（匹配用）

## 引擎补丁

- `packages/backend/src/events/group.ts` — 热信号字面/种子匹配

## 规格 / 测试 / 文档

- `openspec/specs/hot-list-matching/spec.md`（本变更增量归档后）
- `openspec/specs/selection-explain/spec.md`、`source-collection/spec.md` — 去掉「禁止热榜」表述
- `tests/fixtures/game-sources/json-bilibili-hotword.json`、`json-tieba-hottopic.json`
- `tests/game-sources.standalone.test.ts`、相关信号测试
