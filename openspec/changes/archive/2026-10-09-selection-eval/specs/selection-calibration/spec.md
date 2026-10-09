# selection-calibration Specification（增量）

## Purpose
规定 GAMEHOT 精选门槛校准管线：金标 JSONL 格式、评分-only 评测判定、overall/按分级指标与门槛扫描的行为，以及不得自动写回门槛的约束。

## ADDED Requirements

### Requirement: 金标样本格式
系统 MUST 使用换行分隔的 JSONL 金标文件（默认 `.data/gold.jsonl`，不进版本库）。每条 MUST 含唯一 `caseId`、`material`（标题与至少一端正文优先）、`sourceFacts`（含决定门槛的 `sourceTier`）、`gold.decision`（`select` | `reject` | `either`）。可选 `samplingContext.benchmarkSplit` 与 `samplingStratum` 用于切分与错例分析。

#### Scenario: 读入金标
- **WHEN** 运行 `scripts/eval-selection.ts` 并指向合法 gold 文件
- **THEN** 脚本按行解析样本，跳过空行与 `//` 注释行，并按 `--split` / `--n` 抽样

#### Scenario: either 不计入 decisive
- **WHEN** 某条 `gold.decision` 为 `either`
- **THEN** 该条不计入准确率、查准率、查全率、F1 的分母与分子

### Requirement: 评分-only 评测判定
精选评测在仅执行预筛与两次评分、不执行写作步骤时，MUST 按分数与分级门槛判定是否预测入选，SHALL NOT 因缺少 writing 将预测固定为不入选。预筛为 BLOCK 或信源分级无门槛时，MUST 预测为不入选。

#### Scenario: 够分且预筛通过
- **WHEN** 预筛非 BLOCK，信源分级有门槛，两次评分有效且之和 ≥ 2 × 该分级门槛
- **THEN** 评测预测为 select，即使未运行 writing

#### Scenario: 预筛拦截
- **WHEN** 预筛标签为 BLOCK
- **THEN** 评测预测为 reject，且不要求评分结果

### Requirement: 指标含 overall 与按分级
每次评测报告 MUST 输出 overall 的 tp/fp/fn/tn、准确率、查准率、查全率、F1 与入选比例，并且 MUST 对样本中出现的每个信源分级（T1、T1_5、T2）输出同一套指标。

#### Scenario: 混合分级样本
- **WHEN** 开发集同时包含 T1 与 T2 样本
- **THEN** 报告中同时存在 overall 汇总与 T1、T2 分组指标

### Requirement: 门槛扫描可复现且不写回
评测 MUST 能在可配置区间（默认 40–90、步长 2）上扫描统一门槛 t，并输出各 t 下的准确率、查准率、查全率、F1。扫描结果 MAY 给出建议门槛数字，但 SHALL NOT 自动修改 `industry/selection.ts` 或其它生产门槛配置。

#### Scenario: 扫描输出建议
- **WHEN** 完成一次带 sweep 的评测
- **THEN** 报告含各 t 的指标表，且工作区中的 `industry/selection.ts` 内容与运行前一致

#### Scenario: 当前分级门槛主指标
- **WHEN** 计算主 summary 指标
- **THEN** 各样本使用其 `sourceTier` 对应的现行门槛，而不是单一全局 t

### Requirement: 校准记录
每次用于决策的评测运行 MUST 留下可追溯记录（标签、提示词版本、样本规模、切分、overall 与 by-tier 指标、sweep 摘要）。变更生产门槛之前 MUST 存在至少一条基于金标的评测记录，并经用户确认建议数字。

#### Scenario: 无记录不改门槛
- **WHEN** 尚无金标评测记录
- **THEN** 不得将凭感觉选定的新门槛作为已校准结果合并进主分支
