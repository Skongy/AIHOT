# Design：connect-game-sources

## Context

- 引擎已有 `rss`、`web_list`、`json_list`、`x_search`、`mp_account`、`external`。本变更只用前三种。
- `web_list` 支持 HTML 选择器、`allowUrlPrefixes`/`denyUrlPrefixes`、`ingestNoiseFilter`、`detail`（文章页补日期 / 标题）、`baseUrl`、GBK / UTF-8 自动识别。`json_list` 支持任意 JSON 路径取标题、时间、地址模板。
- `ingestNoiseFilter` 的现有语义（`packages/backend/src/sources/filters.ts`）：先看 `keepIfMatches`（标题 + 列表摘要，命中就保留），再看 `dropMarkersTitleOnly`（只看标题）和 `dropMarkers`（标题 + 摘要），命中就丢；都不命中的保留。大小写不敏感。
- 列表上没有日期、文章页也补不到日期的条目，入库后算“发布时间未知”的存档（`backfill_reason = unknown-publication-time`），能打开详情页，但进不了精选。
- `participation_mode: editorial` 的信源进精选 / 全部；热榜类 `hot_signal` 留给变更 4。

## Goals / Non-Goals

**Goals**
- 信源官 v1 的媒体名单 16 个、官方名单 15 个写进 `sources.json`，空库首次启动即可导入。
- 明显的非游戏内容和官方公告里的活动、皮肤、封禁在进模型之前挡掉。
- 页面快照回归测试，防止选择器一改就坏。

**Non-Goals**
- 不为前端渲染站或要登录的站写专用采集代码。
- 不改热度门槛、评分提示词或日报结构。
- 不打开任何信源的全文展示。

## Decisions

### D1. 全部用现有采集器，不写新代码

31 个源都能用 `rss` / `web_list` / `json_list` 的现有配置项抓到。需要新代码的（前端渲染、签名、登录）全部列为暂缓，见 proposal。

### D2. 媒体信源（信源官 v1，按 Q2-1 默认：媒体 T2，国家新闻出版署 T1）

| id | 名称 | kind | tier | 间隔（分钟） | 关键配置 |
|---|---|---|---|---|---|
| rss-gcores | 机核 | rss | T2 | 60 | allow `/articles/`，deny `/radios/` |
| rss-ign-cn | IGN中国 | rss | T2 | 60 | 地址用 `https://www.ign.com.cn/feed.xml`（`/rss` 会 301 到 http 的 feed.xml） |
| rss-gnn | 巴哈姆特GNN | rss | T2 | 30 | 繁体；`dropMarkersTitleOnly` 去掉【試片】【試閱】【影評】劇場版 動畫化 改編動畫 輕小說 等 |
| rss-yystv | 游研社 | rss | T2 | 180 | |
| rss-chuapp | 触乐 | rss | T2 | 180 | |
| rss-youxichaguan | 游茶 | rss | T2 | 120 | |
| rss-hltv | HLTV | rss | T2 | 60 | 英文，只覆盖 CS |
| web-gamersky | 游民星空 | web_list | T2 | 60 | `ul.pictxt li` / `div.tit a` / `div.time`；allow `/news/20` |
| web-3dm | 3DM | web_list | T2 | 60 | `div.Revision_list li` / `a.bt` / `span.time` |
| web-a9vg | A9VG | web_list | T2 | 120 | `li.a9-rich-card-list_item-gap`，标题 `.a9-rich-card-list_label`，日期用正则 |
| web-17173 | 17173 | web_list | T2 | 60 | `ul.ptlist-news li.item`；只收 `news.17173.com/content/`；列表只有月日，`detail` 读文章页结构化数据补日期 |
| web-sina-esports | 新浪电竞 | web_list | T2 | 60 | `h3.article_title`；列表是“4 小时前”，`detail.publishedAtSelector: span.timer` |
| web-wanplus | 玩加电竞 | web_list | T2 | 60 | 只收 `/article/`；`detail.publishedAtSelector: span.com-time` |
| web-youxituoluo | 游戏陀螺 | web_list | T2 | 90 | `ul.article_list li` / `a.title`；标题带栏目前缀，`detail.titleSelector: div.title_detail`（权威） |
| web-indienova | indienova | web_list | T2 | 180 | **停用**：没有任何发布时间 |
| web-nppa-games | 国家新闻出版署·国产网络游戏审批 | web_list | T1 | 1440 | 用子页 `yxspjg/gcwlyxspxx/`（总页最新停在 03-25，子页最新 09-30）；`ul.m2nrul li` / `span` 日期 |

### D3. 官方信源（官方信源 v1，按任务指定的 15 个）

