# Design：steam-topic-pages

## 数据

| slug | steamAppId |
|---|---:|
| binding-of-isaac-rebirth | 250900 |
| slay-the-spire-2 | 2868840 |
| mewgenics | 686060 |
| baldurs-gate-3 | 1086940 |

公开端点：`GET https://store.steampowered.com/api/appdetails?appids={id}&l=schinese&cc=cn`  
经现有 `guardedFetch`（egress）；解析后的只读字段写入 `TopicPage.steam`；失败 / success=false → `steam: null`。

## 展示

- 第 1 页：商店卡（封面、短简介、发售、开发/发行、类型、国区价格、外链）+ 原有精选时间线，标题改为「更新与新闻」
- 第 2 页及以后：仅归档列表（不重复拉商店卡也可带轻量链接）
- 不做成 Admin 仪表盘；不改 DayList 核心行为

## 缓存

按 appId `cachedByKey`，fresh ≈ 1h，stale 可读 6h，避免主题页每次打 Steam。
