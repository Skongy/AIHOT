// Moving between reports: the archive column on desktop; on phones the kind switch in the bar
// (ReportLayout) and recent-issue chips under it.
import { IntentLink } from "../../components/ui/IntentLink";
import { useEffect, useId, useState } from "react";
import type { ReportNavigationEntry, ReportNavigationResponse, ReportKind } from "@aihot/contracts/site";
import { PillTabs } from "../../components/ui/Tabs";
import { IconChevronLeft, IconChevronRight, IconList } from "../../components/icons";
import { KINDS, KIND_LABEL, KIND_PATH, archiveGroups, archiveMark, chipLabel, reportPath } from "./format";

/** 日报 / 周报 / 月报 as the site's pill switch: spread across the archive column, or compact in the phone bar (opening at the top). */
export function KindSwitch({ kind, phone = false }: { kind: ReportKind; phone?: boolean }) {
  return (
    <PillTabs
      fill={!phone}
      size={phone ? "sm" : "md"}
      layoutId={phone ? "report-kind-phone" : "report-kind"}
      label="切换日报、周报、月报"
      active={kind}
      items={KINDS.map((k) => ({ key: k, label: KIND_LABEL[k], to: KIND_PATH[k], resetScroll: phone, prefetch: 'intent' }))}
    />
  );
}

/** Desktop archive column: every issue of this kind, grouped, the current one highlighted. */
export function ReportArchive({ kind, index, current }: { kind: ReportKind; index: ReportNavigationEntry[]; current: string | null }) {
  const [collapsed, setCollapsed] = useState(false);
  const archiveId = useId();
  const groups = archiveGroups(kind, index);
  const openId = groups.find((g) => g.entries.some((e) => e.key === current))?.id ?? groups[0]?.id;
  return (
    <aside aria-label="往期列表面板" className={`sticky top-0 hidden h-dvh shrink-0 flex-col overflow-hidden border-r border-line bg-[color-mix(in_srgb,var(--sidebar)_50%,var(--surface))] pt-6 transition-[width,padding] duration-200 ease-out motion-reduce:transition-none lg:flex dark:bg-[color-mix(in_srgb,var(--sidebar)_50%,var(--bg))] ${collapsed ? "w-[52px] px-2" : "w-[280px] pl-5 pr-3"}`}>
      <div className="mb-2 flex h-8 shrink-0 items-center justify-between">
        {!collapsed && <span className="pl-1 text-[11.5px] font-semibold tracking-[0.3em] text-ink">往期</span>}
        <button
          type="button"
          aria-label={collapsed ? "展开往期列表" : "收起往期列表"}
          aria-expanded={!collapsed}
          aria-controls={archiveId}
          title={collapsed ? "展开往期列表" : "收起往期列表"}
          onClick={() => setCollapsed((value) => !value)}
          className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-line bg-surface text-ink-3 shadow-sm transition-colors hover:border-line-strong hover:bg-bg-sunk hover:text-ink"
        >
          {collapsed ? <IconList size={17} /> : <IconChevronLeft size={17} />}
        </button>
      </div>
      <div id={archiveId} hidden={collapsed} className={`min-h-0 flex-1 flex-col ${collapsed ? "" : "flex"}`}>
        <div className="border-b border-line-strong pb-4">
          <KindSwitch kind={kind} />
        </div>
        <nav aria-label={`${KIND_LABEL[kind]}历史`} className="scrollbar-thin -mr-3 flex-1 overflow-y-auto pb-6 pr-3">
          {groups.map((g) => (
            <ArchiveGroup key={g.id} g={g} kind={kind} current={current} initiallyOpen={g.id === openId} />
          ))}
        </nav>
        {kind === "daily" && (
          <IntentLink to="/daily/archive" className="flex h-12 shrink-0 items-center justify-between border-t border-line pl-1 pr-1.5 text-[12.5px] font-medium text-ink-2 transition-colors hover:text-accent">
            日报合订本 <IconChevronRight size={14} />
          </IntentLink>
        )}
      </div>
    </aside>
  );
}

