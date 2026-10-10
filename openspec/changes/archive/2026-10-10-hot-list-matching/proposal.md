# Proposal：B 站 / 贴吧热榜匹配（hot-list-matching）

> 状态：实施中。接 B 站热搜与贴吧热议为 `json_list` + `hot_signal`；无向量密钥时用既有字面匹配；热词只给已有事件加分，不新建热点。不做微博。

## Why

变更 connect-game-sources 把热榜留给本变更。国内玩家热度信号主要来自 B 站热搜与贴吧热议；现有引擎已有 `json_list` 采集与 `hot_signal` 归组路径，缺的是信源配置，以及在无百炼/Embedding 密钥时 `groupSignal` 直接 `signal-unmatched` 的缺口。

## What Changes

- `industry/sources.json` 增加两条启用的热榜信源：B 站热搜、贴吧热议（`participation_mode: hot_signal`）。
- 引擎小补丁：`groupSignal` / `rematchSignals` 在无 embedding 时走既有 `lexicalSimilarity`；热词与四款 Steam 种子（及 `IDENTITY_LEXICON` 模式）共现时可挂到已有事件；**宁漏勿误报**，无高置信匹配则 `signal-unmatched`，**不新建**故事。
- 更新曾写「MUST NOT 接入 B 站/贴吧」的规格说明。
- 解析夹具与 `game-sources` / 信号相关测试。

## Out of Scope

- 微博热搜；新采集器类型；用热榜直接抬精选门槛或改日报栏目结构（社区热议日报位另议）。
- 发明新的向量/匹配子系统；自动写回精选门槛数字（见并行变更 selection-thresholds）。

## 需要用户决定的问题

- 无（信源官已实测入口；灵感规则已明确）。
