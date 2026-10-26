// Shared display metadata only: safe for browser imports, no backend or database dependencies.
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
