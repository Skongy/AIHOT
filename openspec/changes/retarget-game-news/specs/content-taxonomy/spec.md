# content-taxonomy

## Purpose

规定游戏资讯的分类体系：网页筛选和日报分节用的类别、模型打标签用的封闭词表、内容类型、日报报头的头条发布计数，以及主题目录的分组和种子主题。整套体系 MUST 自洽，并与提示词一致。

## ADDED Requirements

### Requirement: 游戏资讯类别
站点 MUST 正好提供三个游戏类别：新游（`new-games`）、电竞（`esports`）、行业（`industry`）。key 为 `industry` 的类别 MUST 存在，用来收容没归上类的资料，也收已上线游戏的版本更新、新赛季、DLC、国服停服或回归，以及厂商、发行、版号、评测和观点类内容。站点 SHALL NOT 另设版本、攻略、评测或观点类别。类别 key 上线后 SHALL NOT 再改。

#### Scenario: 筛选栏
- **WHEN** 读者打开资讯页或全部动态的筛选
- **THEN** 类别选项正好是 新游、电竞、行业，没有 模型、产品、论文 这类 AI 类别，也没有 版本、攻略

#### Scenario: 版本更新归行业
- **WHEN** 结构化步骤处理一篇已上线游戏的新赛季或 DLC 公告
- **THEN** 类别是行业，首标签可以是“赛季/活动”或“DLC/资料片”

#### Scenario: 分类订阅地址
- **WHEN** 订阅者请求 /feed/category/ai-models.xml
- **THEN** 站点返回 404；/feed/category/<游戏类别 key>.xml 可以正常订阅

### Requirement: 封闭的游戏标签词表
资料的第一个标签 MUST 是游戏分类标签之一。其余标签 MUST 只来自游戏主题标签（平台、品类）和实体标签（厂商、平台）白名单。模型常写的近义词 SHALL 统一成词表里的写法。

#### Scenario: 近义词归一
- **WHEN** 结构化步骤给一篇资料打出“公测”标签
- **THEN** 存下来的标签是“定档/上线”

#### Scenario: 拒绝词表外标签
- **WHEN** 模型返回词表里没有的标签（例如“模型发布”）
- **THEN** 这个标签不被保存

### Requirement: 内容类型与提示词一致
内容理解步骤用的内容类型集合 MUST 与评分和内容理解提示词里的类型表完全一致，并且是游戏资讯的类型：首曝、上线、版本更新、电竞、行业事件、评测与数据、观点讨论（`game_reveal`、`game_launch`、`version_update`、`esports_event`、`industry_event`、`review_or_data`、`opinion_discussion`）。

#### Scenario: 类型校验
- **WHEN** 模型对一篇版本公告返回 itemType `version_update`
- **THEN** 校验通过；如果返回的是 `model_release`，校验失败并按现有失败流程处理

### Requirement: 日报头条发布计数
日报报头的头条发布计数 SHALL 按游戏口径统计为“N 款新游”（新游类别里带“定档/上线”标签、首次报道的一手条目）。SHALL NOT 显示“个新模型”。

#### Scenario: 日报报头
- **WHEN** 读者打开某一期日报，当期有 3 条首次报道的新游上线
- **THEN** 报头显示“3 款新游”，不出现“新模型”

### Requirement: 游戏主题目录
主题目录 MUST 分为“游戏”“平台与品类”“内容形态”三组，SHALL NOT 包含任何 AI 主题。每个游戏主题 MUST 对应一个游戏实体，收录以这款游戏为主体的精选报道。一篇报道有多个主体时，只有标题点了这款游戏的名字才收录。

#### Scenario: 单一主体
- **WHEN** 一篇精选报道的唯一主体是“原神”
- **THEN** 它出现在原神的主题页

#### Scenario: 多主体未点名
- **WHEN** 一篇报道的主体是 原神 和 崩坏：星穹铁道，标题只写了“崩坏：星穹铁道”
- **THEN** 它只出现在 崩坏：星穹铁道 的主题页，不出现在原神的主题页

#### Scenario: 无 AI 主题
- **WHEN** 读者访问 /topics/openai
- **THEN** 站点返回 404
