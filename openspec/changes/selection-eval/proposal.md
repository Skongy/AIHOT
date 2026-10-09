# Proposal：精选门槛校准管线（selection-eval）

> 状态：**实施中**（2026-10-09 用户批准）。交付评测管线；**不改** `industry/selection.ts` 门槛数字。

## Why

变更 `apply-selection-criteria` 已把 Steam 四主题（以撒重生 / STS2 / 喵喵的结合 / BG3）的精选口径写进提示词，但门槛仍是上游 AI 领域的 T1 60 / T1_5 65 / T2 76，**从未在游戏样本上可信校准过**。2026-10-08 的小样本试跑（30 条标题）暴露评测脚手架缺陷：`eval-selection` 只跑预筛+评分时，`normalizeAnalysis` 因无 writing 把 `relevance` 置为 `unknown`，导致 `selected` 恒为 false、门槛扫描 P/R 全 0——无法据此调门槛。简历/交付物需要的是可复用的金标 → 评测 → P/R 报告 → 门槛扫描管线，而不是替用户写死新门槛。

## What Changes

- **修评测判定**：`scripts/eval-selection.ts`（及必要的小型引擎辅助）在「仅预筛+评分」路径上按线上等价规则判定入选（预筛非 BLOCK、有有效双次分、达到分级门槛），**不依赖 writing**；门槛扫描与主指标共用同一判定。
- **指标增强**：报告输出 overall 与 **按信源分级（T1 / T1_5 / T2）** 的准确率、查准率、查全率、F1、入选比例；错例带分层与分数。
- **门槛扫描**：CLI 保留/加强 40–90（可配）扫描；同时给出「当前分级门槛」下的指标与「若全体统一用 t」诊断表；扫描结果写入 `.data/eval/*.json`，并在 SelectBench 运行页展示（现网 list/API 会剥掉 sweep，需补回展示）。
- **金标与正文**：约定 `.data/gold.jsonl` 格式（与现有一致）；提供从开发库 / URL **补正文** 的脚本或文档化流程（优先 DB `body_text` / RSS content，其次现有 extract，再 Jina 兜底）；标注工作流（确认 30 条草稿 → 扩到 100–200 → 7:3 开发/留出）。
- **站点默认评测配置**：可选在 `site/site.ts` 的 `DEPLOYMENT.selectionGold` 指向本地 gold 路径与 sweep 区间（仅本机，不把 `.data/` 进 Git）。
- **文档**：更新 `docs/selection.md` 校准章节，写明「扫描只出建议、门槛由人改 `industry/selection.ts`」。

**是否需要改引擎**：**小幅需要**——评测判定与 SelectBench 展示 sweep / by-tier；生产入选路径与 `industry/selection.ts` 数字**本变更不改**（除非用户另批「应用某组门槛」变更）。

## Capabilities

### New Capabilities
- `selection-calibration`：金标格式、评测判定、指标（含按分级）、门槛扫描展示与「不自动写门槛」约束。

### Modified Capabilities
- `content-scope`：将「门槛按标注样本校准」要求与本管线对齐（评测必须可复现、门槛变更须留记录且经用户确认）。

## Impact

- **脚本**：`scripts/eval-selection.ts`；可能新增 `scripts/gold-enrich-bodies.ts`（或同类）
- **引擎（小补丁，files.md 单列）**：`packages/backend/src/editorial/analyze.ts`（评测用判定辅助，或 eval 内联等价逻辑避免动生产语义）；`packages/backend/src/admin/selectbench.ts`；`apps/web/app/routes/admin/selectbench-run.tsx`（展示 sweep / by-tier）
- **合约（若 API 露出新字段）**：`packages/contracts/src/admin.ts`
- **配置/文档**：`site/site.ts`（`selectionGold` 可选）、`docs/selection.md`、`industry/gold.example.jsonl`（示例可补游戏向）
- **数据（不进 Git）**：`.data/gold.jsonl`、`.data/eval/`
- **成本**：DeepSeek 评测约 100–200 条 × 预筛+两次评分；有回执复用时重跑免费。粗估单轮 1–5 元量级
- **数据库**：无新迁移（沿用 selectbench_*）

## Out of Scope

- **不**自动改写或提交 `industry/selection.ts` 门槛数字（扫描只产出建议表；用户确认后另开变更或手改）
- **不**改 `selection-score.md` / `prefilter.md` 精选口径（已在 apply-selection-criteria）
- **不**跑归组去重评测；金标按「本条本身该不该选」标注
- **不**做日报/热点/主题页改动
- **不**把 `.data/gold.jsonl` 或密钥提交进仓库
- **不**开 PR（本计划分支仅推送草案）

## 需要用户决定的问题

- Q1：金标规模目标？建议开发集约 70–140、留出集约 30–60（合计 100–200）；30 条草稿是否全部由白凌确认后再扩样？
- Q2：门槛扫描 UI 做到哪一步？A) 仅 CLI + JSON 报告（最小）；B) SelectBench 运行页加 sweep 表 + by-tier（建议）；C) 再加「一键写回 selection.ts」——**本变更明确不做 C**。
- Q3：验收线？建议开发集 P≥0.80、R≥0.70；留出集不低于开发集 0.05；排除类 stratum 0 条入选（可改）。
- Q4：正文补取是否允许用 `JINA_API_KEY` 兜底？无 key 时是否接受「仅 DB/RSS 正文、缺正文样本标 either 或暂缓」？
- Q5：扩样是否必须覆盖四款 Steam 主题分层，还是按现有媒体源 + 排除类型分层即可？
