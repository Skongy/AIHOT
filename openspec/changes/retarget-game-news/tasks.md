# Tasks：retarget-game-news

> 用户批准本变更、回答阻塞问题 Q1-1/Q1-2/Q1-3 后才开工。全程在本地分支 `change/retarget-game-news` 上做。
> 未经用户另行批准，不提交、不推送、不开 PR。

## 1. 前置与基线

- [ ] 1.1 确认变更 0 已完成，fork 已同步到上游最新；`git log -1` 与 upstream/main 一致
- [ ] 1.2 本机 Node ≥ 24.11、PostgreSQL 17 可用、测试账号有 CREATEDB 权限；`npm ci` 成功
- [ ] 1.3 `npx playwright install --with-deps chromium webkit`
- [ ] 1.4 改动前跑一遍基线：`npm run typecheck`、`DATABASE_URL=postgres://…/aihot_test npm test`、`npm run build -w @aihot/web && node --test apps/web/tests/*.test.ts`，记下已有失败（如果有）
- [ ] 1.5 `.env` 用 `scripts/init-env.ts` 生成，把 `COLLECT_ENABLED`、`MODEL_CALLS_ENABLED` 改成 `false`（本变更不采集、不调模型）

## 2. 站点身份与文案（site/）

- [ ] 2.1 `site/site.ts` 的 `SITE`：`name`、`subject: "游戏"`、`homeTitle`、`topicsTitle`、`description`、`tagline`、`keywords`、`mcpPrefix`、`crawlerName`、`organization.name`、`feedbackExample` 按 Q1-1 填写
- [ ] 2.2 `ABOUT.headline/lead/steps`、`CARDS`、`AGENT.search`、`REPORTS`（`entry`、`metricUnits`、`quiet`）改成玩家口吻，核对“件大事”“个来源”等量词
- [ ] 2.3 `footerNote` 按 Q1-12 处理；`locale` 保持 `zh-CN`（Q1-13）
- [ ] 2.4 `site/public/openapi-v1.json`：“List recent public AI items”等 8 处带 AI 的描述改成中性或游戏说法；核对 `{{categories}}` 占位仍然生效
- [ ] 2.5 `site/public/manifest.webmanifest`、`robots.txt` 核对占位，不写死 AI
- [ ] 2.6 `site/changelog.json`：上线示例条目的文案和日期改成占位（等上线时再定），署名按 Q1-12 处理
- [ ] 2.7 重新生成报头字：`npm pack @fontsource/noto-sans-sc@5.3.0 && tar xzf …`，然后 `node scripts/nameplates.ts package`，更新 `site/brand/nameplates/*.svg` 和 `index.json`（叫法按 Q1-4）。生成用的字体包不进仓库
- [ ] 2.8 （有素材时）替换 `site/brand/` 的图标和 `Logo.tsx`（Q1-11）

## 3. 分类体系（industry/taxonomy.ts）

- [ ] 3.1 `CATEGORIES` 换成 Q1-3 确认的游戏类别（保留 key `industry`），写好 `guide`、`section`、`commentary`、`feedLabel`
- [ ] 3.2 `RELEASE`（新游计数或 null）、`PLAIN_TERMS`、`ITEM_TYPES` 换成游戏版本
- [ ] 3.3 `CATEGORY_TAGS`、`TOPIC_TAGS`、`ENTITY_TAGS`、`TAG_SYNONYMS` 换成游戏词表（近义词包括：上线→定档/上线、公测→定档/上线、更新→版本更新、卡池→版本更新、版号→版号/政策……）
- [ ] 3.4 `ENTITIES` 换成种子厂商和种子游戏（Q1-5），游戏要写全常用别名（简称、英文名、国服名）
- [ ] 3.5 `IDENTITY_LEXICON`、`PUBLISHER_DOMAINS`、`IDENTITY_CONTEXT_ALIASES` 换成对应的游戏和厂商（拿不准的先留空，宁缺毋滥）
- [ ] 3.6 `site/site.ts` 的 `PUBLIC_CATEGORIES` 保持 `{}`（不合并类别）

## 4. 主题目录（industry/topics.json）

- [ ] 4.1 `groups` 显示名和简介改成“游戏 / 平台与品类 / 内容形态”（key 不改）
- [ ] 4.2 删掉 38 个 AI 主题；为每款种子游戏加一个 `group: "company"` 的主题（`slug` 用稳定的拼音或英文，`entityId` 对应 3.4）
- [ ] 4.3 按 `TOPIC_TAGS` 加平台和品类主题，按 `CATEGORY_TAGS` 加内容形态主题；每条写好 `definition`
- [ ] 4.4 检查：每个 `entityId` 都在 `ENTITIES` 里，每个 `tags` 都在词表里，`slug` 没有重复

## 5. 提示词（industry/prompts/，最小可用版）

