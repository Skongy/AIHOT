## ADDED Requirements

### Requirement: Hot-list sources as heat evidence only

系统 SHALL 通过现有 `json_list` 采集器接入 B 站热搜与贴吧热议公开 JSON，并以 `participation_mode: hot_signal` 入库。热榜条目 MUST 只作为已有事件的热度证据；SHALL NOT 因热词新建故事或热点。系统 SHALL NOT 接入微博热搜。

#### Scenario: Unmatched hot word stays evidence-free
- **WHEN** 一条热榜标题无法高置信匹配到近窗已有事件（含四款 Steam 种子别名共现）
- **THEN** 归组结果为 `signal-unmatched`，且不创建新的 fact/story

### Requirement: Lexical fallback without embedding key

在无 Embedding/百炼向量密钥时，热信号归组 SHALL 复用既有字面 bigram 相似度与种子词共现，SHALL NOT 因此引入新的向量服务或匹配架构。匹配策略 MUST 宁漏勿误报：仅在高置信或种子共现明确时挂接。

#### Scenario: No embedding key still can attach a seed hot word
- **WHEN** 未配置 embedding 密钥，且热词与某已有事件标题命中同一 Steam 种子模式
- **THEN** 该热词可挂到该事件并计入热度信号
