import { useCallback, useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import type { SiteStats } from "@aihot/contracts/site";
import { IconArrowUpRight } from "../../components/icons";

type PickItem = SiteStats["latest"][number];
type Point = { x: number; y: number };
type Rgb = [number, number, number];

interface Particle {
  event: number;
  lane: number;
  seed: number;
  radius: number;
  t: number;
  speed: number;
  pass: boolean;
  clockwise: boolean;
  size: number;
}

const EVENT_LABELS = [
  ["赛事结果", "热度上升", true],
  ["版本更新", "信息完整", false],
  ["新作动态", "玩家关注", true],
  ["行业变化", "持续跟踪", false],
  ["社区讨论", "等待确认", false],
] as const;

const EVENT_POSITIONS = [
  "left-[34%] top-[35%] lg:left-[44%] lg:top-[31%]",
  "left-[70%] top-[39%] lg:left-[47%] lg:top-[58%]",
  "left-[38%] top-[51%] lg:left-[39%] lg:top-[79%]",
  "left-[72%] top-[54%] opacity-60 lg:left-[55%] lg:top-[36%]",
  "left-[56%] top-[63%] opacity-50 lg:left-[56%] lg:top-[76%]",
] as const;

const fieldStyle = {
  "--heat-x": "52%",
  "--heat-y": "50%",
  backgroundImage:
    "radial-gradient(360px circle at var(--heat-x) var(--heat-y), color-mix(in srgb, var(--accent) 8%, transparent), transparent 64%), linear-gradient(color-mix(in srgb, var(--ink) 4%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in srgb, var(--ink) 4%, transparent) 1px, transparent 1px)",
  backgroundSize: "auto, 32px 32px, 32px 32px",
} as CSSProperties;

function number(n: number) {
  return n.toLocaleString("en-US");
}

function parseColor(value: string, fallback: Rgb): Rgb {
  const input = value.trim();
  const hex = input.match(/^#([0-9a-f]{6})$/i)?.[1];
  if (hex) return [Number.parseInt(hex.slice(0, 2), 16), Number.parseInt(hex.slice(2, 4), 16), Number.parseInt(hex.slice(4, 6), 16)];
  const rgb = input.match(/rgba?\(\s*(\d+)\D+(\d+)\D+(\d+)/i);
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : fallback;
}

function rgba(color: Rgb, alpha: number) {
  return `rgba(${color[0]},${color[1]},${color[2]},${alpha})`;
}

function bezier(a: number, b: number, c: number, d: number, t: number) {
  const u = 1 - t;
  return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
}

function EventNode({ index, title, note, hot, nodeRef }: { index: number; title: string; note: string; hot: boolean; nodeRef: (node: HTMLDivElement | null) => void }) {
  return (
    <div ref={nodeRef} className={`pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-1/2 text-center ${EVENT_POSITIONS[index]}`}>
      <span
        aria-hidden="true"
        className={`absolute left-1/2 top-1/2 -z-10 size-[86px] -translate-x-1/2 -translate-y-1/2 rounded-full border bg-[radial-gradient(circle,var(--surface),color-mix(in_srgb,var(--surface)_52%,transparent),transparent_72%)] shadow-[0_0_44px_color-mix(in_srgb,var(--ink)_5%,transparent)] ${hot ? "border-accent/30" : "border-line/80"}`}
      />
      <b className={`block text-[11px] leading-snug ${hot ? "text-accent-ink" : "text-ink-2"}`}>{title}</b>
      <span className="mt-0.5 block text-[8px] text-ink-4">{note}</span>
    </div>
  );
}

function DailyCard({ items, date, hit, cardRef }: { items: PickItem[]; date: string; hit: boolean; cardRef: RefObject<HTMLElement | null> }) {
  return (
    <article
      ref={cardRef}
      className={`absolute left-1/2 top-[658px] z-20 w-[172px] -translate-x-1/2 overflow-hidden rounded-[12px] border border-line-strong bg-surface shadow-[0_24px_54px_rgba(32,36,43,0.16)] transition-[transform,box-shadow] duration-500 [transition-timing-function:cubic-bezier(.2,.9,.25,1.2)] lg:left-auto lg:right-[3.2%] lg:top-[110px] lg:w-[19%] lg:min-w-[198px] lg:translate-x-0 ${hit ? "-translate-y-1 scale-[1.018] shadow-[0_30px_68px_rgba(32,36,43,0.2)] lg:-translate-y-1" : ""}`}
    >
      <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1 bg-accent" />
      <div className="relative px-4 pb-3.5 pt-3.5">
        <div className="flex items-center justify-between text-[8px] font-black tracking-[0.14em] text-accent">
          <span>GAMEHOT DAILY</span>
          <span>{date}</span>
        </div>
        <div className="mt-2.5 text-[18px] font-black italic tracking-[0.01em] text-ink">GAMEHOT</div>
        <div className="my-2 h-0.5 bg-accent" />
        <h3 className="text-[14px] font-black leading-[1.28] tracking-[-0.02em] text-ink">
          {items.length > 0 ? <><span>今天值得看的</span><br />{items.length} 件游戏大事</> : "今日精选整理中"}
        </h3>
        {items.length > 0 ? (
          <ol className="mt-2.5 space-y-0.5">
            {items.map((item, index) => (
              <li key={item.id}>
                <a
                  href={item.originalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={`阅读原文：${item.title}`}
                  className="group grid min-h-8 grid-cols-[18px_minmax(0,1fr)_12px] items-center gap-1 rounded-[5px] py-1 text-[8px] leading-[1.35] text-ink-2 transition-[color,background-color,transform] hover:translate-x-0.5 hover:bg-accent-softer hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
                >
                  <span className="font-black text-accent">0{index + 1}</span>
                  <span className="line-clamp-2">{item.title}</span>
                  <IconArrowUpRight size={10} className="opacity-40 transition-opacity group-hover:opacity-100" />
                </a>
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-3 text-[9px] leading-relaxed text-ink-4">今天的精选正在整理，稍后回来看看。</p>
        )}
        <div className="mt-2.5 flex items-center justify-between border-t border-line-soft pt-2 text-[7px] text-ink-4">
          <span>08:00</span>
          <span>点击标题阅读原文</span>
        </div>
      </div>
    </article>
  );
}

export function HeatField({ stats, date }: { stats: SiteStats | null; date: string }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const eventRefs = useRef<Array<HTMLDivElement | null>>([]);
  const paperRef = useRef<HTMLElement>(null);
  const arriveRef = useRef<() => void>(() => {});
  const lastArrival = useRef(0);
  const hitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [active, setActive] = useState(0);
  const [hit, setHit] = useState(false);
  const picks = stats?.latest.slice(0, 3) ?? [];
  const highlighted = picks[active % Math.max(1, picks.length)];

  const onArrive = useCallback(() => {
    const now = performance.now();
    if (now - lastArrival.current < 1800) return;
    lastArrival.current = now;
    if (picks.length > 1) setActive((value) => (value + 1) % picks.length);
    setHit(true);
    if (hitTimer.current) clearTimeout(hitTimer.current);
    hitTimer.current = setTimeout(() => setHit(false), 620);
  }, [picks.length]);
  arriveRef.current = onArrive;

  useEffect(() => () => {
    if (hitTimer.current) clearTimeout(hitTimer.current);
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    const paper = paperRef.current;
    const ctx = canvas?.getContext("2d");
    if (!root || !canvas || !paper || !ctx) return;

    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const mouse = { x: 0, y: 0, on: false };
    let width = 0;
    let height = 0;
    let dpr = 1;
    let portrait = false;
    let events: Point[] = [];
    let paperPoint: Point = { x: 0, y: 0 };
    let particles: Particle[] = [];
    let colors = { ink: [61, 72, 83] as Rgb, accent: [139, 105, 20] as Rgb };
    let frame = 0;
    let last = 0;
    let visible = true;
    let disposed = false;

    const rand = (a: number, b: number) => a + Math.random() * (b - a);
    const pointOf = (element: HTMLElement) => {
      const item = element.getBoundingClientRect();
      const box = root.getBoundingClientRect();
      return { x: item.left - box.left + item.width / 2, y: item.top - box.top + item.height / 2 };
    };
    const mergePoint = () => (portrait ? { x: width * 0.5, y: height * 0.69 } : { x: width * 0.68, y: height * 0.52 });

    const pointOn = (particle: Particle, progress: number) => {
      const event = events[particle.event]!;
      if (progress < 0.58) {
        const t = progress / 0.58;
        const start = portrait ? { x: particle.lane * width, y: -18 } : { x: -18, y: particle.lane * height };
        const c1 = portrait ? { x: start.x + Math.sin(particle.seed) * 36, y: height * 0.12 } : { x: width * 0.17, y: start.y + Math.sin(particle.seed) * 32 };
        const c2 = portrait ? { x: event.x + Math.cos(particle.seed) * 55, y: event.y - height * 0.13 } : { x: event.x - width * 0.16, y: event.y + Math.cos(particle.seed) * 42 };
        return { x: bezier(start.x, c1.x, c2.x, event.x, t), y: bezier(start.y, c1.y, c2.y, event.y, t), alpha: 1, gold: false };
      }
      if (progress < 0.76) {
        const t = (progress - 0.58) / 0.18;
        const angle = particle.seed + t * Math.PI * (particle.clockwise ? 1.6 : -1.6);
        const radius = (1 - t) * particle.radius + 12;
        return { x: event.x + Math.cos(angle) * radius, y: event.y + Math.sin(angle) * radius, alpha: 1, gold: false };
      }
      if (!particle.pass) {
        const t = (progress - 0.76) / 0.24;
        const angle = particle.seed + t * 1.2;
        return { x: event.x + Math.cos(angle) * (13 + t * 24), y: event.y + Math.sin(angle) * (13 + t * 24), alpha: 1 - t, gold: false };
      }
      const t = (progress - 0.76) / 0.24;
      const merge = mergePoint();
      const c1 = portrait ? { x: event.x, y: event.y + 70 } : { x: event.x + 90, y: event.y };
      const c2 = portrait ? { x: merge.x + (event.x - merge.x) * 0.18, y: merge.y - 35 } : { x: merge.x - 55, y: merge.y + (event.y - merge.y) * 0.15 };
      if (t < 0.55) {
        const z = t / 0.55;
        return { x: bezier(event.x, c1.x, c2.x, merge.x, z), y: bezier(event.y, c1.y, c2.y, merge.y, z), alpha: 1, gold: true };
      }
      const z = (t - 0.55) / 0.45;
      const c3 = portrait ? { x: merge.x, y: merge.y + 55 } : { x: merge.x + 75, y: merge.y };
      const c4 = portrait ? { x: paperPoint.x, y: paperPoint.y - 70 } : { x: paperPoint.x - 65, y: paperPoint.y };
      return { x: bezier(merge.x, c3.x, c4.x, paperPoint.x, z), y: bezier(merge.y, c3.y, c4.y, paperPoint.y, z), alpha: 1, gold: true };
    };

    const seed = () => {
      const count = portrait ? 58 : 78;
      particles = Array.from({ length: count }, (_, index) => ({
        event: index % events.length,
        lane: (index + 0.5) / count,
        seed: rand(0, Math.PI * 2),
        radius: rand(34, 48),
        t: Math.random(),
        speed: rand(0.045, 0.078),
        pass: index % 7 === 0 || index % 11 === 0,
        clockwise: index % 2 === 0,
        size: rand(0.7, 1.45),
      }));
    };

    const readColors = () => {
      const style = getComputedStyle(document.documentElement);
      colors = {
        ink: parseColor(style.getPropertyValue("--ink-3"), [61, 72, 83]),
        accent: parseColor(style.getPropertyValue("--accent"), [139, 105, 20]),
      };
    };

    const build = () => {
      const box = root.getBoundingClientRect();
      width = box.width;
      height = box.height;
      if (width < 10 || height < 10 || eventRefs.current.some((node) => !node)) return;
      portrait = width < 720;
      dpr = Math.min(2, devicePixelRatio || 1);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      events = eventRefs.current.map((node) => pointOf(node!));
      const card = paper.getBoundingClientRect();
      const field = root.getBoundingClientRect();
      paperPoint = portrait
        ? { x: card.left - field.left + card.width / 2, y: card.top - field.top }
        : { x: card.left - field.left, y: card.top - field.top + card.height / 2 };
      readColors();
      seed();
    };

    const staticField = () => {
      ctx.clearRect(0, 0, width, height);
      ctx.lineCap = "round";
      events.forEach((event, index) => {
        for (let ring = 0; ring < 3; ring++) {
          ctx.beginPath();
          ctx.arc(event.x, event.y, 32 + ring * 18, 0, Math.PI * 2);
          ctx.strokeStyle = index === 0 || index === 2 ? rgba(colors.accent, 0.13 - ring * 0.025) : rgba(colors.ink, 0.1 - ring * 0.02);
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      });
      const merge = mergePoint();
      events.slice(0, 3).forEach((event) => {
        ctx.beginPath();
        ctx.moveTo(event.x, event.y);
        if (portrait) ctx.bezierCurveTo(event.x, event.y + 70, merge.x + (event.x - merge.x) * 0.18, merge.y - 35, merge.x, merge.y);
        else ctx.bezierCurveTo(event.x + 90, event.y, merge.x - 55, merge.y + (event.y - merge.y) * 0.15, merge.x, merge.y);
        ctx.strokeStyle = rgba(colors.accent, 0.28);
        ctx.lineWidth = 1.15;
        ctx.stroke();
      });
      ctx.beginPath();
      ctx.moveTo(merge.x, merge.y);
      if (portrait) ctx.bezierCurveTo(merge.x, merge.y + 55, paperPoint.x, paperPoint.y - 70, paperPoint.x, paperPoint.y);
      else ctx.bezierCurveTo(merge.x + 75, merge.y, paperPoint.x - 65, paperPoint.y, paperPoint.x, paperPoint.y);
      ctx.strokeStyle = rgba(colors.accent, 0.76);
      ctx.lineWidth = 1.7;
      ctx.stroke();
    };

    const draw = (now: number, still = false) => {
      staticField();
      const dt = last ? Math.min(0.04, (now - last) / 1000) : 0;
      last = now;
      for (const particle of particles) {
        if (!still) particle.t += dt * particle.speed * (particle.pass ? 1.18 : 1);
        if (particle.t > 1) {
          if (particle.pass) arriveRef.current();
          particle.t -= 1;
          particle.seed = rand(0, Math.PI * 2);
        }
        const point = pointOn(particle, particle.t);
        let { x, y } = point;
        if (mouse.on) {
          const dx = mouse.x - x;
          const dy = mouse.y - y;
          const distance = Math.hypot(dx, dy);
          if (distance < 145 && distance > 1) {
            const pull = (1 - distance / 145) ** 2 * 18;
            x += (dx / distance) * pull;
            y += (dy / distance) * pull;
          }
        }
        ctx.beginPath();
        ctx.arc(x, y, particle.size * (point.gold ? 1.45 : 1), 0, Math.PI * 2);
        ctx.fillStyle = point.gold ? rgba(colors.accent, 0.84 * point.alpha) : rgba(colors.ink, 0.36 * point.alpha);
        ctx.fill();
      }
      if (!still && visible && !document.hidden && !disposed) frame = requestAnimationFrame(draw);
    };

    const restart = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      build();
      last = 0;
      draw(performance.now(), true);
      if (!reduced && visible && !document.hidden && !disposed) frame = requestAnimationFrame(draw);
    };
    const onMove = (event: PointerEvent) => {
      const box = root.getBoundingClientRect();
      mouse.x = event.clientX - box.left;
      mouse.y = event.clientY - box.top;
      mouse.on = true;
      root.style.setProperty("--heat-x", `${mouse.x}px`);
      root.style.setProperty("--heat-y", `${mouse.y}px`);
    };
    const onLeave = () => {
      mouse.on = false;
      root.style.setProperty("--heat-x", "52%");
      root.style.setProperty("--heat-y", "50%");
    };
    const onVisibility = () => restart();
    const resize = new ResizeObserver(restart);
    const observer = new IntersectionObserver(([entry]) => {
      visible = !!entry?.isIntersecting;
      if (visible) restart();
      else if (frame) cancelAnimationFrame(frame);
    }, { rootMargin: "100px" });
    const theme = new MutationObserver(restart);

    resize.observe(root);
    observer.observe(root);
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });
    root.addEventListener("pointermove", onMove, { passive: true });
    root.addEventListener("pointerleave", onLeave);
    document.addEventListener("visibilitychange", onVisibility);
    restart();

    return () => {
      disposed = true;
      if (frame) cancelAnimationFrame(frame);
      resize.disconnect();
      observer.disconnect();
      theme.disconnect();
      root.removeEventListener("pointermove", onMove);
      root.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <section aria-labelledby="heat-field-title" className="mt-10 overflow-hidden rounded-[22px] border border-line bg-surface/75 shadow-[0_24px_70px_rgba(32,36,43,0.07)] xl:mt-14">
      <div className="flex min-h-14 items-center justify-between border-b border-line-soft px-4 sm:px-5">
        <div className="flex items-center gap-2.5 text-[12px] font-semibold text-ink-2">
          <span className="relative flex size-2" aria-hidden="true">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-hot opacity-25 motion-reduce:animate-none" />
            <span className="relative inline-flex size-2 rounded-full bg-hot" />
          </span>
          游戏动态正在聚合
        </div>
        <div className="hidden items-center gap-2 text-[10px] text-ink-4 sm:flex">
          <b className="text-[11px] text-ink">大量动态</b><i className="h-px w-4 bg-line-strong" />
          <b className="text-[11px] text-ink">事件成形</b><i className="h-px w-4 bg-line-strong" />
          <b className="text-[11px] text-accent">少数精选</b><i className="h-px w-4 bg-line-strong" />
          <b className="text-[11px] text-ink">每日成刊</b>
        </div>
      </div>

      <div ref={rootRef} style={fieldStyle} className="relative h-[870px] overflow-hidden lg:h-[510px]">
        <canvas ref={canvasRef} aria-hidden="true" className="pointer-events-none absolute inset-0 z-0" />

        <div className="pointer-events-none absolute left-[6%] top-10 z-10 lg:left-[4.3%] lg:top-12">
          <b className="num block text-[24px] font-black leading-none tracking-[-0.04em] text-ink lg:text-[28px]">{number(stats?.day.collected ?? 0)}</b>
          <span className="mt-1.5 block text-[10px] text-ink-4">过去 24 小时进入判断</span>
        </div>
        <div className="pointer-events-none absolute left-[6%] top-[236px] z-10 lg:left-[34%] lg:top-12">
          <b className="num block text-[24px] font-black leading-none tracking-[-0.04em] text-ink lg:text-[28px]">{number(stats?.formingEvents ?? 0)}</b>
          <span className="mt-1.5 block text-[10px] text-ink-4">个事件正在成形</span>
        </div>
        <div className="pointer-events-none absolute left-[6%] top-[530px] z-10 lg:left-[65%] lg:top-12">
          <b className="num block text-[24px] font-black leading-none tracking-[-0.04em] text-ink lg:text-[28px]">{number(stats?.day.selected ?? 0)}</b>
          <span className="mt-1.5 block text-[10px] text-ink-4"><strong className="text-accent">条精选</strong> 通过判断</span>
        </div>

        {EVENT_LABELS.map(([title, note, hot], index) => (
          <EventNode key={title} index={index} title={title} note={note} hot={hot} nodeRef={(node) => { eventRefs.current[index] = node; }} />
        ))}

        <div className="pointer-events-none absolute left-1/2 top-[69%] z-10 flex -translate-x-1/2 items-center gap-2 text-[9px] font-black tracking-[0.13em] text-accent lg:left-[65.8%] lg:top-[54%] lg:-rotate-90">
          <i className="h-px w-9 bg-accent/35" />精选线<i className="h-px w-9 bg-accent/35" />
        </div>

        {highlighted && (
          <a href={highlighted.originalUrl} target="_blank" rel="noopener noreferrer" className="group pointer-events-auto absolute bottom-[62px] left-[69%] z-10 hidden w-[16%] lg:block">
            <b className="block text-[9px] font-black tracking-[0.12em] text-accent">今日精选</b>
            <span key={highlighted.id} className="animate-fade-up mt-1.5 line-clamp-2 block text-[11px] font-bold leading-relaxed text-ink-2 transition-colors group-hover:text-accent">{highlighted.title}</span>
            <small className="mt-1 flex items-center gap-1 text-[8px] text-ink-4">阅读原文 <IconArrowUpRight size={9} /></small>
          </a>
        )}

        <DailyCard items={picks} date={date} hit={hit} cardRef={paperRef} />

        <div className="pointer-events-none absolute bottom-5 right-[5%] z-10 grid gap-1.5 text-[9px] text-ink-4 lg:left-[4.3%] lg:right-auto lg:flex lg:gap-4">
          <span className="flex items-center gap-1.5"><i className="h-px w-4 bg-ink-4/60" />普通动态</span>
          <span className="flex items-center gap-1.5"><i className="h-px w-4 bg-accent" />进入精选</span>
        </div>
      </div>

      <div className="grid border-t border-line bg-surface/55 lg:grid-cols-[1.25fr_.75fr]">
        <div className="border-b border-line p-5 sm:p-6 lg:border-b-0 lg:border-r">
          <span className="text-[10px] font-black tracking-[0.14em] text-accent">从噪声里看见事件</span>
          <h2 id="heat-field-title" className="mt-2 text-[22px] font-black leading-snug tracking-[-0.025em] text-ink">消息不是排队通过，而是在讨论中逐渐成形。</h2>
          <p className="mt-2 max-w-[680px] text-[12.5px] leading-[1.75] text-ink-3">灰色粒子代表不断进入的动态，它们围绕同一事件聚合；事实更完整、与玩家更相关的内容变成金色轨迹，穿过精选线，最终汇入日报。</p>
        </div>
        <dl className="grid grid-cols-3">
          <div className="grid content-center p-4 sm:p-5"><dt className="order-2 mt-1 text-[9px] text-ink-4">滚动观察窗口</dt><dd className="num text-[20px] font-black text-ink">24h</dd></div>
          <div className="grid content-center border-l border-line p-4 sm:p-5"><dt className="order-2 mt-1 text-[9px] text-ink-4">累计精选</dt><dd className="num text-[20px] font-black text-ink">{number(stats?.selected ?? 0)}</dd></div>
          <div className="grid content-center border-l border-line p-4 sm:p-5"><dt className="order-2 mt-1 text-[9px] text-ink-4">已发布日报</dt><dd className="num text-[20px] font-black text-ink">{number(stats?.dailies ?? 0)}</dd></div>
        </dl>
      </div>
    </section>
  );
}
