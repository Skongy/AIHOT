# site-identity Specification

## Purpose
规定站点对外的身份和读者可见文案：本站是面向国内玩家的游戏资讯热点站，网页、RSS、llms.txt、MCP、分享图、报告和公开接口说明里都不再出现 AI 行业站的定位，也不使用 AIHOT 的名字和 Logo。

## Requirements

### Requirement: 行业词为游戏
站点的行业词 MUST 是“游戏”。由行业词拼出的读者可见说法（如“全部游戏动态”、报告描述、分享图小字）SHALL 以游戏为对象，不出现“AI 行业”“AI 动态”“AI 资讯”这类 AI 行业定位。

#### Scenario: 首页标题与描述
- **WHEN** 读者或搜索引擎打开首页
- **THEN** 页面 title、meta description 和结构化数据里的站点描述讲的都是游戏资讯，不含“AI 行业”字样

#### Scenario: RSS 标题
- **WHEN** 订阅者拉取 /feed/all.xml
- **THEN** 频道标题是“GAMEHOT — 全部游戏动态”，不含“AI”

### Requirement: 自有站名与接口前缀
站名和结构化数据里的运营者名 MUST 是 GAMEHOT，MCP 工具前缀 MUST 是 `gamehot`，抓取 User-Agent 名 MUST 是 `gamehot/1.0`。任何地方 SHALL NOT 出现 AIHOT 的名字或 Logo，用户选择保留的页脚框架署名（footerNote）和更新日志示例条目除外。

#### Scenario: MCP 工具名
- **WHEN** Agent 列出本站 MCP 工具
- **THEN** 工具名以本站前缀开头（例如 `gamehot_get_latest`），不是 `myhot_` 或 `aihot_`

#### Scenario: 抓取标识
- **WHEN** worker 请求某个信源
- **THEN** User-Agent 里带的是 `gamehot/1.0`，不是 MyHOTBot 或 AIHOT

### Requirement: 不提供 AI 行业专属功能
站点 SHALL NOT 提供只对 AI 行业有意义的功能页面或接口，包括模型榜、Codex 重置监控和主题大事记。说明内容由 AI 生成的标签（如“AI 评分”“AI 导读”“AI 综述”）不算 AI 行业功能，可以保留。

#### Scenario: 旧的 AI 功能地址
- **WHEN** 有人访问 /leaderboard、/codex-reset 或 /api/v1/codex-resets
- **THEN** 站点返回 404，没有对应页面或数据

### Requirement: 公开接口说明不写 AI 定位
发布在网站根目录的公开文件（openapi-v1.json、manifest.webmanifest、robots.txt）和 /llms.txt MUST 用站点配置生成站名和描述，SHALL NOT 写死“AI items”之类的 AI 行业说法。

#### Scenario: OpenAPI 说明
- **WHEN** 客户端读取 /openapi-v1.json
- **THEN** 接口摘要和描述不含 “public AI items” 这类说法，分类枚举是本站的游戏类别 key
