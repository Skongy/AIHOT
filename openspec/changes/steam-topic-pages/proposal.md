# Proposal：Steam 种子主题深页（steam-topic-pages）

> 状态：实施中。四款种子游戏主题页展示 Steam 商店元数据（无需 API key）与收录新闻时间线。不改 `industry/selection.ts`。

## Why

四款 Steam 种子游戏已有主题页与新闻 RSS，但页面仍是通用精选列表，缺少商店页元数据（封面、发售、价格、开发商）与「更新/新闻」深页感知。读者打开主题时期望先看到这款游戏是什么、再刷时间线。

## What Changes

- `topics.json` 为四款种子主题写入 `steamAppId`
- 通过公开 `store.steampowered.com/api/appdetails`（无需 key）拉取并缓存商店元数据
- `TopicPage` 增加可选 `steam` 面板；主题页 SSR 渲染商店卡 + 更新/新闻时间线（沿用已收录条目）
- OpenSpec + standalone 单测；中文 PR

## Capabilities

### New Capabilities
- `steam-topic-pages`：Steam 种子主题深页（商店元数据 + 收录时间线）

### Modified Capabilities
- （无主规格门槛/热榜改写）

## Impact

- `industry/topics.json`、`publication/topics.ts`、`publication/steam.ts`（新）
- `contracts/site.ts`、`apps/web` 主题路由与组件
- **不改** `industry/selection.ts`；不接 WebAPI key / 私有 Steam API

## Out of Scope

- 改精选门槛或评分提示词
- Steam 成就/玩家数实时轮询、用户库同步
- 非种子主题的通用 Steam 绑定

## 需要用户决定的问题

- 无（默认：仅四款种子；元数据缓存约 1 小时；拉取失败时主题页仍可用，仅无商店卡）