| id | 名称 | kind | tier | owner | 间隔 | 关键配置 |
|---|---|---|---|---|---|---|
| json-pvp-news | 王者荣耀官网·新闻公告 | json_list | T1 | honor-of-kings | 60 | `msg.result`，`sTitle`，`sIdxTime`；链接 `pvp.qq.com/web201706/newsdetail.shtml?tid={iNewsId}`；**标题规则** |
| json-lol-news | 英雄联盟官网·新闻公告 | json_list | T1 | league-of-legends | 60 | 实测地址的 `r0=jsonp` 改成 `r0=json`（同一接口，直接返回 JSON；JSONP 外壳要新代码）；链接 `lol.qq.com/news/detail.shtml?docid={iDocID}`；**标题规则** |
| json-miyoushe-ys | 原神·米游社官方公告 | json_list | T1 | genshin-impact | 60 | `data.list`，`post.subject`，`post.created_at`（秒）；链接 `miyoushe.com/ys/article/{post_id}`；**标题规则** |
| json-miyoushe-sr | 崩坏：星穹铁道·米游社官方公告 | json_list | T1 | honkai-star-rail | 60 | 同上，`gids=6`，链接 `/sr/article/`；**标题规则** |
| web-yjwujian | 永劫无间官网·新闻公告 | web_list | T1 | naraka-bladepoint | 120 | 官网首页的公告列表 `ul.news-list li`，只收 `/news/official/`、`/news/update/`（`/news/official/` 目录本身 404）；**标题规则** |
| web-gp-qq | 和平精英官网·新闻公告 | web_list | T1 | peacekeeper-elite | 120 | 首页 `a.sec2-info-rg`（GBK），列表只有月日，`detail.publishedAtSelector: p.date`；**标题规则** |
| web-lolesports | LoL Esports 新闻 | web_list | T1 | league-of-legends | 120 | 页面实际是英文；标题 `[class*="textStyle_headline"]`，日期用英文日期正则 |
| rss-steam-cs2 | Steam·CS2 更新 | rss | T1 | valve | 60 | |
| rss-steam-dota2 | Steam·Dota 2 更新 | rss | T1 | valve | 60 | |
| rss-ps-blog-zh-hant | PlayStation 中文博客 | rss | T1 | sony | 120 | 繁体 |
| rss-xbox-wire | Xbox Wire | rss | T1 | microsoft | 120 | 只收 `news.xbox.com`（去掉跳 YouTube 的条目） |
| rss-nintendo-jp | 任天堂日本·新着情報 | rss | T1 | nintendo | 60 | 日文；feed 一次给约 200 条，首次导入只取 8 条 |
| web-nintendo-hk | 任天堂香港·最新消息 | web_list | T1 | nintendo | 180 | 地址会跳到 `nintendo.com/hk/topics`，配 `baseUrl`；`a.ncmn-u-linkbox` / `.ncmn-softUnit__name` / `.ncmn-softUnit__release` |
| rss-steam-news | Steam 商店新闻 | rss | **T1_5** | — | 60 | 各游戏开发商自己发的公告（不是 Valve 新闻），所以不标 valve、给 T1_5 |
| rss-netease-ir | 网易投资者关系 | rss | T1 | netease | 720 | 英文，财报级 |

`owner_entity_id` 用 `industry/taxonomy.ts` 的 ENTITIES：单款游戏的官方源标游戏（LoL 官网和 LoL Esports 都标 league-of-legends，热度里算一个参与方），平台和厂商源标厂商。

### D4. 官方公告标题规则（只用于 6 个单款游戏公告源）

灵感定的规则：保留 版本 / 停服 / 赛季 / 定档 / 公测 / DLC / 新角色 / 平衡调整 / 联动（及合理变体，如更新公告、资料片、回归）；丢弃 封禁 / 活动 / 皮肤。

实现（`ingestNoiseFilter`，6 个源共用同一份）：

- `keepIfMatches`：版本更新、版本前瞻、新版本、更新说明、资料片、停服、停运、关服、赛季、定档、公测、上线时间、DLC、新角色、新英雄、平衡、联动、回归
- `dropMarkersTitleOnly`：封禁、活动、皮肤、装扮、祈愿、跃迁、召唤、周免、礼包、限时销售

几处取舍（用实测标题定的，测试里逐条写死）：

1. **“版本”用的是“版本更新 / 版本前瞻 / 新版本 / 更新说明”，不是单字“版本”**。米游社几乎每条都带“4.6版本”，单字“版本”会把“4.6版本活动跃迁（其一）”（卡池）这类保下来，正好违反灵感的排除项。
2. **没有单独用“更新公告”**：它会把“10月2日周免英雄更新公告”保下来（保留词优先于丢弃词）。版本更新公告已被“版本更新”覆盖，其余“不停机更新公告”两边都不命中，照常进预筛。
3. **丢弃词加了同类词**：装扮（原神的皮肤叫“装扮”）、祈愿 / 跃迁 / 召唤（卡池）、周免、礼包、限时销售（皮肤销售）。
4. **两边都不命中的不丢**（例如“世界任务说明”“4.6版本新增关卡”）：交给模型预筛，避免把没想到的重要公告挡在门外。
5. **保留词优先**：“联动活动开启”“SS41赛季开启公告”会保留。