- [ ] 5.1 `prefilter.md` 改成游戏相关性预筛（PASS/BLOCK/UNKNOWN 语义和 JSON 输出格式不变）
- [ ] 5.2 `structure.md`：领域描述、游戏标签规则、“主体（游戏或厂商）”的说法；模板变量不变
- [ ] 5.3 `content-understanding.md`：内容类型表、标签白名单、实体白名单、示例 JSON 和 `ITEM_TYPES` 完全一致
- [ ] 5.4 `selection-score.md`：读者画像、类型权重表、“正常评价”和“压住”的例子换成游戏占位版，保留五个维度和安全边界；文件顶部注明“占位，待变更 3 校准”
- [ ] 5.5 `rules-domain.md` 改成游戏术语规则；`rules-self-contained-title.md`、`summarize-article.md`、`summarize-long-post.md`、`translate-body.md`、`rules-answer-first-summary.md`、`identity-context.md`、`report-period.md` 里的 AI 示例和角色换成游戏的
- [ ] 5.6 `rg -n -i '\bAI\b|模型发布|OpenAI|Anthropic|论文' industry/prompts` 只剩合理用法（例如“AI 与游戏”标签）

## 6. 示范信源（industry/sources.json）

- [ ] 6.1 去掉全部 18 个 AI 信源；按 Q1-6 留空或放占位游戏源（占位源标 `"$comment"`，写明“待信源官替换”）
- [ ] 6.2 `node --env-file=.env scripts/seed.ts` 在空库上能跑完

## 7. 导航（引擎补丁，apps/web）

- [ ] 7.1 `components/shell/nav.ts`：“内容”区改成 资讯 `/`（end）、热点 `/hot`、AI 日报 `/daily`、主题 `/topics`；收藏移到“更多”区开头
- [ ] 7.2 `ENGINE_TABS` 改成 资讯 / 热点 / AI 日报（底栏可用短名“日报”，Q1-4）/ 主题（新 key `topics`）/ 我的
- [ ] 7.3 `routes/home.tsx` 的 `handle.name` 和页面标题从“精选”改成“资讯”（页内的“精选 | 全部”切换保留）
- [ ] 7.4 `routes/topics.tsx` 的 `handle` 改成 `{ tab: "topics", name: "主题" }`，`routes/topic.tsx` 改成 `{ home: "topics" }`
- [ ] 7.5 资讯页桌面加“精选 | 全部”切换（复用 `PillTabs`），保证 `/all` 在桌面能进去；`routes/all.tsx` 的 `handle.tab` 保持 `featured`（资讯）
- [ ] 7.6 `routes/more.tsx`：去掉已经升为栏目的“主题”行，保留收藏、Agent 接入（Q1-7）、关于、更新日志、反馈
- [ ] 7.7 手动看一遍：桌面侧栏和手机底栏正好是四个栏目（手机再加“我的”）；日报、周报、月报页“AI 日报”高亮；主题详情页返回到主题

## 8. 清理残留 AI 文案

- [ ] 8.1 `rg -n -i 'leaderboard|codex-reset|模型榜'` 确认引擎里没有模型榜和 Codex 监控代码（只剩 docs/deploy.md 的升级说明）
- [ ] 8.2 （可选，引擎）`apps/web/app/routes/admin/source-new.tsx` 的占位“OpenAI 博客”改成游戏示例；`scripts/mcp-check.ts` 的查询词“OpenAI”改成种子游戏名
- [ ] 8.3 （可选，引擎，Q1-7 决定）`packages/backend/src/publication/llms.ts` 的“各公司与…”、`agent.ts` 的“某家公司、产品、模型”示例改成按组名或游戏的说法

## 9. 测试示例迁移

- [ ] 9.1 按 files.md 的清单，把 tests/ 里的 `ai-models`、`ai-products`、`paper`、`tip`、`opinion`、模型发布、产品更新、`entity:openai` 之类示例换成游戏里对应的项（规则不改）
- [ ] 9.2 `topics.test.ts`、`topic-membership.test.ts`、`topics-withdrawal.test.ts` 用种子游戏主题重写示例
- [ ] 9.3 apps/web/tests 如果有依赖“精选”标签或导航结构的断言，同步更新

## 10. 验证

- [ ] 10.1 `npm run typecheck` 通过
- [ ] 10.2 `DATABASE_URL=postgres://…/aihot_test npm test` 全部通过（对照 1.4 的基线）
- [ ] 10.3 `npm run test:standalone` 通过
- [ ] 10.4 `npm run build -w @aihot/web && node --test apps/web/tests/*.test.ts` 通过
- [ ] 10.5 空库跑起三个进程（安全阀关），`node scripts/smoke.ts --base http://localhost:3000` 通过
- [ ] 10.6 人工检查（截图给用户）：首页（资讯）、热点、AI 日报、主题目录、一个游戏主题页、关于、/llms.txt、/feed.xml 标题、/openapi-v1.json、/agent 的 MCP 前缀
- [ ] 10.7 全站搜索读者可见的 “AI ” 字样（`rg` 加页面抽查），只剩 Q1-8 允许保留的
- [ ] 10.8 `openspec validate retarget-game-news --strict` 通过

## 11. 交付

- [ ] 11.1 整理 diff 摘要，引擎补丁和配置改动分开列，连同截图发给用户审阅
- [ ] 11.2 用户批准后才提交、推送或开 PR；合并后 `openspec archive retarget-game-news`
