# event-wire-dedupe Specification（增量）

## Purpose
规定 GAMEHOT 事件热度与多源证据计数时，通稿近重复报道合并为同一独立参与方，避免多家转载把覆盖面虚高。

## ADDED Requirements

### Requirement: 通稿指纹
系统 MUST 能根据报道标题与正文开头生成稳定的通稿指纹（规范化后哈希）。正文与标题过短时 MUST NOT 声称通稿身份（指纹为空，回退按信源计数）。

#### Scenario: 相同通稿文本
- **WHEN** 两篇报道规范化后的标题与正文前缀相同且足够长
- **THEN** 它们得到相同的 `wire_fingerprint`

#### Scenario: 材料过短
- **WHEN** 规范化后的文本过短
- **THEN** 不生成指纹，参与方键回退为信源

### Requirement: 热度按通稿合并参与方
热度证据（`currentSignals`）在信号组与 owner 规则之后，MUST 对带通稿指纹的报道使用 `wire:<fingerprint>` 作为 `participant_key`，使同指纹的多家转载在同一事件窗口内只计一个独立参与方。

#### Scenario: 三家转载同一通稿
- **WHEN** 三个无共同 owner/signal_group 的编辑型信源对同一事件发布指纹相同的通稿
- **THEN** 该事件在 48 小时热度窗口内的独立参与方数计为 1（就这三篇通稿而言）

#### Scenario: 不同内容仍分开
- **WHEN** 两家信源报道同一事件但正文与标题差异大使相似度低于通稿阈值
- **THEN** 它们保持各自的参与方键，计为两个独立参与方

### Requirement: 多源证据计数一致
日报等「几家信源报道」类计数 MUST 使用与热度一致的独立证据键（通稿合并），SHALL NOT 把通稿转载算作多家独立报道。

#### Scenario: 日报信源数
- **WHEN** 某事件仅有两家媒体转载同一通稿、无其他独立报道
- **THEN** 该事件展示的信源数 / 独立覆盖为 1
