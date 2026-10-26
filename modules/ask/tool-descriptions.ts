// Shared display metadata only: safe for browser imports, no backend or database dependencies.
import type { ToolDescriptionTranslations } from "@aihot/contracts/mcp";
export const ASK_TOOL_DESCRIPTIONS = {
  get_latest: "按精确时间范围查近期资讯；默认精选、过去24小时。window 仅允许 1h/24h/7d/30d/all；超过30天用 all 或 from/until。支持自定义日期及游标翻页。不用于具名游戏搜索。",
  search: "按游戏或关键词查全部站内公开报道，自动匹配中英文别名。q 使用游戏名，可附空格分隔的关键词；只有明确要求精选时才传 mode=selected。默认近7天。window 仅允许 1h/24h/7d/30d/all；超过30天用 all 或 from/until。支持日期及翻页。",
  get_hot_topics: "查当前热点榜（多信源同时讨论的事件）。",
  get_story: "查事件的来龙去脉与报道时间线；public_id 来自用户站内链接、历史出处或工具返回。",
  explain_selection: "解释某条目为何入选精选（评分与门槛说明）。",
  explain_hot: "解释某事件为何上热点榜。",
  get_daily: "查本站游戏日报成品。省略 date 取最新一期；今天须指定北京时间日期。不要用滚动资讯列表冒充日报。",
  get_article: "读取公开资讯与按关键词选择的正文段落、正文状态和关联事件；正文不完整时明确说明，不能补写全文。",
  search_events: "按游戏或关键词找公开关联事件，返回可供 get_story/get_attention_trend 使用的真实 public_id；不依赖当前热榜。最多31天，默认7天。",
  get_news_stats: "按游戏关键词精确统计本站报道、去重事实、独立来源、官方报道数。对比游戏时各调用一次且使用相同日期；不使用搜索前几条当总量。最多31天，默认7天。",
  get_attention_trend: "读取公开事件的小时关注指数，首个非零完整点=100，缺测为null，不返回内部热度分数。必须使用已有public_id，最多31天，默认24h。不代表全网热度或玩家人数，不足两个观测点不能判断走势。",
} as const;

export const ASK_PUBLIC_TOOL_DESCRIPTIONS: Readonly<Record<string, string>> = {
  ...ASK_TOOL_DESCRIPTIONS,
  search_news: ASK_TOOL_DESCRIPTIONS.search,
  explain_selection: "Explain why a public GAMEHOT article was selected or met the selection threshold. Use article_id from get_latest/search or a verified /items/ link. Do not guess ids. Distinguishes metThreshold from selected; axes may be null.",
  explain_hot: "Explain why a public GAMEHOT story is on the hot ranking (or not). Use public_id from get_hot_topics/get_story. Distinguishes ranking snapshot time from stats-as-of; does not return internal heat scores.",
};

/** Keep the original MCP text in its language; supply the other language for display only. */
export const ASK_PUBLIC_TOOL_DESCRIPTION_TRANSLATIONS: Readonly<Record<string, ToolDescriptionTranslations>> = {
  get_article: {
    zh: ASK_PUBLIC_TOOL_DESCRIPTIONS.get_article!,
    en: "Read a public article, keyword-selected body passages, body availability/completeness, and its related event. State when the body is incomplete; do not invent missing full-text details.",
  },
  search_news: {
    zh: ASK_PUBLIC_TOOL_DESCRIPTIONS.search_news!,
    en: "Search all public in-site reports by game or keyword, automatically matching Chinese and English aliases. Use the game name in q, optionally followed by space-separated keywords; set mode=selected only when editorial picks are explicitly requested. Defaults to the past 7 days. window accepts only 1h/24h/7d/30d/all; use all or from/until for more than 30 days. Supports custom dates and cursor pagination.",
  },
  search_events: {
    zh: ASK_PUBLIC_TOOL_DESCRIPTIONS.search_events!,
    en: "Find related public events by game or keyword and return real public_id values for get_story/get_attention_trend. Does not depend on the current hot ranking. Maximum range: 31 days; default: 7 days.",
  },
  get_news_stats: {
    zh: ASK_PUBLIC_TOOL_DESCRIPTIONS.get_news_stats!,
    en: "Calculate exact in-site counts of reports, deduplicated facts, independent sources, and official reports by game keyword. For game comparisons, call once per game using identical dates; never treat a few search results as totals. Maximum range: 31 days; default: 7 days.",
  },
  get_attention_trend: {
    zh: ASK_PUBLIC_TOOL_DESCRIPTIONS.get_attention_trend!,
    en: "Read the hourly attention index of a public event. The first nonzero complete observation is normalized to 100; missing observations remain null. Does not expose internal heat scores. Requires an existing public_id. Maximum range: 31 days; default: 24 hours. Does not represent internet-wide popularity or player counts; fewer than two observations cannot establish a trend.",
  },
  explain_selection: {
    zh: "解释一篇公开 GAMEHOT 资讯为何入选精选或达到评分门槛。article_id 须来自 get_latest/search 的返回结果或经过验证的 /items/ 链接，不得猜测ID。明确区分 metThreshold（达到门槛）和 selected（实际入选）；各评分维度 axes 可能为空。",
    en: ASK_PUBLIC_TOOL_DESCRIPTIONS.explain_selection!,
  },
  explain_hot: {
    zh: "解释一个公开 GAMEHOT 事件为何在热点榜上，或为何当前未上榜。public_id 须来自 get_hot_topics/get_story。明确区分榜单快照时间与统计截止时间，不返回内部热度分数。",
    en: ASK_PUBLIC_TOOL_DESCRIPTIONS.explain_hot!,
  },
};
