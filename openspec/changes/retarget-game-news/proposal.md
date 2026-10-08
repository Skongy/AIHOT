# Proposal：变更 1 —— 行业层改为国内玩家游戏资讯（retarget-game-news）

> 状态：已批准（2026-10-08），已在分支 `change/retarget-game-news` 实施。导航方案同日先行获批；Q1-1 ~ Q1-15 的最终答复记在 design.md 的“决定记录”。

## Why

fork 现在仍是上游的“AI 行业示范站”：站名 MyHOT，行业词 AI，导航是“精选 / 全部 AI 动态 / 热点榜 / AI 日报 / 主题 / 收藏”。另外还有 18 个海外 AI 信源，分类是模型 / 产品 / 行业 / 论文 / 教程 / 观点，主题是 OpenAI、Agent 之类，提示词也是“AI 相关性预筛”。

产品已经定好：面向国内玩家，栏目只有资讯、热点、AI 日报、主题四个。这一步把行业层整体换成游戏，导航收成这四个栏目，AI 专属的东西关掉或清理掉。后面的信源（信源官）、精选口味（灵感）、每个游戏的主题页和页面设计都要以此为基础。

## What Changes

- **站点身份与文案**（`site/site.ts`、`site/public/*`、`site/changelog.json`、`site/brand/nameplates/*`）：行业词 `subject` 从 “AI” 改成 “游戏”。站名、`organization` 改成 GAMEHOT，`mcpPrefix`、`crawlerName` 用 `gamehot`，slogan 是“国内玩家每天该知道的游戏热点”。首页标题、描述、tagline、关键词、关于页、分享卡、报告用语都改成国内玩家的视角。日报报头字重新生成。
- **分类体系**（`industry/taxonomy.ts`）：
  - 改为 4 个游戏类别：新游、版本、电竞、行业（`industry` 兜底，也收厂商、发行、版号、评测、观点；见 design.md D5）
  - 分类标签、主题标签、实体标签、近义词表、`ITEM_TYPES`、`RELEASE`（“N 款新游”）、`PLAIN_TERMS` 全部换成游戏版本
  - `ENTITIES`、`IDENTITY_LEXICON`、`PUBLISHER_DOMAINS`、`IDENTITY_CONTEXT_ALIASES` 换成游戏厂商和少量种子游戏
  - **BREAKING**（只影响已部署的实例）：类别 key 改了，旧的 `/all?category=ai-models`、`/feed/category/ai-models.xml` 会失效。fork 还没上线，实际没有影响
- **主题目录**（`industry/topics.json`）：
  - 三个组的显示名改成“游戏 / 平台与品类 / 内容形态”（组 key `company/field/genre` 写死在代码里，不改）
  - 删掉全部 38 个 AI 主题
  - 放 8 款种子游戏主题，以及按新标签划分的 13 个平台与品类主题、12 个内容形态主题
- **提示词**（`industry/prompts/`），先做一版“最小可用”的改写：
  - 预筛从“AI 相关性”改成“游戏相关性”
  - `structure.md`、`content-understanding.md` 里写死的 AI 标签白名单、内容类型、示例换成游戏的
  - `selection-score.md` 的读者画像，以及“重要什么、噪声是什么”的例子，换成国内玩家视角的**占位版**。保留原来的结构：内容类型、五个维度加权、噪声压制、安全边界
  - `rules-domain.md` 改成游戏术语规则；`summarize-*.md` 等文件里的“AI 行业资深编辑”改成“游戏行业资深编辑”
  - 精细的热点标准和门槛校准放到变更 3（灵感）
- **示范信源**（`industry/sources.json`）：去掉 18 个 AI 信源。文件留空（空库冒烟不需要占位源）。正式名单放到变更 2（信源官）
- **导航**（对引擎做小补丁，改 `apps/web`；**导航方案已获用户批准，2026-10-08**）：
  - 桌面侧栏“内容”区和手机底栏都只保留四个栏目：资讯（`/`，默认显示精选，页内可切到全部）、热点（`/hot`）、AI 日报（`/daily`，周报和月报也归在这里）、主题（`/topics`）
  - “收藏”移到“更多 / 我的”
  - “全部动态”不再单独占栏目，在资讯页里和精选来回切换（桌面也要能切）
