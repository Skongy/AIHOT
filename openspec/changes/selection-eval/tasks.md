# Tasks：selection-eval

> 状态：实施中（用户已批准，采用 design 默认：Q2-B、验收线建议值、不自动写门槛）。

## 1. 前置与基线

- [x] 1.1 用户已答复 proposal Q1–Q5（或明确采用 design 默认建议）
- [x] 1.2 `.env` 具备可用 DeepSeek（`LLM_*`）；评测时临时 `MODEL_CALLS_ENABLED=true`，评完恢复（文档已说明）
- [x] 1.3 基线：`npm run typecheck`；相关已有测试可通过
- [x] 1.4 缺陷已由 `selectedByScoreThreshold` 单测覆盖（修前逻辑：无 writing → selected 恒 false）

## 2. 评测判定与指标（脚本 / 小补丁）

- [x] 2.1 实现评测入选判定（不依赖 writing），与 design D1 一致；主指标与 sweep 共用
- [x] 2.2 summary 增加 `byTier`（T1 / T1_5 / T2）；cases/mistakes 带 `sourceTier`
- [x] 2.3 sweep 输出保留 `uniform-t`；打印建议块但 **不写** `industry/selection.ts`
- [x] 2.4 单测：无 writing 的够分样本 → pred select；BLOCK → reject
- [ ] 2.5 用 v0 gold 重跑（需 LLM；交付后由用户/本机执行，非合并阻塞）

## 3. 金标、正文与文档

- [ ] 3.1 白凌确认 `calibration-sample.json` 30 条标注 → `.data/gold.jsonl`（用户侧）
- [x] 3.2 实现正文补取脚本 `scripts/gold-enrich-bodies.ts`；文档化
- [ ] 3.3 分层扩样至约定规模（用户侧）
- [x] 3.4 更新 `docs/selection.md`：评测判定、by-tier、sweep、禁忌、灵感标注口径
- [x] 3.5 更新 `industry/gold.example.jsonl` 为游戏向示例；`selectionGold` 保持 null（默认 `.data/gold.jsonl`）

## 4. SelectBench 展示（Q2-B）

- [x] 4.1 导入保留 `sweep` / `byTier` / `suggested`；list 剥掉 sweep/suggested
- [x] 4.2 `selectbench-run.tsx` 展示按分级指标 + 门槛扫描表
- [x] 4.3 合约类型补 `AdminSelectBenchModelSummary`

## 5. 校准试跑（不出门槛 PR）

- [ ] 5.1–5.4 待用户金标与 LLM 试跑；**本变更不改 `selection.ts`**

## 6. 验证与交付

- [x] 6.1 typecheck；standalone 单测；openspec validate
- [x] 6.2 files.md 已列引擎补丁与脚本
- [x] 6.3 确认未改门槛文件
