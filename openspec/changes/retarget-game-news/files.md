# 要改的文件清单：retarget-game-news

基准：上游 KKKKhazix/AIHOT main @ 07d4c77（fork 同步后）。图例：〔配置〕= 上游说明里允许改的 site/、industry/；〔引擎〕= apps/、packages/、scripts/ 下的补丁，以后合并上游可能冲突。

## 〔配置〕site/

| 文件 | 改什么 |
|---|---|
| `site/site.ts` | `SITE.name/subject("游戏")/homeTitle/topicsTitle/description/tagline/keywords/mcpPrefix/crawlerName/organization.name/feedbackExample/footerNote`；`ABOUT.headline/lead/steps/sourcesFallback`；`CARDS` 各页文字；`AGENT.search`；`REPORTS.entry/metricUnits/shareUnit/quiet`。`EDITION_TIMES` 按 Q1-15；`PUBLIC_CATEGORIES` 保持 `{}` |
| `site/public/openapi-v1.json` | 8 处带 “AI” 的 summary/description（如 “List recent public AI items”）改成中性说法；分类枚举仍用 `{{categories}}` 占位 |
| `site/public/manifest.webmanifest`、`site/public/robots.txt` | 只核对占位，预计不用改 |
| `site/changelog.json` | 示例条目的文案、日期、`latestVersion` 改成占位；署名按 Q1-12 |
| `site/brand/nameplates/{daily,weekly,monthly,archive}.svg`、`index.json` | 用 `scripts/nameplates.ts` 按新的 `subject` 重新生成 |
| `site/brand/{logo.svg,icon.png,icon-192.png,apple-icon.png,favicon.ico,Logo.tsx}` | 有素材才换（Q1-11） |
| `site/models.ts` | 不改（模型用 .env 的默认值，Q1-14） |
| `site/pages/terms.md`、`privacy.md` | 不改（模板，上线前另做） |

## 〔配置〕industry/

| 文件 | 改什么 |
|---|---|
| `industry/taxonomy.ts` | `CATEGORIES`（游戏 7 类草案，保留 `industry`）、`RELEASE`、`PLAIN_TERMS`、`ITEM_TYPES`、`CATEGORY_TAGS`、`TOPIC_TAGS`、`ENTITY_TAGS`、`TAG_SYNONYMS`、`ENTITIES`（厂商和种子游戏）、`IDENTITY_LEXICON`、`PUBLISHER_DOMAINS`、`IDENTITY_CONTEXT_ALIASES`，全部替换 |
| `industry/topics.json` | `groups` 显示名改成“游戏 / 平台与品类 / 内容形态”；38 个 AI 主题换成种子游戏（company 组）和平台、品类、内容形态主题 |
| `industry/sources.json` | 去掉 18 个 AI 信源（Q1-6） |
| `industry/prompts/prefilter.md` | AI 相关性 → 游戏相关性 |
| `industry/prompts/structure.md` | “已确认与 AI 相关” → 游戏；“模型发布”等标签规则 → 游戏标签规则；“主体公司” → 主体（游戏或厂商） |
| `industry/prompts/content-understanding.md` | 写死的 itemType 表（model_release…）、标签和实体白名单、示例 JSON → 游戏版（要和 `ITEM_TYPES`、词表一致） |
| `industry/prompts/selection-score.md` | 读者画像、类型权重表、“正常评价”和“压住”的例子 → 游戏占位版（结构不变） |
| `industry/prompts/rules-domain.md` | AI 术语表 → 游戏术语表 |
| `industry/prompts/rules-self-contained-title.md` | GPT、OpenAI 示例 → 游戏示例 |
| `industry/prompts/summarize-article.md`、`summarize-long-post.md` | “AI 行业资深编辑”、要保留的 AI 数字类型 → 游戏（版本号、上线日期、平台、价格、在线人数、销量） |
| `industry/prompts/translate-body.md`、`rules-answer-first-summary.md`、`identity-context.md`、`report-period.md` | 单处的 AI 说法改成游戏或中性说法 |
| `industry/prompts/` 其余（group-*、story-digest、safety、translate-post、report-period-sections 等） | 预计不用改，实施时再 grep 确认 |
| `industry/gold.example.jsonl`、`relation-gold.example.jsonl`、`story-digest-eval.example.jsonl` | 不改（格式示例，变更 3 校准时换成游戏样本） |
| `industry/selection.ts` | 不改（门槛留到变更 3 校准） |

## 〔引擎〕导航补丁（必需）

