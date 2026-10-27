import { useEffect, useRef, useState } from "react";
import { fmt, type RadarEvent } from "./data";
const clock = (at: string) => new Date(at).toLocaleTimeString("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", hour12: false });
/** Time, curve, hit testing and marker all share the same SVG coordinate system. */
export function Chart({ event, large = false }: { event: RadarEvent; large?: boolean }) {
  const svg = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(640);
  const [active, setActive] = useState<number | null>(null);
  useEffect(() => {
    const node = svg.current;
    if (!large || !node) return;
    const measure = () => setWidth(Math.max(1, node.clientWidth));
    measure();
    const observer = new ResizeObserver(entries => setWidth(Math.max(1, entries[0].contentRect.width)));
    observer.observe(node);
    return () => observer.disconnect();
  }, [large, event.id]);
  const points = event.points, w = large ? width : 560, h = large ? 250 : 80;
  if (!points.length) return <p>暂无可用曲线记录</p>;
  const left = large ? 54 : 5, right = large ? 16 : 5, top = large ? 24 : 5, bottom = large ? 38 : 5;
  const peak = Math.max(1, event.peak, ...points.map(p => p.count));
  const rough = peak / 4, magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = ([1, 2, 2.5, 5, 10].find(n => n >= rough / magnitude) ?? 10) * magnitude;
  const max = large ? Math.ceil(peak / step) * step : peak;
  const lo = Date.parse(points[0].at), span = Math.max(3600000, Date.parse(points.at(-1)!.at) - lo);
  const xy = points.map(p => ({ x: left + (Date.parse(p.at) - lo) / span * Math.max(1, w - left - right), y: h - bottom - p.count / max * (h - top - bottom) }));
  const segments: string[][] = []; let segment: string[] = [];
  for (let i = 0; i < points.length; i++) {
    if (i && Date.parse(points[i].at) - Date.parse(points[i - 1].at) > 90 * 60000 && segment.length) { segments.push(segment); segment = []; }
    segment.push(`${xy[i].x},${xy[i].y}`);
  }
  if (segment.length) segments.push(segment);
  const ticks = Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step);
  const timeTicks = [...new Set(Array.from({ length: w < 400 ? 3 : 4 }, (_, i) => Math.round(i * (points.length - 1) / ((w < 400 ? 3 : 4) - 1))))];
  const selected = active !== null && active < points.length ? active : null;
  const inspect = (node: SVGSVGElement, clientX: number) => {
    const rect = node.getBoundingClientRect();
    const box = node.viewBox.baseVal;
    if (rect.width <= 0 || rect.height <= 0 || box.width <= 0) return;
    // Match the rendered box, including ancestor scaling; preserveAspectRatio="none" removes letterboxing.
    const localX = box.x + (clientX - rect.left) / rect.width * box.width;
    setActive(xy.reduce((best, p, i) => Math.abs(p.x - localX) < Math.abs(xy[best].x - localX) ? i : best, 0));
  };
  return <div className={`growth-chart ${large ? "large radar-chart" : ""}`}>
    {large && <div className="radar-chart-caption"><span>同时在线 · 人</span><span>北京时间</span></div>}
    <div className="radar-chart-surface">
      <svg ref={svg} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" tabIndex={large ? 0 : undefined} role="img" aria-label={`${event.name} 在线人数记录；最高 ${fmt(event.peak)} 人${large ? '，左右方向键查看时点' : ''}`}
        onPointerMove={large ? e => inspect(e.currentTarget, e.clientX) : undefined} onPointerDown={large ? e => inspect(e.currentTarget, e.clientX) : undefined}
        onPointerLeave={e => { if (e.pointerType === "mouse") setActive(null); }} onBlur={() => setActive(null)}
        onKeyDown={large ? e => { if (["ArrowLeft", "ArrowRight", "Home", "End", "Escape"].includes(e.key)) { e.preventDefault(); setActive(e.key === "Escape" ? null : e.key === "Home" ? 0 : e.key === "End" ? points.length - 1 : Math.max(0, Math.min(points.length - 1, (selected ?? 0) + (e.key === "ArrowRight" ? 1 : -1)))); } } : undefined}>
        {large && ticks.map(value => { const y = h - bottom - value / max * (h - top - bottom); return <g key={value} className="radar-chart-axis"><line x1={left} x2={w - right} y1={y} y2={y} className="chart-grid"/><text x={left - 10} y={y} textAnchor="end" dominantBaseline="middle">{fmt(value)}</text></g>; })}
        {large && <g className="radar-chart-axis"><line x1={left} x2={left} y1={top} y2={h - bottom} className="chart-grid"/>{timeTicks.map(i => <text key={i} x={xy[i].x} y={h - 14} textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"}>{clock(points[i].at)}</text>)}</g>}
        {segments.map((s, i) => <polyline key={i} points={s.join(" ")} fill="none" stroke="currentColor" strokeWidth={large ? 2 : 2.5} strokeLinecap="round" strokeLinejoin="round"/>)}
        {xy.map((p, i) => <circle key={i} className="radar-observation" data-index={i} cx={p.x} cy={p.y} r={points.length === 1 ? 3 : 1} fill="currentColor"/>)}
        {selected !== null && large && <g className="radar-chart-selection"><line x1={xy[selected].x} x2={xy[selected].x} y1={top} y2={h - bottom} stroke="currentColor" strokeDasharray="3 4" opacity=".4"/><circle className="radar-chart-marker" cx={xy[selected].x} cy={xy[selected].y} r="4.5" fill="currentColor"/></g>}
      </svg>
      {large && selected !== null && <div className="radar-chart-tooltip" aria-hidden="true" style={{ left: `${Math.max(8, Math.min(w - 172, xy[selected].x + 12)) / w * 100}%`, top: `${xy[selected].y / h * 100}%`, transform: xy[selected].y < 90 ? "translateY(14px)" : "translateY(calc(-100% - 12px))" }}><time>{clock(points[selected].at)} · 北京时间</time><strong>{fmt(points[selected].count)}<small> 人在线</small></strong></div>}
    </div>
    {large && <p className="radar-chart-readout" aria-live="polite">{selected === null ? "移入或轻点查看记录 · 方向键逐点查看 · 缺测区间不连线" : `${new Date(points[selected].at).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })} · ${fmt(points[selected].count)} 人同时在线`}</p>}
  </div>;
}
