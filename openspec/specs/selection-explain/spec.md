# selection-explain Specification

## Purpose
规定 GAMEHOT 面向读者的精选与热点可解释信息：展示评分相对门槛、信源分级、可选五轴与通稿合并说明，而不暴露内部管线诊断界面。

## Requirements

### Requirement: 评分输出可携带解释轴

系统 SHALL 在精选评分步骤中继续以 `attentionScore`（0–100 整数）为唯一入选用分；评分模型 MAY 额外输出 `contentType` 与五轴整数 `axes`（sig/nov/cred/reson/act，各 0–10）。系统 MUST NOT 因缺少轴字段而拒绝合法的仅含 `attentionScore` 的输出。`industry/selection.ts` 中的门槛数字 MUST NOT 因本能力被修改。

#### Scenario: 仅有总分仍可通过校验

- **WHEN** 模型只返回 `{"attentionScore": 72}`
- **THEN** 系统接受该输出并照常计算是否过线

#### Scenario: 带轴输出被存储供展示

- **WHEN** 模型返回总分与五轴
- **THEN** 系统将轴写入该次分析的 `output`，供读者解释使用，且入选判定仍只依赖两次总分之和与分级门槛

### Requirement: 详情暴露精选解释

对可展示评分或已精选的条目，站点详情 API SHALL 提供只读 `selectionExplain`，至少包含分数、对应分级门槛、是否达到门槛、信源分级及其读者标签；有轴时包含轴；存在同指纹通稿同伴时包含通稿合并说明。MUST NOT 包含模型名、receipt、预筛理由等后台字段。

#### Scenario: 读者看到门槛对照

- **WHEN** 一篇 T2 来源资料平均分为 80 且门槛为 76
- **THEN** `selectionExplain` 显示分数 80、门槛 76、已达门槛、分级为媒体与个人类标签

#### Scenario: 旧分析无轴时可降级

- **WHEN** 历史分析没有 `scoreAxes`
- **THEN** 解释中轴为空，仍可展示分数与门槛与分级（若可得）

### Requirement: 卡片紧凑提示

信息流卡片 MAY 通过评分控件的简短提示展示「分数 · 门槛 · 分级」，MUST NOT 在卡片上展开完整五轴仪表盘。

#### Scenario: 卡片不膨胀

- **WHEN** 读者浏览精选列表
- **THEN** 卡片仍以原有 Score 药丸为主，解释细节以悬停或等价短提示呈现

### Requirement: 热点通稿说明

事件详情的 `whyHot` SHALL 在本事件报道按通稿指纹合并导致独立证据数少于报道数时，附带一句通稿合并说明。事件页展示的信源/覆盖计数 MUST 与独立证据键一致（通稿合并）。B 站/贴吧热榜匹配见 `hot-list-matching`：仅作已有事件热度证据，不新建热点。

#### Scenario: 多家通稿只算一方时有说明

- **WHEN** 同一事件下三家媒体转载同一通稿且指纹相同
- **THEN** 热点解释注明通稿近重复已合并，且独立参与/信源计数不把三家都算作独立覆盖
