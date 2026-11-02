/** Anonymous browser analytics; never an assertion about real people or logged-in accounts. */
export const ANALYTICS_MODULES = {
  featured: "资讯精选", all: "全部动态", hot: "热点事件", news: "新闻阅读", daily: "游戏日报",
  editions: "周报 / 月报", radar: "游戏异动", topics: "游戏主题", ask: "AI 问答",
  starred: "我的收藏", agent: "Agent 接入", other: "其他页面",
} as const;
export type AnalyticsModule = keyof typeof ANALYTICS_MODULES;
export function analyticsModule(path: string): AnalyticsModule | null {
  if (path === "/") return "featured";
  if (/^\/all\/?$/.test(path)) return "all";
  if (/^\/(hot\/?$|story\/[^/]+\/?$)/.test(path)) return "hot";
  if (/^\/items\/[^/]+(?:\/original)?\/?$/.test(path)) return "news";
  if (/^\/daily(?:\/[^/]+)?\/?$/.test(path)) return "daily";
  if (/^\/(weekly|monthly)(?:\/[^/]+)?\/?$/.test(path)) return "editions";
  if (/^\/radar\/?$/.test(path)) return "radar";
  if (/^\/topics(?:\/[^/]+(?:\/page\/\d+)?)?\/?$/.test(path)) return "topics";
  if (/^\/ask(?:\/[^/]+)?\/?$/.test(path)) return "ask";
  if (/^\/starred\/?$/.test(path)) return "starred";
  if (/^\/agent\/?$/.test(path)) return "agent";
  return /^\/(about|terms|privacy|changelog|feedback|more)\/?$/.test(path) ? "other" : null;
}
export interface AdminAnalytics {
  days: 7 | 30 | 90; today: string; start: string; generatedAt: string; startedAt: string;
  summary: { dau: number; yesterday: number; wau: number; mau: number; pv: number; newVisitors: number };
  trend: Array<{ date: string; active: number | null; newVisitors: number | null }>;
  modules: Array<{ module: AnalyticsModule; visitors: number; pv: number }>;
  audience: { total: number; newVisitors: number; returning: number };
  sources: Array<{ label: string; visitors: number }>;
  devices: Array<{ label: string; visitors: number }>;
}
