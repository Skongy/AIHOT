import { useEffect, useRef, useState } from "react";
import { Link, useNavigation, useRevalidator, useSearchParams, useRouteError } from "react-router";
import { SITE } from "@aihot/site";
import { addDays, beijingDate } from "@aihot/contracts/time";
import { ANALYTICS_MODULES, type AdminAnalytics } from "@aihot/contracts/analytics";
import type { Route } from "./+types/analytics";
import { adminGet } from "../../lib/admin.server";
import { AdminPage, Button, Card, Empty } from "../../features/admin/ui";
import { observedRuns, type Pt } from "../../features/hot/curve";

export async function loader({ request }: Route.LoaderArgs) {
  const days = new URL(request.url).searchParams.get("days") ?? "30";
  return adminGet<AdminAnalytics>(request, `/api/admin/analytics?days=${encodeURIComponent(days)}`);
}
export const meta: Route.MetaFunction = () => [{ title: `用户活跃分析 · ${SITE.name} 后台` }];
const fmt = (n: number) => n.toLocaleString("zh-CN");
const percent = (n: number, total: number) => total ? `${(n / total * 100).toFixed(1)}%` : "0.0%";
const dayLabel = (day: string) => day.slice(5).replace("-", "/");

/** Uses the existing heat chart's missing-observation grouping. No interpolation of uncollected days. */
function Trend({ rows }: { rows: AdminAnalytics["trend"] }) {
  const [selected, setSelected] = useState<number | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const [w, setWidth] = useState(760);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => { if (entry) setWidth(Math.max(240, entry.contentRect.width)); });
    if (container.current) observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  const h = 210, left = 56, right = 14, top = 12, bottom = 28;
  const max = Math.max(1, ...rows.flatMap(r => [r.active ?? 0, r.newVisitors ?? 0]));
  const step = Math.max(1, Math.ceil(max / 4)), limit = step * 4;
  const x = (i: number) => left + i / Math.max(1, rows.length - 1) * (w - left - right);
  const y = (v: number) => h - bottom - v / limit * (h - top - bottom);
  const series = [{ key: "active" as const, label: "活跃访客", color: "var(--accent)" }, { key: "newVisitors" as const, label: "新增访客", color: "var(--ink-3)" }];
  const ticks = [...new Set([0, Math.round((rows.length - 1) / 3), Math.round((rows.length - 1) * 2 / 3), rows.length - 1])];
  const current = selected === null ? null : rows[selected];
  return <div ref={container}>
    <div className="mb-2 flex flex-wrap gap-4 text-[12px] text-ink-3">{series.map(s => <span key={s.key} className="flex items-center gap-2"><i className="block h-0.5 w-4" style={{ background: s.color }}/>{s.label}</span>)}</div>
    <svg className="block h-[210px] w-full outline-offset-2" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label="每日活跃与新增访客趋势；方向键逐日查看" tabIndex={0}
      onPointerMove={event => { const point = event.currentTarget.createSVGPoint(); point.x = event.clientX; point.y = event.clientY; const matrix = event.currentTarget.getScreenCTM(); if (!matrix) return; const pos = point.matrixTransform(matrix.inverse()); setSelected(Math.max(0, Math.min(rows.length - 1, Math.round((pos.x - left) / (w - left - right) * (rows.length - 1))))); }}
      onPointerLeave={() => setSelected(null)}
      onKeyDown={event => { if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return; event.preventDefault(); setSelected(event.key === "Home" ? 0 : event.key === "End" ? rows.length - 1 : Math.max(0, Math.min(rows.length - 1, (selected ?? rows.length - 1) + (event.key === "ArrowLeft" ? -1 : 1)))); }}>
      {[0, 1, 2, 3, 4].map(i => <g key={i}><line x1={left} x2={w - right} y1={y(step * i)} y2={y(step * i)} stroke="var(--line)"/><text x={left - 8} y={y(step * i) + 4} textAnchor="end" fontSize="11" fill="var(--ink-3)">{fmt(step * i)}</text></g>)}
      {ticks.map(i => <text key={i} x={x(i)} y={h - 5} textAnchor={i === 0 ? "start" : i === rows.length - 1 ? "end" : "middle"} fontSize="11" fill="var(--ink-3)">{dayLabel(rows[i]!.date)}</text>)}
      {series.map(s => observedRuns(rows.map(r => r[s.key])).map((run, n) => { const pts: Pt[] = run.map(i => [x(i), y(rows[i]![s.key]!)]); return pts.length === 1 ? <circle key={`${s.key}-${n}`} cx={pts[0]![0]} cy={pts[0]![1]} r={3} fill={s.color}/> : <polyline key={`${s.key}-${n}`} points={pts.map(p => p.join(",")).join(" ")} fill="none" stroke={s.color} strokeWidth={2} vectorEffect="non-scaling-stroke"/>; }))}
      {selected !== null && <line x1={x(selected)} x2={x(selected)} y1={top} y2={h - bottom} stroke="var(--ink-3)" strokeDasharray="3 4"/>}
    </svg>
    <p className="mt-2 min-h-5 text-[12px] text-ink-3" aria-live="polite">{current ? `${current.date} · ${current.active === null ? "尚未采集" : `活跃 ${fmt(current.active)} 人 · 新增 ${fmt(current.newVisitors ?? 0)} 人`}` : "移入、轻点或使用方向键查看每日人数；未采集日期留空。"}</p>
  </div>;
}
function Distribution({ title, rows, total }: { title: string; rows: Array<{ label: string; visitors: number }>; total: number }) {
  return <Card title={title}>{!total ? <Empty>所选范围暂无有效访问</Empty> : <ul className="space-y-3">{rows.map(row => <li key={row.label}>
    <div className="mb-1 flex items-center justify-between gap-3 text-[13px]"><span className="min-w-0 truncate text-ink-2" title={row.label}>{row.label}</span><span className="num shrink-0 text-ink">{fmt(row.visitors)} <span className="ml-2 text-ink-3">{percent(row.visitors, total)}</span></span></div>
    <div className="h-1 overflow-hidden rounded-full bg-bg-sunk"><div className="h-full bg-ink-3" style={{ width: `${total ? row.visitors / total * 100 : 0}%` }}/></div>
  </li>)}</ul>}</Card>;
}
export default function Analytics({ loaderData: data }: Route.ComponentProps) {
  const [params, setParams] = useSearchParams();
  const revalidator = useRevalidator(), navigation = useNavigation();
  const busy = revalidator.state === "loading" || navigation.state === "loading";
  const since = beijingDate(new Date(data.startedAt));
  const stats = [["今日活跃 · DAU", data.summary.dau], ["昨日活跃", addDays(data.today, -1) < since ? null : data.summary.yesterday], ["近 7 天活跃 · WAU", data.summary.wau], ["近 30 天活跃 · MAU", data.summary.mau], ["今日浏览量 · PV", data.summary.pv], ["今日新增访客", data.summary.newVisitors]] as const;
  return <AdminPage title="用户活跃分析" subtitle="了解有多少匿名访客在阅读 GameHot，以及他们关注哪些功能。" actions={<Button busy={busy} onClick={() => revalidator.revalidate()}>刷新数据</Button>}>
    <div aria-busy={busy} className={busy ? "opacity-60 transition-opacity" : "transition-opacity"}>
      <Card pad={false} className="mb-3"><dl className="grid grid-cols-2 divide-x divide-line sm:grid-cols-3 xl:grid-cols-6">{stats.map(([label, value], i) => <div key={label} className="min-w-0 px-4 py-4"><dt className="text-[12px] text-ink-3">{label}</dt><dd className={`num mt-2 font-medium tracking-tight text-ink ${i === 0 ? "text-[30px]" : "text-[25px]"}`}>{value === null ? "—" : fmt(value)}</dd></div>)}</dl></Card>
      <p className="mb-4 text-[12px] text-ink-3">统计自 {since} 起；此前未采集的日期留空。近 7 / 30 天指标在覆盖不足时仅含已记录部分。</p>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div className="text-[13px] text-ink-3">{data.start} — {data.today}<span className="ml-2">· 北京时间</span></div><div className="flex gap-1" aria-label="分析时间范围">{([7, 30, 90] as const).map(days => <Button key={days} size="sm" tone={data.days === days ? "primary" : "ghost"} aria-pressed={data.days === days} onClick={() => { const next = new URLSearchParams(params); next.set("days", String(days)); setParams(next); }}>近 {days} 天</Button>)}</div></div>
      {busy && <p className="mb-2 text-[12px] text-ink-3" role="status">正在读取最新统计…</p>}
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card title="活跃趋势" right={<span className="text-[12px] text-ink-3">人数 / 日</span>}><Trend key={data.days} rows={data.trend}/></Card>
        <Card title="功能使用排行" right={<span className="text-[12px] text-ink-3">近 {data.days} 天</span>}>
          {data.modules.length ? <div><div className="mb-2 grid grid-cols-[minmax(0,1fr)_64px_64px] gap-2 text-[12px] text-ink-3"><span>功能模块</span><span className="text-right">访客</span><span className="text-right">PV</span></div><ol className="divide-y divide-line">{data.modules.map((row, i) => <li key={row.module} className="grid grid-cols-[minmax(0,1fr)_64px_64px] items-center gap-2 py-2 text-[13px]"><span className="truncate text-ink-2"><span className="num mr-3 text-ink-4">{i + 1}</span>{ANALYTICS_MODULES[row.module]}</span><span className="num text-right">{fmt(row.visitors)}</span><span className="num text-right text-ink-3">{fmt(row.pv)}</span></li>)}</ol></div> : <Empty>尚无功能访问记录</Empty>}
        </Card>
      </div>
      <div className="mt-5 grid items-start gap-5 md:grid-cols-3">
        <Distribution title="新访客与回访访客" total={data.audience.total} rows={[{ label: "新访客", visitors: data.audience.newVisitors }, { label: "回访访客", visitors: data.audience.returning }]}/>
        <Distribution title="流量来源" total={data.audience.total} rows={data.sources}/>
        <Distribution title="访问设备" total={data.audience.total} rows={data.devices}/>
      </div>
      <details className="mt-5 rounded-panel border border-line px-4 py-3 text-[12px] leading-relaxed text-ink-3"><summary className="cursor-pointer font-medium text-ink-2">统计口径与覆盖范围</summary><ul className="mt-2 list-disc space-y-1 pl-4">
        <li>按浏览器本地随机匿名 ID 去重，不按 IP 去重，不等同于自然人。换浏览器、无痕模式或清理存储会被视为新访客。</li>
        <li>今日 / 昨日为北京时间自然日；WAU、MAU分别是含今天的近7、30天去重访客，不是每日人数相加。看板固定显示这些口径，下方分析跟随所选时间范围。</li>
        <li>新访客是所选范围内首次被记录的匿名浏览器；回访访客首次记录早于范围起点。来源与设备按每位访客在范围内首次活跃记录归因，来源只保留站点域名，未提供来源包含直接访问。</li>
        <li>功能访问是页面浏览，不代表问答发送、收藏成功等操作次数；各模块人数不可直接相加。站内切页与刷新计PV，只有查询参数变化不额外计数。</li>
        <li>从 {new Date(data.startedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })} 开始记录；未采集的历史不补造。按日数据保留90天，匿名ID首次记录保留至连续365天不活跃；原始IP访问记录仍保留30天。</li>
        <li>过滤已知爬虫、后台、API、资源及未知路由。JavaScript/本地存储被禁用、拦截器、限流与网络失败会漏记；客户端信息可能伪造。</li>
      </ul></details>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[12px] text-ink-4"><span>更新于 {new Date(data.generatedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}</span><Link to="/admin/visits" className="text-ink-3 hover:text-ink">查看原始访问记录 →</Link></div>
    </div>
  </AdminPage>;
}
export function ErrorBoundary() {
  useRouteError();
  const revalidator = useRevalidator();
  return <AdminPage title="用户活跃分析"><Card><p className="text-[14px] text-ink-2">统计暂时无法读取，请稍后重试。</p><div className="mt-4"><Button busy={revalidator.state === "loading"} onClick={() => revalidator.revalidate()}>重试</Button></div></Card></AdminPage>;
}