- **AI 专属功能**：
  - 模型榜、Codex 重置监控、主题大事记已经在上游 4.0.0 从框架里删掉了。fork 的 9848e93 已经包含，迁移 0053 会删掉相关表
  - 本变更检查确实没有残留，再清理零散的 AI 文案：openapi 摘要 “List recent public AI items”、后台占位 “OpenAI 博客”、`scripts/mcp-check.ts` 的查询词 “OpenAI”、llms.txt 的“各公司与…”小标题、给 Agent 的使用说明里“某家公司、产品、模型”的示例
  - “AI 评分 / AI 导读 / AI 综述 / AI 翻译”这些标签说的是“这段内容由 AI 生成”，跟 AI 行业无关，默认保留（Q1-8）
- **测试**：`tests/` 里引用 AI 分类、标签、公司的例子（约 45 个文件）换成游戏里对应的项。测的规则本身不改

## Capabilities

### New Capabilities
- `site-identity`：站点名称、行业词、读者可见文案、品牌字标、公开文件里的站点描述，都以“国内玩家的游戏资讯”为准，不再出现 AI 行业的定位
- `site-navigation`：主导航只有四个栏目（资讯、热点、AI 日报、主题），桌面和手机一致；其余页面放进“更多 / 我的”
- `content-taxonomy`：游戏资讯的类别、标签词表、内容类型、头条发布计数、主题分组和主题目录
- `content-scope`：哪些资料算本站内容（游戏相关性预筛），以及结构化、写作步骤用的游戏词表与读者画像
- `source-seeding`：首次启动导入的示范信源不再含 AI 行业信源

### Modified Capabilities
（无。仓库还没有基线 specs。）

## Impact

- **只改配置**（不涉及引擎）：`site/site.ts`、`site/public/{openapi-v1.json,manifest.webmanifest,robots.txt}`、`site/changelog.json`、`site/brand/nameplates/*`、（有素材就换）`site/brand/*`、`industry/taxonomy.ts`、`industry/topics.json`、`industry/sources.json`、`industry/prompts/*.md`
- **引擎小补丁**（以后合并上游可能冲突，单独列在 files.md）：`apps/web/app/components/shell/nav.ts`、`apps/web/app/routes/{home,topics,topic}.tsx` 的 `handle`、资讯页桌面的“精选 | 全部”切换（`apps/web/app/features/feed/Filters.tsx`、`routes/home.tsx`、`routes/all.tsx`）、`routes/more.tsx` 去掉主题行、`routes/topics.tsx` 手机顶栏去掉返回键，以及 `apps/web/app/routes/admin/source-new.tsx`、`scripts/mcp-check.ts`、`packages/backend/src/publication/{llms,agent}.ts` 各一行文案
- **测试**：`tests/*.test.ts` 里约 45 个文件的示例数据
- **数据库**：没有新迁移。新库首次启动会按新的 `sources.json` 导入。如果已经用 AI 版跑过本地库，建议重建，因为旧 AI 信源不会自动删除
- **公开接口**：版本保持 4.0.0（还没有外部接入方）。类别 key、MCP 工具前缀、RSS 标题都会变
- **成本**：本变更本身不调用模型，测试只连本地假服务

## Out of Scope

- 正式信源名单（变更 2，信源官）；精选标准细化与门槛校准（变更 3，灵感）；完整的每游戏主题页（大量游戏、游戏元数据、封面，变更 4）；页面视觉重设计（变更 5，前端设计）
- 史低、商城、战绩、工具类功能
- 不改采集、评分、归组、热度、日报编排算法；不改数据库结构
- 不改 README、docs/（和上游保持一致，方便合并，见 Q1-10）
- 部署、域名、HTTPS、ICP 备案、上线

## 前置条件

- 变更 0 已完成并归档，fork 已同步到上游最新（07d4c77，PR #1 合并后为 65c58e2）
- 本机能跑基线验证：Node 24.11+、PostgreSQL 17、`npm ci`、Playwright 浏览器（见 README 的本地运行一节）
- 用户已回答 design.md 里标为“阻塞”的问题（Q1-1 站名、Q1-2 栏目映射的最终确认、Q1-3 类别 key），2026-10-08 已全部答复
