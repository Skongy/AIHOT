# Proposal：变更 3 —— 落实精选标准与日报结构（apply-selection-criteria）

> 状态：**已批准实施**（2026-10-08）。产品焦点改为 **Steam 游戏 only**；精选口径更新为「一手出处 / 有新信息 / 国内相关」**三者任一**即可（灵感晚到规则）。
> 本轮只做：OpenSpec 更新、topics/sources/taxonomy 配置、提示词草稿（`/workspace/aihot-plan/prompts-draft/`）。**不**改 live prompts、**不**做日报引擎补丁、**不开 PR**；LLM 校准等 API key。
> 输入：灵感标准 + Steam 四款种子主题；校准样本仍待确认。

## Why

变更 1 只把提示词改成了“游戏占位版”：评分标准还是通用口味，门槛沿用 AIHOT 在 AI 领域的数（T1 60 / T1_5 65 / T2 76），日报是上游的规则编排（头条 + 3 条看点 + 按类别分节 + 快讯）。灵感已经给出本站的判断口径，这一步把它写进提示词和日报结构，并用标注样本校准门槛。

**对玩家的变化**：
- 资讯页的“精选”只留下**会改变你玩不玩、买不买、等不等**的消息：满足「一手出处 / 有新信息 / 国内相关」**任意一条**即可；官方源验证并优先作标题链接。攻略、抽卡建议、软文、无源爆料、搬运、标题党、八卦、折扣、账号交易不再进精选（仍可能出现在“全部”里，除非是纯广告）。
- 有可信出处的传闻会标上“传闻：”，不会被当成已确认的消息。
- “行业”精选只收大版本、新赛季、DLC、国服停服或回归、影响平衡的大改、版号和监管、大厂财报/并购/裁员、首发评分汇总、有分量的深度评论；例行维护、只修 bug 的补丁、单个皮肤或卡池、小厂融资通稿、伪装成评测的营销稿不进精选（单个卡池真的炸了，会通过热点出现）。
- AI 日报改成：一句话头条 → 3 条要闻 → 分类速览（新游 2–4、电竞 2–4、行业 3–5）→ 明日关注；每条都注明来源。（“社区热议 1–2 条”依赖热榜，放在变更 4。）

## What Changes

- **主题与信源（配置，本轮已改）**：`industry/topics.json` 种子主题改为四款 Steam 游戏；停用手游/F2P 官源与 LoL Esports；新增四款 Steam app news RSS。详见 `/workspace/aihot-plan/steam-topics.md`。
- **提示词（配置，本轮仅草稿）** `industry/prompts/`（审阅前不落库）：
  - `selection-score.md`：读者画像加“玩/买/等”判断；`reson` 加国内相关性；`cred` 写明一手出处与无源爆料的上限；“必须正常评价”换成灵感的行业纳入清单；“必须压住”加入灵感的 9 类排除项和行业排除清单。保留五轴、类型权重、安全边界和单字段输出。
  - `prefilter.md`：保持宽召回；只新增“纯账号交易 / 代充 / 外挂 / 礼包码广告判 BLOCK”（Q3-2 决定）。
  - `content-understanding.md`、`summarize-article.md`、`summarize-long-post.md`：传闻标注规则（标题以“传闻：”开头、首句写明爆料来源）；推荐理由优先写对玩/买/等的影响。
  - `structure.md`：传闻的 fact 以爆料方为主体、动作写“爆料/称”，避免和官方确认的事实被归成同一次发生；新增可选字段 `upcoming`（原文明示的未来日期和事项），供“明日关注”使用。
- **门槛（配置）** `industry/selection.ts`：**先不改数字**。用标注样本跑 `scripts/eval-selection.ts` 的门槛扫描后，再按结果改（数字由用户拍板）。
- **校准样本**：`.data/gold.jsonl`（不进 Git），由校准样本扩充到 100–200 条；格式见 `docs/selection.md`。
- **日报结构（引擎补丁）**：
  - `packages/backend/src/reports/edition.ts`：`arrangeDaily` 支持按类别的条数下限/上限（新游 2–4、电竞 2–4、行业 3–5），配额从 `site/site.ts` 新增的 `REPORTS.dailyLayout` 读取。
  - `packages/backend/src/reports/compose.ts`：头条改为一句话（标题 + 摘要首句）；新增 `watchlist`（明日关注）字段：从近 7 天已公开资料中取 `upcoming.date` 为次日（北京时间）的事项。
  - `packages/backend/src/editorial/analyze.ts`：`StructureSchema` 增加可选 `upcoming`（存进 analyses.output 的 JSON，**不需要迁移**）。
  - `apps/web/app/features/report/ReportPaper.tsx`：渲染“明日关注”区块；每条显示来源名。
  - `packages/contracts/src/site.ts`：日报 content 类型加 `watchlist`（可选字段，旧期号兼容）。

**是否需要改引擎**：**需要**，仅日报结构部分（上面 5 处），原因是上游日报是固定的“头条 + 看点 + 分节 + 快讯”编排，没有按类别配额和明日关注的配置项。提示词和门槛部分只改配置。

## Capabilities

### New Capabilities
- `daily-report`：AI 日报的版面结构与每条的来源标注。

### Modified Capabilities
- `content-scope`：读者画像与精选口径改为灵感的“玩/买/等”标准，加入排除项、传闻标注、行业纳入/排除和门槛校准要求。

## Impact

- **配置**：`industry/prompts/{selection-score,prefilter,content-understanding,summarize-article,summarize-long-post,structure}.md`；`industry/selection.ts`（校准后）；`site/site.ts`（`REPORTS.dailyLayout`）
- **引擎补丁**（files.md 单列）：`packages/backend/src/reports/{edition,compose}.ts`、`packages/backend/src/editorial/analyze.ts`（StructureSchema）、`packages/contracts/src/site.ts`（日报类型）、`apps/web/app/features/report/ReportPaper.tsx`
- **测试**：`tests/` 中日报编排测试加配额与明日关注用例；提示词渲染测试确认排除项文本存在
- **数据库**：无迁移
- **成本**：提示词变长约 15%（评分提示词 ~4k → ~4.6k 字符），评分每条多约 0.4k token；校准一次 200 条约 1–3 元（DeepSeek，估算）
- **提示词版本**：版本号是内容哈希，改完后新资料按新标准判断，旧资料不重算

## Out of Scope

- 热点门槛、热榜匹配、日报“社区热议”：变更 4
- 新增信源：变更 2
- 页面视觉重做：前端设计变更
- 不改五轴结构、类型权重表、安全边界
- 不改周报、月报结构

## 需要用户决定的问题

见 design.md「待决定」：Q3-1 校准样本的预标注是否认可、谁来标 100–200 条；Q3-2 账号交易/代充广告是否在预筛直接 BLOCK（从全部动态里也消失）；Q3-3 传闻是否只用标题前缀，还是再加一个“传闻”标签；Q3-4 明日关注本变更就做，还是拆成单独变更；Q3-5 日报结构这部分要不要拆成独立变更（一个变更只做一件事）；Q3-6 门槛的验收线（查准率/查全率）。
