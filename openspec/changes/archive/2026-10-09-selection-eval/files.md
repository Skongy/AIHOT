# Files：selection-eval（已落地）

## 脚本 / 文档

| 路径 | 改动 |
|---|---|
| `scripts/eval-selection.ts` | 分数+分级判定；byTier；uniform-t sweep；只读 suggested |
| `scripts/gold-enrich-bodies.ts` | 新：按 URL/草稿补正文 |
| `docs/selection.md` | 校准、灵感标注口径、评测判定与禁忌 |
| `industry/gold.example.jsonl` | 游戏向两条示例 |
| `tests/selection-eval.standalone.test.ts` | 新：score-only 判定单测 |

## 引擎补丁

| 路径 | 改动 |
|---|---|
| `packages/backend/src/editorial/analyze.ts` | 新增 `selectedByScoreThreshold` / `selectedAtMeanCutoff`；**生产 writing 门闩未改** |
| `packages/backend/src/admin/selectbench.ts` | list 剥掉 sweep/suggested；详情保留完整 summary |
| `packages/contracts/src/admin.ts` | `AdminSelectBenchModelSummary` |
| `apps/web/app/routes/admin/selectbench-run.tsx` | by-tier + 门槛扫描表 |
| `apps/web/app/routes/admin/selectbench.tsx` | 类型对齐 |

## 明确未改

| 路径 | 原因 |
|---|---|
| `industry/selection.ts` | 门槛数字留给用户拍板 |
| `industry/prompts/*` | 口径已在 apply-selection-criteria |
| `.data/*`、`.env` | 不进 Git |
