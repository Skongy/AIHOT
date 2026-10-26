import { ASK_PUBLIC_TOOL_DESCRIPTIONS, ASK_PUBLIC_TOOL_DESCRIPTION_TRANSLATIONS } from "../tool-descriptions.ts";
import type { AgentPart } from "@aihot/web/modules";
import { mcpToolName, MCP_TOOL_NAMES } from "@aihot/contracts/mcp";

const part: AgentPart = {
  tools: [
    { name: mcpToolName("get_article"), does: "按关键词阅读公开正文段落，标明缺失与不完整", ask: "公告里具体改了哪些内容？" },
    { name: mcpToolName("search_news"), does: "按游戏、日期、官方或指定信源检索公开资讯", ask: "只看原神官方最近一周的公告。" },
    { name: mcpToolName("search_events"), does: "按游戏查关联事件，不限于当前热榜", ask: "CS2 最近有哪些值得跟进的事件？" },
    { name: mcpToolName("get_news_stats"), does: "统计站内报道、去重事实及独立来源；非全网热度", ask: "比较近一周 CS2 和三角洲的站内报道量。" },
    { name: mcpToolName("get_attention_trend"), does: "读取事件小时关注指数，保留缺测点", ask: "这个事件最近一天的关注度怎样变化？" },
    { name: MCP_TOOL_NAMES.explainSelection, does: "解释资讯为何入选／达门槛", ask: "这篇为什么进精选？" },
    { name: MCP_TOOL_NAMES.explainHot, does: "解释事件为何上榜及排名快照", ask: "这个热点为什么排第 N？" },
  ].map(tool => ({ ...tool, description: ASK_PUBLIC_TOOL_DESCRIPTIONS[tool.name.slice(mcpToolName("").length)],
    descriptionTranslations: ASK_PUBLIC_TOOL_DESCRIPTION_TRANSLATIONS[tool.name.slice(mcpToolName("").length)] })),
  api: {
    group: "研究与解释",
    rows: [
      ["/api/v1/agent/article", "阅读正文段落", "article_id, question"],
      ["/api/v1/agent/search-news", "筛选资讯", "q, from, until, firstParty, source"],
      ["/api/v1/agent/search-events", "查关联事件", "q, from, until"],
      ["/api/v1/agent/news-stats", "站内资讯统计", "q, from, until"],
      ["/api/v1/agent/attention-trend", "事件关注趋势", "public_id, from, until"],
      ["/api/v1/agent/explain-selection", "资讯入选解释", "article_id"],
      ["/api/v1/agent/explain-hot", "事件上榜解释", "public_id"],
    ],
  },
  resources: [
    ["AI 问答", "/ask", "站内十一工具流式问答，支持历史查询与文章上下文"],
  ],
};

export default part;
