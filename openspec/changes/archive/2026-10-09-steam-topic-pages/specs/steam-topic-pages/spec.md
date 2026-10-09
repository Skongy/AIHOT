# steam-topic-pages Specification

## Purpose

规定四款 Steam 种子游戏主题深页：展示公开商店元数据与本站已收录的更新/新闻时间线，且不依赖 Steam WebAPI key，也不改精选门槛。

## ADDED Requirements

### Requirement: 种子主题绑定 Steam AppID

系统 SHALL 在行业包主题定义中为四款种子游戏（以撒的结合：重生、杀戮尖塔 2、喵喵的结合、博德之门 3）配置对应的 Steam `steamAppId`（250900、2868840、686060、1086940）。未配置 `steamAppId` 的主题 MUST NOT 请求 Steam 商店接口。

#### Scenario: 四款种子均可解析 AppID

- **WHEN** 加载上述任一主题定义
- **THEN** 主题带有正确的 `steamAppId` 整型字段

### Requirement: 无 key 拉取商店元数据

对配置了 `steamAppId` 的主题，系统 MAY 通过公开的 Steam store `appdetails` JSON（含中文语言与国区）获取商店元数据。系统 MUST NOT 要求 Steam WebAPI key。拉取或解析失败时，主题页 MUST 仍可返回，仅省略商店面板。

#### Scenario: 成功时返回可读元数据

- **WHEN** appdetails 返回 success 且含游戏数据
- **THEN** 主题页 API 提供名称、短简介、封面、发售信息、开发商/发行商、类型与可选国区价格，以及商店页链接

#### Scenario: 失败时降级

- **WHEN** 网络失败或 Steam 返回 success=false
- **THEN** `steam` 字段为 null，精选时间线仍可展示

### Requirement: 主题页展示时间线与商店卡

配置了 Steam 的主题在其第 1 页 SHALL 向读者展示商店卡（若有元数据）以及本站已收录精选条目构成的更新/新闻时间线。系统 MUST NOT 因此修改 `industry/selection.ts` 门槛数字。

#### Scenario: 深页结构

- **WHEN** 读者打开 `/topics/baldurs-gate-3`
- **THEN** 页面在列表上方展示商店信息（可用时），并以时间线列出该主题精选新闻