/** Closed daily months keep only keys; titles load when opened, and the full archive is SSR. */
function ArchiveGroup({ g, kind, current, initiallyOpen }: {
  g: ReturnType<typeof archiveGroups>[number]; kind: ReportKind; current: string | null; initiallyOpen: boolean;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  useEffect(() => setOpen(initiallyOpen), [initiallyOpen]);
  const [loaded, setLoaded] = useState<ReportNavigationEntry[] | null>(null);
  useEffect(() => {
    if (!open || loaded || kind !== "daily" || !g.entries.some((e) => e.title === undefined)) return;
    const controller = new AbortController();
    fetch(`/api/site/reports/daily/months/${g.id}`, { signal: controller.signal })
      .then((r) => r.ok ? r.json() : null)
      .then((data: ReportNavigationResponse | null) => { if (data && !controller.signal.aborted) setLoaded(data.items); })
      .catch(() => {});
    return () => controller.abort();
  }, [open, kind, g.id, loaded]);
  const entries = loaded ?? g.entries;
  const mark = (key: string) => archiveMark(kind, key);
  return (
    <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)} className="disclosure group/month border-b border-line">
      <summary className="flex h-11 items-center gap-1.5 pl-1 pr-1.5 text-[13px] text-ink transition-colors hover:text-accent">
        <IconChevronRight size={14} className="text-ink-4 transition-transform duration-200 group-open/month:rotate-90" />
        <span className="flex-1 font-semibold">{g.label}</span>
        <span className="num text-[11.5px] text-ink-4">{g.entries.length}</span>
      </summary>
      {(kind !== "daily" || open) && <ul className="space-y-0.5 pb-3">
        {entries.map((e) => {
          const on = e.key === current;
          return (
            <li key={e.key}>
              <IntentLink
                to={reportPath(kind, e.key)}
                aria-current={on ? "page" : undefined}
                title={e.title ?? undefined}

                className={`group flex gap-3 rounded-tile py-2.5 pl-2.5 pr-2 transition-colors ${on ? "bg-accent-soft" : "hover:bg-bg-sunk"}`}
              >
                <span className="flex w-8 shrink-0 flex-col items-center">
                  <span className={`num text-[19px] font-black leading-none tracking-[-0.03em] ${on ? "text-accent" : "text-ink"}`}>{mark(e.key).big}</span>
                  {mark(e.key).small && <span className="mt-1 whitespace-nowrap text-[10px] leading-none text-ink-4">{mark(e.key).small}</span>}
                </span>
                <span className={`line-clamp-2 min-w-0 text-[12.5px] leading-[18px] transition-colors ${on ? "font-semibold text-ink" : "text-ink-2 group-hover:text-ink"}`}>{e.title ?? `${KIND_LABEL[kind]} ${e.key}`}</span>
              </IntentLink>
            </li>
          );
        })}
      </ul>}
      {kind === "daily" && !open && <noscript><a href="/daily/archive">查看完整日报归档</a></noscript>}
    </details>
  );
}

/** Phones, under the bar: the three latest issues and a way further back. */
export function ReportPhoneNav({ kind, index, current, today }: { kind: ReportKind; index: ReportNavigationEntry[]; current: string | null; today: string }) {
  const recent = index.slice(0, 3);
  const earlier = kind === "daily" ? "/daily/archive" : "#report-history";
  const chip = "inline-flex h-11 shrink-0 items-center rounded-full border px-4 text-[13px] transition-colors";
  if (recent.length === 0) return null;
  return (
    <nav aria-label={`最近的${KIND_LABEL[kind]}`} className="scrollbar-none bleed flex gap-2 overflow-x-auto pb-1 pt-1.5 lg:hidden">
      {recent.map((e) => {
        const on = e.key === current;
        return (
          <IntentLink key={e.key} to={reportPath(kind, e.key)} aria-current={on ? "page" : undefined} className={`${chip} ${on ? "border-ink bg-ink font-semibold text-bg" : "border-line-strong bg-surface text-ink-2 active:bg-bg-sunk"}`}>
            {chipLabel(kind, e.key, index, today)}
          </IntentLink>
        );
      })}
      {index.length > 3 && (
        <IntentLink to={earlier} viewTransition={kind === "daily"} className={`${chip} border-line-strong bg-surface text-ink-2 active:bg-bg-sunk`}>
          更早
        </IntentLink>
      )}
    </nav>
  );
}
