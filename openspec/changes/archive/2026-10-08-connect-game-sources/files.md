# 要改的文件清单：connect-game-sources

基准：main @ `e0bf26a`（变更 1 归档后）。图例：〔配置〕= site/、industry/；〔测试〕= tests/；〔文档〕= openspec/；本变更**无引擎补丁**。

## 〔配置〕

| 文件 | 改什么 |
|---|---|
| `industry/sources.json` | 写入媒体 16 + 官方 15 个源（含过滤、标题规则、回填、分级、owner） |
| `industry/prompts/rules-domain.md` | 加第 6 条：繁体和外文输出简体中文 |

## 〔测试〕

| 文件 | 改什么 |
|---|---|
| `tests/game-sources.standalone.test.ts` | 新增：名单、配置合法性、标题规则、噪声过滤、快照解析、文章页补日期 |
| `tests/fixtures/game-sources/*` | 新增：31 个列表页 + 5 个文章页删减快照 |

## 〔文档〕

| 文件 | 改什么 |
|---|---|
| `openspec/changes/connect-game-sources/*` | 本变更提案（含官方名单和标题规则） |

## 〔引擎〕

无。暂缓源见 proposal「Out of Scope / 暂缓」。
