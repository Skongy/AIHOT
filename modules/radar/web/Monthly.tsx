import React, { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useReducedMotion } from 'motion/react';
import { IconArrowRight, IconArrowUpRight, IconChevronLeft, IconChevronRight } from '../../../apps/web/app/components/icons';
import { cover, fmt, eventLabel, multiplier, stamp, store, type RadarEvent } from './data';
import { monthDays, moveMonth } from './dates';
import type { RadarMonth } from '../types';
import { onCardSpotlightMove } from '../../../apps/web/app/lib/spotlight';
import { MonthlyDetail } from './MonthlyDetail';

interface Props {
  data: RadarMonth;
  renderImage: (event: RadarEvent) => ReactNode;
  renderChart: (event: RadarEvent, large?: boolean) => ReactNode;
}

export function Monthly({ data, renderImage, renderChart }: Props) {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const detail = data.events.find(e => e.id === params.get('event')) ?? null;
  const savedScroll = useRef(0);
  const wasDetail = useRef(false);
  const lastOpened = useRef<string | null>(null);
  const openedFromList = useRef(false);
  const month = data.month;
  const [activeDay, setActiveDay] = useState<string | null>(null);
  const [showReturn, setShowReturn] = useState(false);
  const band = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();
  const days = monthDays(month);
  const records = data.events;
  const covered = new Set(data.coverage.map(d => d.date));
  const grouped = new Map<string, RadarEvent[]>();
  for (const event of records) grouped.set(event.date, [...(grouped.get(event.date) ?? []), event]);
  const selectedCount = activeDay ? grouped.get(activeDay)?.length ?? 0 : null;
  const nextDay = activeDay && !selectedCount
    ? [...grouped.keys()].sort().find(d => d > activeDay) ?? [...grouped.keys()].sort().reverse().find(d => d < activeDay)
    : undefined;
  const year = month.slice(0, 4);
  const monthNumber = Number(month.slice(5));

  useEffect(() => {
    const original = history.scrollRestoration;
    history.scrollRestoration = 'manual';
    return () => { history.scrollRestoration = original; };
  }, []);

  useLayoutEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [month]);

  useLayoutEffect(() => {
    if (detail) {
      window.scrollTo({ top: 0, behavior: 'instant' });
      document.getElementById('file-title')?.focus({ preventScroll: true });
    }
    else if (wasDetail.current) {
      window.scrollTo({ top: savedScroll.current, behavior: 'instant' });
      if (lastOpened.current) document.getElementById(`open-${lastOpened.current}`)?.focus({ preventScroll: true });
    }
    wasDetail.current = !!detail;
  }, [detail?.id]);

  function open(event: RadarEvent) {
    openedFromList.current = true;
    savedScroll.current = window.scrollY;
    lastOpened.current = event.id;
    const next = new URLSearchParams(params);
    next.set('event', event.id);
    setParams(next);
  }
  function close() {
    if (openedFromList.current) { navigate(-1); return; }
    const next = new URLSearchParams(params);
    next.delete('event');
    setParams(next, { replace: true });
  }

  useEffect(() => {
    const target = band.current;
    if (!target) return;
    const observer = new IntersectionObserver(([entry]) => setShowReturn(!entry!.isIntersecting));
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!activeDay) return;
    scrollToDay(activeDay);
  }, [activeDay, month]);

  function chooseMonth(value: string) {
    const next = new URLSearchParams(params); next.set('month', value); next.delete('event'); setParams(next);
    setActiveDay(null);
  }
  function jump(date: string) {
    setActiveDay(date);
    if (activeDay === date) scrollToDay(date);
  }
  function scrollToDay(date: string) {
    const target = document.getElementById(`monthly-${date}`);
    if (target) {
      const nav = band.current;
      const offset = nav && getComputedStyle(nav).position === 'sticky' ? nav.getBoundingClientRect().height + 18 : 15;
      window.scrollTo({ top: Math.max(0, target.getBoundingClientRect().top + window.scrollY - offset), behavior: reduce ? 'instant' : 'smooth' });
      target.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
    }
  }

  return <><div className="monthly-page" hidden={!!detail}>
    <div className="radar-coverage" role="status">{data.status.healthy ? "监控运行中" : "监控数据待更新"} · 本月 {covered.size} 天有采样 · 历史覆盖有限{data.status.lastSuccess && <> · 最近采集 {new Date(data.status.lastSuccess).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}</>}</div><header className="monthly-intro">
      <div><p className="eyebrow">游戏异动 / 月度发现录</p><h1>走红的那一天，记在这里。</h1><p>不看谁一直最热，只看谁突然被看见。</p></div>
      <span className="monthly-edition">RADAR<span>月度事件流</span></span>
    </header>

    <section className="monthly-nav" ref={band} aria-label="月度爆火时间带">
      <div className="monthly-nav-top">
        <div className="month-controls">
          <button className="month-arrow" aria-label="上个月" onClick={() => chooseMonth(moveMonth(month, -1))}><IconChevronLeft size={18}/></button>
          <h2><span>{year}</span> {monthNumber} 月</h2>
          <button className="month-arrow" aria-label="下个月" onClick={() => chooseMonth(moveMonth(month, 1))}><IconChevronRight size={18}/></button>
        </div>
        <div className="month-summary"><strong>{records.length}</strong> 条记录<span> / {grouped.size} 个发现日</span></div>
        <span className="month-hint">点击日期，直接跳到那一天 <IconArrowRight size={13}/></span>
      </div>
      <div className="month-ribbon" style={{ '--days': days.length } as React.CSSProperties}>
        <span className="month-sweep" aria-hidden="true"/>
        {days.map(day => {
          const amount = grouped.get(day)?.length ?? 0;
          return <button key={day} className={`month-day ${amount ? 'has-events' : ''}`} aria-pressed={activeDay === day}
            aria-label={`${stamp(day)}，${amount} 条发现，${amount ? '跳到当天' : covered.has(day) ? '未发现符合条件的事件' : '暂无可靠记录'}`} onClick={() => jump(day)}>
            <span className="month-day-number">{day.slice(8)}</span>
            <span className="month-day-signal" aria-hidden="true">{amount ? <><i style={{ height: 5 + amount * 5 }}/><b>{amount}</b></> : <em/>}</span>
          </button>;
        })}
      </div>
      <div className="ribbon-caption"><span><i/>有新发现，数字为当日记录数</span><span>空线表示当日无记录 · 北京时间 · 缺少记录不代表没有异动</span></div>
      <div className="month-focus-line" aria-live="polite"><span>{activeDay ? <>当前定位 <strong>{stamp(activeDay)}</strong><span> · {selectedCount} 条发现</span></> : <>正在浏览 <strong>{monthNumber} 月全月</strong><span> · {records.length} 条记录</span></>}</span>{activeDay && <button onClick={() => setActiveDay(null)}>清除日期标记 ×</button>}</div>
      {activeDay && selectedCount === 0 && <div className="quiet-day" role="status"><span>{stamp(activeDay)}{covered.has(activeDay) ? '未发现符合条件的事件' : '暂无可靠记录'}。整月事件仍在下方。</span>{nextDay && <button onClick={() => jump(nextDay)}>跳到 {stamp(nextDay)} <IconArrowRight size={13}/></button>}</div>}
    </section>

    <div className="monthly-stream-top">
      <h2>本月发现<span>时间倒序 · 直接往下看</span></h2>
      <details className="monthly-method"><summary>人数怎么算？</summary><p>当天最高在线记录为北京时间当天有效样本中的最大在线人数，是实际峰值的下界。倍数 = 当日采样峰值 ÷ 前 7 日采样日峰值中位数；缺基线不计算倍数。历史回溯基于第三方小时记录，持续监控基于Steam官方数据；历史不足的记录标为疑似，不代表全平台完整覆盖。</p></details>
    </div>

    {records.length === 0 ? <div className="monthly-empty"><span className="empty-orbit" aria-hidden="true"/><h3>{monthNumber} 月暂无可靠事件记录。</h3><p>未覆盖的日期不代表没有异动，我们只展示可追溯的记录。</p><button className="primary" onClick={() => chooseMonth(new Date().toLocaleDateString('sv-SE', {timeZone:'Asia/Shanghai'}).slice(0,7))}>回到本月 <IconArrowRight size={16}/></button></div> :
      <div className="monthly-stream">{[...grouped].map(([day, dayEvents]) => <section key={day} id={`monthly-${day}`} className={`monthly-day-group ${activeDay === day ? 'is-target' : ''}`} aria-labelledby={`heading-${day}`}>
        <div className="monthly-date"><h2 tabIndex={-1} id={`heading-${day}`}><strong>{day.slice(8)}</strong><span>{monthNumber} 月</span></h2><span>{dayEvents.length} 条发现</span><i aria-hidden="true"/></div>
        <div className="monthly-day-events">{dayEvents.map(e => <article className="monthly-event card-spotlight" key={e.id} onMouseMove={onCardSpotlightMove}>
          <button id={`open-${e.id}`} className="monthly-hit" onClick={() => open(e)} aria-label={`展开 ${e.name}，${stamp(e.date)}发现`}><span>查看事件详情</span></button>
          <div className="monthly-art">{renderImage(e)}</div>
          <div className="monthly-copy"><div className="monthly-meta"><span className={`monthly-kind ${e.kind}`}>{eventLabel(e)}</span><span>{e.genre}</span><span className="monthly-sim">{e.kind === 'launch' ? '榜单核验' : e.status === "confirmed" ? "规则确认" : "待确认"}</span></div><h3>{e.name}</h3><p>{e.headline}</p><span className="monthly-cause">{e.reason ? '报道背景 · 附来源' : '原因未知 · 保留未知，不做推断'}</span></div>
          <div className="monthly-stat"><span>当天最高在线记录</span><div><strong>{fmt(e.peak)}</strong><small>人</small><b>{multiplier(e)}</b></div><div className="monthly-chart">{renderChart(e)}</div><span className="monthly-baseline">{e.kind === 'launch' ? `首发期最高 ${fmt(e.launch?.peak ?? e.peak)} 人 · ${stamp(e.launch?.peakDay ?? e.date)}` : e.baseline === null ? '历史记录不足 · 观察中' : `此前 ${e.baselineDays} 日参考 ${fmt(e.baseline)} 人`}</span></div>
          <a href={store(e)} className="monthly-steam" target="_blank" rel="noreferrer" aria-label={`在 Steam 查看 ${e.name}`} title="Steam 商店"><IconArrowUpRight size={19}/></a>
        </article>)}</div>
      </section>)}</div>}
    {showReturn && <button className="return-month" onClick={() => band.current?.scrollIntoView({ block: 'start', behavior: reduce ? 'instant' : 'smooth' })}>↑ 回到 {monthNumber} 月时间带</button>}
  </div>{detail && <MonthlyDetail event={detail} close={close} renderImage={renderImage} renderChart={renderChart}/>}</>;
}
