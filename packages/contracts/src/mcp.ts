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
