# content-scope Specification（增量）

## MODIFIED Requirements

### Requirement: 门槛按标注样本校准
信源分级的入选门槛 MUST 用用户标注的游戏样本（开发集与留出集）经 `selection-calibration` 管线评测后确定，SHALL NOT 凭感觉修改。每次修改门槛或评分提示词 MUST 留下评测记录（标签、查准率、查全率、按分级指标与门槛扫描摘要）。评测脚手架 MUST 在无写作步骤时仍能按分数门槛给出可解释的入选预测。生产门槛文件的写回 MUST 由用户显式确认，SHALL NOT 由评测脚本自动完成。

#### Scenario: 改门槛
- **WHEN** 有人提议把 T2 门槛从 76 改到 70
- **THEN** 变更里附有在同一标注样本上 76 与 70 的评测对比，并经用户确认

#### Scenario: 校准后改门槛
- **WHEN** 开发集与留出集评测已完成且用户确认建议的 T1/T1_5/T2 数字
- **THEN** 可以更新 `industry/selection.ts`，并在变更说明中引用对应评测标签

#### Scenario: 禁止自动写回
- **WHEN** 评测脚本完成门槛扫描
- **THEN** 脚本不修改 `industry/selection.ts`
