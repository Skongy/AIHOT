# Design：selection-eval（精选门槛校准管线）

## Context

- 线上入选：`normalizeAnalysis` 要求 `relevance === "pass"`（需 writing 写出标题摘要）且两次评分之和 ≥ 2 × 分级门槛（`industry/selection.ts`）。
- 评测脚本 `scripts/eval-selection.ts` 只跑预筛 + 两次评分（设计如此，见 `docs/selection.md`），不跑 writing/structure。
- 缺陷（已实测，见 `/workspace/aihot-plan/calibration-2026-10-08.md`）：无 writing → `relevance=unknown` → `selected` 恒 false → 主指标与 sweep 的 P/R 全 0，**不能用于校准**。
- 已有资产：`industry/gold.example.jsonl`、`.data/gold-calibration-v0.jsonl`（30 条，正文=标题）、`/workspace/aihot-plan/calibration-sample.json`（含 URL 与 draftLabel）、SelectBench 后台（汇总 P/R/F1，**不展示 sweep**；list API 主动剥掉 `sweep`）。
- 产品焦点：Steam 四主题；用户自行稍后改门槛；DeepSeek key 已在 `.env`。

## Goals / Non-Goals

**Goals**
1. 评测判定与「分数是否够门槛」对齐，不依赖 writing。
2. 金标可带正文；有可操作的标注与补正文流程。
3. 报告含 overall + by-tier；门槛扫描可读（CLI + 建议的 SelectBench 展示）。
4. 明确：**扫描 ≠ 写回门槛**。

**Non-Goals**：改提示词口径、改生产门槛数字、归组评测、自动 PR。

## Decisions

### D1. 评测入选判定（修脚手架）

评测路径定义：

```
pred_select =
  prefilter.label !== "BLOCK"
  && tierThreshold(tier) !== null
  && scores 有效（未 refused，两次分齐全）
  && sum(scores) >= 2 * tierThreshold(tier)
```

- BLOCK 或无门槛分级 → 预测 reject（与线上「不进精选」一致）。
- **不把 writing 缺失当成 unknown 而否决入选**——那是生产流水线「还没写完文案」的状态，不是评测语义。
- 实现偏好：在 `eval-selection.ts` 内计算 `evalSelected`，必要时从 `analyze.ts` 抽出纯函数 `selectionDecisionFromScores(...)` 供生产与评测共用「分数门槛」部分；**不**改生产对 `relevance===pass` 的写作门闩（避免影响线上「未写完不公开」）。

门槛扫描：对每条用同一 `attention` 分（两次平均向下取整，与卡片分一致），在扫描模式下：

| 模式 | 含义 |
|---|---|
| `current` | 各样本用自己的 `tierThreshold`（主指标） |
| `uniform-t` | 全体用同一 t（诊断「整体松紧」；现有 CLI 行为） |
| `tier-offset`（可选增强） | 各分级门槛同时 +Δ，Δ 从 -20..+20 |

主报告以 `current` 为准；`uniform-t` 表继续打印，便于用户挑数字后再映射到 T1/T1_5/T2。

### D2. 金标格式

保持 `GoldRow`（与 `docs/selection.md` / `eval-selection.ts` 一致）：

| 字段 | 要求 |
|---|---|
| `caseId` | 唯一 |
| `material.title` / `publishedAt` / `sourceName` | 必填 |
| `material.bodyZh` 或 `bodyOriginal` | **校准用应尽量有一端**；仅标题不可作为正式校准依据 |
| `sourceFacts.sourceKind` / `sourceTier` / `firstParty` / `language` | 分级决定门槛 |
| `samplingContext.benchmarkSplit` | `development` \| `holdout` |
| `samplingContext.samplingStratum` | 如 `isaac` / `sts2` / `mewgenics` / `bg3` / `industry` / `guide` / `rumor` / `noise`… |
| `gold.decision` | `select` \| `reject` \| `either` |

可选扩展（评测忽略未知字段即可）：`material.sourceUrl`（补正文用）、`gold.note`（标注理由）。`.data/` 不进 Git。

### D3. 标注工作流

1. **确认草稿**：白凌审 `/workspace/aihot-plan/calibration-sample.json` 30 条 `draftLabel` → 写入 `.data/gold.jsonl`。
2. **扩样**：开发库按源 + stratum 分层抽样至 100–200；难例优先（贴门槛、排除类、四主题相关）。
3. **切分**：约 7:3 development / holdout；调提示词/看扫描只看开发集，拍板前跑留出集。
4. **either**：两可不计入 decisive 指标。
5. **标注原则**：只看本条该不该进精选，不因「已有同题报道」标 reject（归组另测）。

