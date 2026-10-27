// Site navigation in one place: the desktop sidebar's sections and the phone tab bar's tabs, the engine's
// and the site's modules'.
import type { ReactNode } from "react";
import { webModules } from "../../site-modules";
import {
  IconBolt, IconBookmark, IconDoc, IconFlame, IconGrid, IconInfo, IconHistory, IconList, IconPlug, IconUser,
} from "../icons";

export interface NavItem {
  to: string;
  label: string;
  icon: (p: { size?: number }) => ReactNode;
  /** Match the path exactly (the home page). */
  end?: boolean;
  /** Shows the unread dot while the changelog has news. */
  changelog?: boolean;
}

const SECTIONS: Array<{ title: string; items: NavItem[] }> = [
  {
    title: "资讯",
    items: [
      { to: "/", label: "精选", icon: IconBolt, end: true },
      { to: "/all", label: "全部动态", icon: IconList, end: true },
      { to: "/hot", label: "热点事件", icon: IconFlame },
      { to: "/daily", label: "游戏日报", icon: IconDoc },
    ],
  },
  {
    title: "探索", items: [],
  },
  { title: "助手", items: [] },
];

export const SIDEBAR_SAVED: NavItem = { to: "/starred", label: "我的收藏", icon: IconBookmark };
export const SIDEBAR_OTHER: NavItem[] = [
  { to: "/agent", label: "Agent 接入", icon: IconPlug },
  { to: "/about", label: "关于", icon: IconInfo },
  { to: "/changelog", label: "更新日志", icon: IconHistory, changelog: true },
];

/** Enabled modules join their group; the topic index follows game discovery. */
export function sidebar(): Array<{ title: string; items: NavItem[] }> {
  const sections = SECTIONS.map((s) => ({ ...s, items: [...s.items] }));
  for (const m of webModules()) {
    if (!m.sidebar) continue;
    const section = sections.find((s) => s.title === m.sidebar!.section);
    if (section) {
      section.items.push(...m.sidebar.items);
    } else {
      sections.push({ title: m.sidebar.section, items: [...m.sidebar.items] });
    }
  }
  sections.find((s) => s.title === "探索")!.items.push({ to: "/topics", label: "游戏主题", icon: IconGrid });
  return sections;
}

/** A sidebar entry is lit on its pages; 日报 also covers weekly and monthly reports. 精选 (/) and 全部动态 (/all) each light only themselves. */
export function sidebarIsActive(item: NavItem, pathname: string): boolean {
  if (item.end) return pathname === item.to;
  if (item.to === "/daily") return /^\/(daily|weekly|monthly)(\/|$)/.test(pathname);
  return pathname === item.to || pathname.startsWith(`${item.to}/`);
}

/**
 * The phone tab bar: 精选 (with 全部 beside it as a ScopeTabs switch in FeedBar), 热点, 日报 and 主题 are tabs, and "我的"
 * at /more holds 收藏, 外观, the tools and the site's own pages. Which tab a page sits under is declared by the page
 * itself (components/shell/screens.ts).
 */
export type TabKey =
  | "featured"
  | "hot"
  | "daily"
  | "topics"
  | "me"
  // A module's tab.
  | (string & {});

export interface Tab {
  key: TabKey;
  to: string;
  label: string;
  icon: (p: { size?: number }) => ReactNode;
  changelog?: boolean;
}

const ENGINE_TABS: Tab[] = [
  { key: "featured", to: "/", label: "精选", icon: IconBolt },
  { key: "hot", to: "/hot", label: "热点", icon: IconFlame },
  { key: "daily", to: "/daily", label: "日报", icon: IconDoc },
  { key: "topics", to: "/topics", label: "主题", icon: IconGrid },
  { key: "me", to: "/more", label: "我的", icon: IconUser, changelog: true },
];

/** The tab bar: the engine's, the modules' before 我的. */
export function tabs(): Tab[] {
  return [...ENGINE_TABS.slice(0, -1), ...webModules().flatMap((m) => m.tabs ?? []), ENGINE_TABS.at(-1)!];
}
