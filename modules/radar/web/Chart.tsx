import { useState } from "react";
import { fmt, type RadarEvent } from "./data";
/** All x positions use real timestamps. Gaps longer than 90 minutes remain disconnected. */
export function Chart({ event, large = false }: { event: RadarEvent; large?: boolean }) {
  const points = event.points, w = 560, h = large ? 190 : 80, pad = large ? 25 : 5;
  const [active, setActive] = useState<number | null>(null);
  if (!points.length) return <p>暂无可用曲线记录</p>;
  const lo = Date.parse(points[0].at), span = Math.max(3600000, Date.parse(points.at(-1)!.at) - lo), max = Math.max(1, event.peak);
  const xy = points.map(p => ({ x: pad + (Date.parse(p.at) - lo) / span * (w - 2 * pad), y: h - pad - p.count / max * (h - 2 * pad) }));
  const segments: string[][] = []; let segment: string[] = [];
  for (let i = 0; i < points.length; i++) {
    if (i && Date.parse(points[i].at) - Date.parse(points[i - 1].at) > 90 * 60000 && segment.length) { segments.push(segment); segment = []; }
    segment.push(`${xy[i].x},${xy[i].y}`);
  }
  if (segment.length) segments.push(segment);
  const inspect = (node: SVGSVGElement, clientX: number) => {
    const box = node.getBoundingClientRect(), x = (clientX - box.left) / box.width * w;
    setActive(xy.reduce((best, p, i) => Math.abs(p.x - x) < Math.abs(xy[best].x - x) ? i : best, 0));
  };
  return <div className={`growth-chart ${large ? "large" : ""}`}>
    <svg viewBox={`0 0 ${w} ${h}`} tabIndex={large ? 0 : undefined} role="img" aria-label={`${event.name} 在线人数记录；最高 ${fmt(event.peak)} 人${large ? '，左右方向键查看时点' : ''}`}
      onPointerMove={large ? e => inspect(e.currentTarget, e.clientX) : undefined} onPointerDown={large ? e => inspect(e.currentTarget, e.clientX) : undefined}
      onPointerLeave={e => { if (e.pointerType === "mouse") setActive(null); }} onBlur={() => setActive(null)}
      onKeyDown={large ? e => { if (["ArrowLeft", "ArrowRight", "Home", "End", "Escape"].includes(e.key)) { e.preventDefault(); setActive(e.key === "Escape" ? null : e.key === "Home" ? 0 : e.key === "End" ? points.length - 1 : Math.max(0, Math.min(points.length - 1, (active ?? 0) + (e.key === "ArrowRight" ? 1 : -1)))); } } : undefined}>
      {large && [0.25, 0.5, 0.75].map(v => <line key={v} x1={pad} x2={w - pad} y1={pad + v * (h - 2 * pad)} y2={pad + v * (h - 2 * pad)} className="chart-grid"/>)}
      {segments.map((s, i) => <polyline key={i} points={s.join(" ")} fill="none" stroke="currentColor" strokeWidth={large ? 2 : 2.5} strokeLinecap="round" strokeLinejoin="round"/>)}
      {xy.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={points.length === 1 ? 3 : 1} fill="currentColor"/>)}
      {active !== null && large && <g><line x1={xy[active].x} x2={xy[active].x} y1={pad} y2={h - pad} stroke="currentColor" strokeDasharray="3 4" opacity=".4"/><circle cx={xy[active].x} cy={xy[active].y} r="5" fill="currentColor"/></g>}
    </svg>
    {large && <p className="radar-chart-readout" aria-live="polite">{active === null ? "移入或轻点查看真实时间与人数；也可用左右方向键" : `${new Date(points[active].at).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })} · ${fmt(points[active].count)} 人同时在线`}</p>}
  </div>;
}
