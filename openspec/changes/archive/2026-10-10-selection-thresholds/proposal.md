# Proposal：下调 T1/T1_5 门槛并扩 T1 金标

> 状态：实施中。T2 已为 40；将 T1/T1_5 设为更低的官方门槛，并补充 Steam/官源 T1 金标样本。

## Why

T2 已按评测建议降到 40，但 T1=60、T1_5=65 仍高于 T2，与「官方一手门槛更低」的设计相反。金标目前几乎全是 T2，需要补 T1 样本以便后续校准。

## What Changes

- `industry/selection.ts`：`T1`/`T1_5` 降到 T2=40 以下；`understandFloor` 同步低于 T1。
- `.data/gold.jsonl`（不进 Git）补充可抓取的 Steam/官源 T1 样本；`gold.example.jsonl` 可增示例。
- 更新 `docs/selection.md` 中的门槛示例数字。

## Out of Scope

- 自动让评测脚本写回门槛；改评分提示词口径；热榜接入（见 hot-list-matching）。
