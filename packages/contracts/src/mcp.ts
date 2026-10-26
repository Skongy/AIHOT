// The MCP tool names, from the site's prefix (site/site.ts): llms.txt, the agent page and the server
// list the same names. One tool per ability of /api/v1/agent; a module's tools follow the engine's.
import { SITE } from "@aihot/site";

/** A tool's full name: the site's prefix, then what it does ("get_latest"). */
export const mcpToolName = (tool: string): string => `${SITE.mcpPrefix}_${tool}`;

export const MCP_TOOL_NAMES = {
  latest: mcpToolName("get_latest"),
  search: mcpToolName("search"),
  hot: mcpToolName("get_hot_topics"),
  story: mcpToolName("get_story"),
  daily: mcpToolName("get_daily"),
  weekly: mcpToolName("get_weekly"),
  monthly: mcpToolName("get_monthly"),
  /** Module ask: explain_selection (not an engine-registered tool). */
  explainSelection: mcpToolName("explain_selection"),
  /** Module ask: explain_hot (not an engine-registered tool). */
  explainHot: mcpToolName("explain_hot"),
} as const;

/** The engine's tools, in the order the server lists them (module tools are added separately). */
export const MCP_TOOLS = [
  { name: MCP_TOOL_NAMES.latest },
  { name: MCP_TOOL_NAMES.search },
  { name: MCP_TOOL_NAMES.hot },
  { name: MCP_TOOL_NAMES.story },
  { name: MCP_TOOL_NAMES.daily },
  { name: MCP_TOOL_NAMES.weekly },
  { name: MCP_TOOL_NAMES.monthly },
];

/** The exact descriptions sent to MCP clients, also displayed by the Agent page. */
export const MCP_TOOL_DESCRIPTIONS: Readonly<Record<string, string>> = {
  [MCP_TOOL_NAMES.latest]: `Get the latest ${SITE.name} items for a 24-hour or 7-day briefing. Prefer selected mode unless the user explicitly asks for every public item. Do not use this for named-topic search or multi-source event context.`,
  [MCP_TOOL_NAMES.search]: `Search ${SITE.name}'s latest 7 days by a 2–200 character topic, company, model, product, or person. It searches editorial picks first and automatically expands to all public items only when picks have no result.`,
  [MCP_TOOL_NAMES.hot]: `Get the current ${SITE.name} Top 10 with each event's one-based rank. Use this for 'what is hot now' and to discover valid story public IDs; use ${MCP_TOOL_NAMES.latest} for a chronological news list. Internal heat scores are not returned.`,
  [MCP_TOOL_NAMES.story]: `Get the evolving timeline, latest development, AI digest, and related events for one public story. Only pass a public_id obtained from ${MCP_TOOL_NAMES.hot} links.story; never invent or infer IDs.`,
  [MCP_TOOL_NAMES.daily]: `Get ${SITE.name}'s edited daily overview, either the latest issue or a real YYYY-MM-DD date. Use this when the user asks for a daily report rather than a raw chronological list.`,
  [MCP_TOOL_NAMES.weekly]: `Get ${SITE.name}'s edited weekly report: the week's most important events chosen from its dailies, grouped by section, with an overview. Use this for what happened this week or in a given ISO week; omit week for the latest.`,
  [MCP_TOOL_NAMES.monthly]: `Get ${SITE.name}'s edited monthly report: the month's most important events chosen from its dailies, grouped by section, with an overview. Use this for what happened this month or in a given month; omit month for the latest.`,
};

export interface ToolDescriptionTranslations { zh: string; en: string }

/** Display translations; the English text remains the exact MCP description above. */
export const MCP_TOOL_DESCRIPTION_TRANSLATIONS: Readonly<Record<string, ToolDescriptionTranslations>> = {
  [MCP_TOOL_NAMES.latest]: { zh: `获取 ${SITE.name} 最近24小时或7天的资讯简报。优先使用精选模式，只有用户明确要求全部公开资讯时才查询全部。不用于指定主题搜索或多信源事件背景查询。`, en: MCP_TOOL_DESCRIPTIONS[MCP_TOOL_NAMES.latest]! },
  [MCP_TOOL_NAMES.search]: { zh: `在 ${SITE.name} 最近7天的资讯中，按2–200个字符的主题、公司、模型、产品或人物搜索。优先搜索精选；只有精选无结果时，才自动扩展到全部公开资讯。`, en: MCP_TOOL_DESCRIPTIONS[MCP_TOOL_NAMES.search]! },
  [MCP_TOOL_NAMES.hot]: { zh: `获取 ${SITE.name} 当前热点榜前10名，包含从1开始的事件排名。用于回答“现在什么最热”并发现有效的事件公开ID；按时间查看新闻列表应使用 ${MCP_TOOL_NAMES.latest}。不返回内部热度分数。`, en: MCP_TOOL_DESCRIPTIONS[MCP_TOOL_NAMES.hot]! },
  [MCP_TOOL_NAMES.story]: { zh: `读取一个公开事件的持续更新时间线、最新进展、AI综述和关联事件。public_id 只能取自 ${MCP_TOOL_NAMES.hot} 返回的 links.story，不得编造或推测ID。`, en: MCP_TOOL_DESCRIPTIONS[MCP_TOOL_NAMES.story]! },
  [MCP_TOOL_NAMES.daily]: { zh: `读取 ${SITE.name} 已编排的游戏日报，可查询最新一期或指定真实日期（YYYY-MM-DD）。适合用户明确要求日报的场景，不用原始的按时间新闻列表代替日报。`, en: MCP_TOOL_DESCRIPTIONS[MCP_TOOL_NAMES.daily]! },
  [MCP_TOOL_NAMES.weekly]: { zh: `读取 ${SITE.name} 已编排的游戏周报：从各期日报中选取一周最重要的事件，按板块组织并提供概览。用于了解本周或指定ISO周的动态；省略 week 时返回最新一期。`, en: MCP_TOOL_DESCRIPTIONS[MCP_TOOL_NAMES.weekly]! },
  [MCP_TOOL_NAMES.monthly]: { zh: `读取 ${SITE.name} 已编排的游戏月报：从各期日报中选取当月最重要的事件，按板块组织并提供概览。用于了解本月或指定月份的动态；省略 month 时返回最新一期。`, en: MCP_TOOL_DESCRIPTIONS[MCP_TOOL_NAMES.monthly]! },
};
