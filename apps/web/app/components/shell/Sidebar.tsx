import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router";
import { Wordmark } from "@aihot/site/brand/Logo.tsx";
import { SITE } from "@aihot/site";
import { useChangelogSeen, readRaw, writeRaw, applyTheme, resolvedTheme, setThemePreference, useThemePreference, type ThemePreference } from "../../lib/local-state";
import { sidebar, sidebarIsActive, SIDEBAR_SAVED, SIDEBAR_OTHER, type NavItem } from "./nav";
import { ThemeSwitch } from "./ThemeSwitch";
import { Menu, MenuItem } from "../ui/Menu";
import { IconChevronLeft, IconChevronRight, IconSun, IconMoon, IconMonitor, IconCheck } from "../icons";
import "./sidebar.css";

/** True while the changelog has an entry newer than the one this reader last opened. */
export function useChangelogDot(latestVersion: string | null): boolean {
  const seen = useChangelogSeen();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted && !!latestVersion && (!seen || seen < latestVersion);
}

function SideLink({ item, collapsed, dot }: { item: NavItem; collapsed: boolean; dot: boolean }) {
  const { pathname } = useLocation();
  const active = sidebarIsActive(item, pathname);
  const Icon = item.icon;
  return <Link to={item.to} prefetch="intent" className={`sd-link${active ? " is-current" : ""}`} aria-label={item.label}
    aria-current={active ? "page" : undefined} title={collapsed ? item.label : undefined}>
    <span className="sd-icon"><Icon size={19} /></span>
    <span className="sd-link-label">{item.label}</span>
    {active && <span className="sd-active-dot" aria-hidden="true" />}
    {dot && item.changelog && <span className="sd-unread" aria-label="有新的更新" />}
  </Link>;
}

function RailAppearance() {
  const preference = useThemePreference();
  const icon = preference === "light" ? <IconSun /> : preference === "dark" ? <IconMoon /> : <IconMonitor />;
  return <div className="sd-theme-menu"><Menu trigger={icon} label="切换外观">{close => <>
    {([{ value: "light", label: "浅色", Icon: IconSun }, { value: null, label: "跟随系统", Icon: IconMonitor }, { value: "dark", label: "深色", Icon: IconMoon }] as const).map(({ value, label, Icon }) =>
      <MenuItem key={label} icon={<Icon size={16} />} onSelect={() => { const p: ThemePreference = value; setThemePreference(p); applyTheme(resolvedTheme(p), p === null); close(); }}>
        <span className="flex-1">{label}</span>{preference === value && <IconCheck size={14} />}
      </MenuItem>)}
  </>}</Menu></div>;
}

export function Sidebar({ changelogVersion }: { changelogVersion: string | null }) {
  const [collapsed, setCollapsed] = useState(false);
  const dot = useChangelogDot(changelogVersion);
  useEffect(() => setCollapsed(readRaw("gamehot-sidebar-collapsed", "session") === "true"), []);
  const toggle = () => {
    const next = !collapsed;
    writeRaw("gamehot-sidebar-collapsed", String(next), "session");
    setCollapsed(next);
  };
  return <aside className={`sd-panel${collapsed ? " is-collapsed" : ""}`} aria-label="GameHot 导航面板">
    <Link to="/" className="sd-brand" aria-label={`${SITE.name} 首页`}>
      <img src="/logo-mark.png" width="28" height="36" alt="" />
      <span className="sd-brand-copy"><Wordmark size={23} /><span>游戏情报 · 看见重点</span></span>
    </Link>
    <nav className="sd-navigation" aria-label="主导航">
      <div className="sd-primary">{sidebar().map(group => <section className="sd-group" key={group.title} aria-label={group.title}>
        <h2 className="sd-group-label">{group.title}</h2>
        {group.items.map(item => <SideLink key={item.to} item={item} collapsed={collapsed} dot={dot} />)}
      </section>)}</div>
      <div className="sd-personal"><SideLink item={SIDEBAR_SAVED} collapsed={collapsed} dot={dot} /></div>
      <div className="sd-secondary" aria-label="更多入口">{SIDEBAR_OTHER.map(item => <SideLink key={item.to} item={item} collapsed={collapsed} dot={dot} />)}</div>
    </nav>
    <footer className="sd-footer">
      {!collapsed && <div className="sd-appearance-label">外观</div>}
      <div className="sd-footer-controls">
        {collapsed ? <RailAppearance /> : <ThemeSwitch className="sd-theme-switch" />}
        <button className="sd-collapse" type="button" aria-label={collapsed ? "展开侧边栏" : "收起侧边栏"} title={collapsed ? "展开侧边栏" : "收起侧边栏"} aria-expanded={!collapsed} onClick={toggle}>
          {collapsed ? <IconChevronRight size={18} /> : <IconChevronLeft size={18} />}
        </button>
      </div>
    </footer>
  </aside>;
}
