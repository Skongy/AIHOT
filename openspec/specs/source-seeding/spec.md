# source-seeding Specification

## Purpose
规定首次启动时导入的示范信源：不再带上游的 AI 行业信源。正式的游戏信源名单由后续变更按信源官的输入导入。

## Requirements

### Requirement: 示范信源不含 AI 行业信源
种子信源文件 SHALL NOT 包含 AI 行业信源，例如 OpenAI News、Google DeepMind、Hugging Face Blog、TechCrunch · AI。本变更交付时文件为空；以后只能为空，或者只含明确标注为占位的游戏信源。

#### Scenario: 新库首次启动
- **WHEN** 在空数据库上运行种子导入
- **THEN** 信源表里没有任何 AI 行业信源

#### Scenario: 占位信源标注
- **WHEN** 种子文件里有占位游戏信源
- **THEN** 每个占位信源都注明“待信源官替换”，并默认 site_fulltext 与 syndicate_fulltext 为 false