实测效果（2026-10-08）：王者 15→8、英雄联盟 16→6、原神 20→6、星铁 20→12、永劫 18→11（6 条封禁公告全部去掉）、和平精英 26→21。

### D5. 首次回填（Q2-4 默认）

每个源 `_aihot.initialBackfillLimit: 8`、`initialBackfillMonths: 1`，首日最多约 30 × 8 = 240 条进入模型流水线。

### D6. 风险与对策

| 风险 | 对策 |
|---|---|
| HTML 列表页改版导致选择器失效 | 快照回归测试；线上失败后 `fail_count` 退避，后台“信源健康”可见 |
| 反爬 / 限流 | 间隔不低于 30 分钟；文章页补日期每轮最多 8–10 个；失败退避 |
| 游戏陀螺最新文章只有“N 小时前” | 当天文章先按“发布时间未知”存档，过 24 小时列表换成绝对时间后补上（会晚一天进精选，并多一次分析）。要实时需要引擎小补丁（解析相对时间），列为待决定 |
| 玩加电竞首页最新一篇停在 09-19 | 低活跃，照常抓；一个月没新内容再考虑停用 |
| 王者、英雄联盟文章页是前端渲染 | 正文抽不到，模型只看到标题；版本公告标题信息量够用。以后可以找正文接口 |
| 官方源 T1 门槛低（selection.ts 里 T1=60） | 标题规则先挡掉活动、皮肤；精选门槛在变更 3 校准 |
| 任天堂日本一次 200 条 | 首次导入只取 8 条；之后按 RSS 缓存头只收新条目 |
| 部署机在大陆访问 HLTV、巴哈姆特、Xbox、LoL Esports | 失败会退避；需要时配 `EGRESS_PROXY_URL`（Q2-5，部署时决定） |
| 没有 LLM key | 采集照常，资料停在“待分析”，不公开 |

### D7. 测试策略

1. 名单：媒体 16 + 官方 15，id 不重复，地址不重复。
2. 每个源：`unsupportedConfig` 为空；只用 rss / web_list / json_list；editorial；不展示全文；回填 8 条 / 1 个月；`owner_entity_id` 在 ENTITIES 里；分级符合 D2、D3。
3. 标题规则只出现在 6 个单款游戏源上，且是同一份；PlayStation、Xbox、任天堂、Steam 没有。
4. 标题规则逐条：23 条真实标题的保留 / 丢弃 / 放行。
5. 快照：每个源在删减后的真实页面上能解析出至少 3 篇、地址都在允许前缀内；列表有日期的源 90% 以上带日期；列表没日期的源必须配了 `detail` 或停用。
6. 噪声：机核快照里的电台被去掉；巴哈快照里的动画、试片被去掉而游戏新闻保留；17173 只剩新闻页；官方快照里活动、皮肤、封禁被去掉；PlayStation 不过滤。
7. 文章页：新浪、玩加、和平精英（GBK）、17173 补出正确日期；游戏陀螺取到不带栏目前缀的标题。
8. 人工试抓：每个源读一次列表（不存库、不调模型），记录条数和样例（结果见 tasks.md 4.x 和 `/workspace/aihot-plan/trial-fetch-2026-10-08.json`）。

### D8. 与后续变更的依赖

- 变更 3 依赖本变更提供真实标题样本；官方源 T1 的门槛在变更 3 一起校准。
- 变更 4 依赖本变更提供编辑信源；热榜信源单独在变更 4 加。

## 已按默认值决定

- Q2-1 分级：A（媒体 T2、国家新闻出版署 T1）。官方信源 T1，Steam 商店新闻 T1_5。
- Q2-2 IGN中国视频条目：A（照常收，交给预筛和评分）。
- Q2-3 国家新闻出版署：只收国产网络游戏审批（子页 `gcwlyxspxx/`）。
- Q2-4 首次回填：每源 8 条、1 个月。
- Q2-5 代理：不在仓库里配，部署时按需设置 `EGRESS_PROXY_URL`。

## 仍待用户决定

- **游戏陀螺的相对时间**：接受“晚一天进精选”，还是做一个解析“N 分钟 / 小时前”的引擎小补丁（约 20 行 + 测试，属于引擎改动，需单独批准）？
- **标题规则的取舍**（D4 第 1–3 条）：“版本”收窄成“版本更新 / 版本前瞻 / 新版本 / 更新说明”、不单独用“更新公告”、丢弃词加了 7 个同类词。如果灵感要严格按原词，改 `sources.json` 一处即可。
- **两边都不命中的标题**：现在放行给预筛。要改成“只留保留词”（严格白名单），现有配置做不到干净的写法，需要给 `ingestNoiseFilter` 加一个 `requireKeep` 选项（引擎小补丁）。