| 文件 | 改什么 |
|---|---|
| `apps/web/app/components/shell/nav.ts` | `SECTIONS`“内容”区改成 资讯 / 热点 / AI 日报 / 主题，收藏移到“更多”；`ENGINE_TABS` 改成 资讯 / 热点 / AI 日报 / 主题(`topics`) / 我的；`TabKey` 加 `"topics"` |
| `apps/web/app/routes/home.tsx` | `handle.name`、页面标题和 jsonLd 名称 “精选” → “资讯”；桌面区（`hidden lg:block`）加“精选 \| 全部”切换 |
| `apps/web/app/features/feed/Filters.tsx` | 抽出或复用“精选 \| 全部”的 `PillTabs`，给桌面用（手机 `FeedBar` 不变） |
| `apps/web/app/routes/all.tsx` | 桌面区加同样的切换（`handle` 不变） |
| `apps/web/app/routes/topics.tsx` | `handle` → `{ tab: "topics", name: "主题" }` |
| `apps/web/app/routes/topic.tsx` | `handle` → `{ home: "topics" }` |
| `apps/web/app/routes/more.tsx` | 去掉“主题”行 |

## 〔引擎〕可选补丁（AI 示例文案）

| 文件 | 改什么 |
|---|---|
| `apps/web/app/routes/admin/source-new.tsx` | 占位 “OpenAI 博客” → 游戏示例 |
| `scripts/mcp-check.ts` | 查询词 “OpenAI” → 种子游戏名 |
| `packages/backend/src/publication/llms.ts`（约第 124 行） | “各公司与${field}” → 按 `company` 组的显示名拼 |
| `packages/backend/src/publication/agent.ts`（约第 285 行） | “某家公司、产品、模型” → “某款游戏、厂商、话题” |

## 不改（已核实）

- 模型榜、Codex 监控：上游 4.0.0（1ca5d6d，fork 已包含）已删掉页面、接口、MCP 工具和 `features.ts`，迁移 0053 删表。引擎里只剩 `docs/deploy.md` 的升级说明
- `apps/web/app/features/agent/panels.tsx` 里的 “Codex” 指 Codex CLI 客户端的 MCP 接入方法，跟 AI 行业无关，保留
- RSS 标题（`packages/backend/src/publication/feeds.ts`）、llms.txt 标题、MCP 工具名都从 `SITE` 读，改 `site.ts` 就会跟着变
- 数据库迁移、`docker-compose.yml`、`Dockerfile`、`.env.example`

## 〔测试〕要迁移示例的文件（按文件名排序；共 45 个，实施时以 typecheck 和测试失败为准）

  - `tests/agent-public.test.ts`
  - `tests/analyze-consistency.test.ts`
  - `tests/analyze-kill.test.ts`
  - `tests/analyze-missing-evidence.test.ts`
  - `tests/analyze-shutdown.test.ts`
  - `tests/analyze.test.ts`
  - `tests/category-corrections.test.ts`
  - `tests/content-freshness.test.ts`
  - `tests/content-publication.test.ts`
  - `tests/dajiala.test.ts`
  - `tests/default-model.test.ts`
  - `tests/discovery-scope.test.ts`
  - `tests/embedding-dimensions.test.ts`
  - `tests/events.test.ts`
  - `tests/grouping-reliability.test.ts`
  - `tests/listings.test.ts`
  - `tests/markdown-body.standalone.test.ts`
  - `tests/materials.test.ts`
  - `tests/news-value.test.ts`
  - `tests/outlet-invariants.test.ts`
  - `tests/pool-relevance.test.ts`
  - `tests/processing-recovery.test.ts`
  - `tests/public-cache.test.ts`
  - `tests/publication.test.ts`
  - `tests/reading.test.ts`
  - `tests/recall-pool.test.ts`
  - `tests/receipt-shutdown.test.ts`
  - `tests/receipts.test.ts`
  - `tests/report-candidates.test.ts`
  - `tests/report-lead.standalone.test.ts`
  - `tests/report-outlets.test.ts`
  - `tests/search-sharing.test.ts`
  - `tests/selected-news-gate.test.ts`
  - `tests/signals.test.ts`
  - `tests/sources.standalone.test.ts`
  - `tests/topic-cache-deadline.test.ts`
  - `tests/topic-membership.test.ts`
  - `tests/topics-withdrawal.test.ts`
  - `tests/topics.test.ts`
  - `tests/translate-shutdown.test.ts`
  - `tests/translate.test.ts`
  - `tests/url-identity.standalone.test.ts`
  - `tests/web-render-recovery.standalone.test.ts`
  - `tests/x-fulltext-license.test.ts`
  - `tests/x-original-posts.test.ts`
