# source-seeding Specification

## Purpose
规定首次启动时导入的示范信源：不再带上游的 AI 行业信源。正式的游戏信源名单由后续变更按信源官的输入导入。

## Requirements

### Requirement: 示范信源不含 AI 行业信源
种子信源文件 SHALL NOT 包含 AI 行业信源。文件 MUST 包含信源官 v1 媒体名单和官方信源 v1 中本次接入的官方信源（RSS、HTML 列表页、JSON 接口），每个信源默认 `site_fulltext` 与 `syndicate_fulltext` 为 false。文件 SHALL NOT 再为空。

#### Scenario: 新库首次启动
- **WHEN** 在空数据库上运行种子导入
- **THEN** 信源表里有游戏媒体和官方信源，没有任何 AI 行业信源（例如 OpenAI News、Hugging Face Blog）

#### Scenario: 占位信源标注
- **WHEN** 种子文件里有尚未经信源官实测确认的占位信源
- **THEN** 该信源注明“待信源官替换”，并且默认 `enabled` 为 false

#### Scenario: 默认不展示全文
- **WHEN** 种子导入完成
- **THEN** 每个导入的信源 `site_fulltext` 与 `syndicate_fulltext` 均为 false
