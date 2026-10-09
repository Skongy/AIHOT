# Design：wire-copy-dedupe

## Context

热度（`events/hot.ts` `currentSignals`）按 `participant_key` 去重：社区账号 / signal_group / owner / 否则 `source:id`。通稿转载落在不同 `source:id`，会被算成多个独立参与方。

## Decisions

### D1. 存 fingerprint，热度动态读

`articles.wire_fingerprint`：对规范化标题+正文前缀做 sha256 截断。`currentSignals` 在 owner/group 之后使用 `wire:` + fingerprint。热度仍「现读现算」，改 fingerprint 立即生效。

### D2. 近重复对齐

仅精确规范化哈希会漏微改标题。归组 `recordSignal` 后：同 story 上与本文 `wireSimilarity >= 0.88` 的报道共用同一 fingerprint（写回各自行）。

### D3. 日报信源数

`factSources` / edition 的「几家」改为独立证据键（`wire:…` 或 `source:…`），与热度一致。`PER_SOURCE` 仍看代表稿的真实 `sourceId`。

### D4. 不改门槛 / 不做热榜

`HOT_RULE_VERSION` 升为 `heat-v2-wire-dedupe` 以区分榜单语义；不引入 `SELECTION.HOT`，不做 B 站匹配。

## Risks

- 官宣与媒体高度复述偶发合并 → 阈值偏高（0.88）+ 需足够正文/标题长度
- 历史无指纹文章仍按源计数 → 可接受；新稿与归组对齐逐步覆盖