### D4. 正文怎么来

优先级：

1. 若文章已在库：`articles.body_text` / `excerpt`（`body_status=ok` 优先）。
2. RSS/API 自带 content 字段（采集时已有则直接用）。
3. 对 `calibration-sample.json` 的 `url`：调用现有 `packages/backend/src/content/extract` 路径或轻量脚本拉取（尊重 `site_fulltext` / robots；评测金标可存全文副本在 `.data/`，不公开站点展示）。
4. 可选 Jina 兜底（Q4）。
5. 仍无正文：保留标题+摘要；正式校准集中 **标记并尽量替换**；不得用「标题当正文」的 30 条 v0 作为拍板依据。

产出脚本建议：`scripts/gold-enrich-bodies.ts --from calibration-sample.json --out .data/gold.jsonl`（本变更实现；失败行打日志）。

### D5. 指标与报告

每次运行 stdout + `.data/eval/selection-<split>-<n>-<ts>.json`：

- **summary**：tp/fp/fn/tn、accuracy、precision、recall、f1、selectedRate、goldSelectRate、errors、either、usage
- **byTier**：对 T1 / T1_5 / T2（样本中出现的）各一份同上指标
- **sweep**：`uniform-t` 列表；标注 F1 最大点与「最接近验收线」点（只建议）
- **mistakes / cases**：含 tier、stratum、score

SelectBench：导入时保留 `sweep` 与 `byTier`；运行页增加「门槛扫描」表与「按分级」卡片。list 接口可继续压缩，详情必须完整。

### D6. 绝不自动写门槛

- 脚本 **不得** 修改 `industry/selection.ts`。
- 报告可打印建议块，例如：`suggested: { T1: 58, T1_5: 62, T2: 70, rationale: "dev F1 max under P>=0.8" }`，仅供人读。
- 用户确认后：手改或另开 `change/apply-selection-thresholds` 一类变更；本变更 tasks 不含写回。

### D7. 与 content-scope 的关系

规格增量强调：门槛变更 MUST 基于本管线评测记录；SHALL NOT 在无评测记录时凭感觉改数字。管线本身是新 capability `selection-calibration`。

## Risks / Trade-offs

| 风险 | 缓解 |
|---|---|
| 评测判定与线上「无 writing 不 selected」表面不一致 | 文档写清：评测度量的是「分数门槛」，写作门闩是发布流水线状态 |
| 金标缺正文 → 分数偏低（v0 均值 ~28） | 强制补正文后再扫门槛 |
| 样本全 T2（v0） | 扩样纳入 Steam 官源 T1 与 T1_5 |
| SelectBench UI 改动属引擎前端 | 做小、files.md 单列；无 UI 时 CLI 仍可用（Q2-A） |
| 模型费用 | 回执复用；`--n` 限制；开发集迭代、留出集少跑 |

## 简历要点（Resume bullet wording）

中英各一版，供白凌选用（事实对齐本变更交付物）：

- **中文**：搭建游戏资讯站精选阈值的金标评测与门槛校准管线：JSONL 金标与标注流程、正文补取、修复「无写作步骤导致入选恒为假」的评测缺陷，输出 overall/按信源分级的 P/R/F1 报告与门槛扫描（CLI + SelectBench），门槛数字保留人工确认、禁止自动写回。
- **English**：Built a gold-set evaluation and threshold-calibration pipeline for a Steam game news selection system—JSONL labeling workflow, article-body enrichment, fixed eval false-negatives from score-only runs, and P/R/F1 reporting (overall + by source tier) with threshold sweeps (CLI/SelectBench); thresholds remain human-approved (no auto-writeback).

## 工作量估计

| 块 | 估时 | 说明 |
|---|---|---|
| 修评测判定 + by-tier + sweep 报告字段 | 0.5–1 天 | 脚本为主，可抽纯函数 |
| SelectBench 展示 sweep / by-tier | 0.5 天 | Q2-B；选 A 则省掉 |
| 补正文脚本 + 文档 | 0.5 天 | |
| 标注协助（工具侧） | 0.5 天 | 抽样 SQL/转换；**标注本身 2–3 小时在用户** |
| 跑通开发集/留出集 + 写校准记录 | 0.5 天 | 含 DeepSeek 费用 |
| **合计工程** | **约 2–3.5 天** | 不含用户标注与拍板门槛的等待 |

## 待决定

见 proposal Q1–Q5。默认建议：Q1 100–200 且先确认 30 条；Q2-B；Q3 建议验收线；Q4 有 Jina 则用、无则 DB/RSS；Q5 排除类型 + 四主题尽量覆盖。
