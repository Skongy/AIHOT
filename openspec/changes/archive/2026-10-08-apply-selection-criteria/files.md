# 要改的文件清单：apply-selection-criteria

图例：〔配置〕= site/、industry/；〔引擎〕= apps/、packages/ 下的补丁。

## 〔配置〕

| 文件 | 改什么 |
|---|---|
| `industry/topics.json` | Steam 四款种子主题 |
| `industry/taxonomy.ts` | 四款游戏实体 + Larian/Mega Crit/Nicalis |
| `industry/sources.json` | 停用手游官源；新增四款 Steam news RSS |
| `industry/prompts/selection-score.md` | 玩/买/等口径、国内相关性、一手出处、行业纳入清单、排除项上限 |
| `industry/prompts/prefilter.md` | （Q3-2）纯广告 BLOCK 一条 |
| `industry/prompts/content-understanding.md` | 传闻标注；推荐理由写玩/买/等 |
| `industry/prompts/summarize-article.md`、`summarize-long-post.md` | 传闻标注 |
| `industry/prompts/structure.md` | 传闻 fact；（Q3-4）`upcoming` 字段 |
| `industry/selection.ts` | 校准后的门槛（用户拍板） |
| `site/site.ts` | `REPORTS.dailyLayout` |

## 〔引擎〕日报结构补丁

| 文件 | 改什么 |
|---|---|
| `packages/backend/src/reports/edition.ts` | `arrangeDaily` 类别配额 |
| `packages/backend/src/reports/compose.ts` | 一句话头条；`watchlist` |
| `packages/backend/src/editorial/analyze.ts` | `StructureSchema.upcoming`（可选） |
| `packages/contracts/src/site.ts` | 日报类型 `watchlist`（可选） |
| `apps/web/app/features/report/ReportPaper.tsx` | 明日关注区块；每条来源名 |

## 〔测试〕

| 文件 | 改什么 |
|---|---|
| `tests/` 日报编排相关测试 | 配额、明日关注用例 |
| `tests/` 提示词渲染测试 | 排除项与传闻规则存在 |
