import React, { type ReactNode } from 'react';
import { IconArrowLeft, IconArrowUpRight, IconInfo } from '../../../apps/web/app/components/icons';
import { fmt, eventLabel, multiplier, stamp, store, type RadarEvent } from './data';

interface Props {
  event: RadarEvent;
  close: () => void;
  renderImage: (event: RadarEvent) => ReactNode;
  renderChart: (event: RadarEvent, large?: boolean) => ReactNode;
}

export function MonthlyDetail({ event: e, close, renderImage, renderChart }: Props) {
  return <article className="monthly-file" aria-labelledby="file-title">
    <nav className="file-breadcrumb" aria-label="事件位置"><button onClick={close}><IconArrowLeft size={16}/>返回月度事件流</button><span>/</span><span>{stamp(e.date)}</span><span>/</span><span>事件档案</span></nav>
    <header className="file-header">
      <div className="file-title"><p className="eyebrow">GAMEHOT / {e.kind === 'launch' ? 'THE LAUNCH FILE' : 'THE BREAKOUT FILE'}</p><div className="file-tags"><span className="tag">{eventLabel(e)}</span><span>{e.genre}</span><span className="demo-small">{e.kind === 'launch' ? '榜单核验' : e.status === "confirmed" ? "规则确认" : "疑似 · 继续观察"}</span></div><h1 id="file-title" tabIndex={-1}>{e.name}</h1><p>{e.headline}</p><div className="file-byline"><span>{e.date.replaceAll('-', '.')} {e.kind === 'launch' ? '首次榜单观测日' : e.source === 'historical' ? '回溯日期' : '发现日期'}</span><span>Steam App {e.appid}</span></div><a className="primary" href={store(e)} target="_blank" rel="noreferrer">在 Steam 查看游戏 <IconArrowUpRight size={17}/></a></div>
      <div className="file-art">{renderImage(e)}<span>{e.zh}<small>游戏封面 / Steam</small></span></div>
    </header>
    <div className="file-disclaimer"><IconInfo size={16}/><span>{e.kind === 'launch' ? '按首次有效榜单采样日归档，不代表游戏历史上第一次入榜。' : e.source === 'historical' ? '历史回溯，非当时实时发现。' : '系统实时监测到的增长信号。'}系统记录时间：{new Date(e.detectedAt).toLocaleString('zh-CN', {timeZone:'Asia/Shanghai', hour12:false})}。{e.launch && <>满足规则时间：{new Date(e.launch.qualifiedAt).toLocaleString('zh-CN', {timeZone:'Asia/Shanghai', hour12:false})}。</>}{e.status === 'suspected' ? '历史或确认依据有限，仍在观察。' : '已满足初始检测规则，不代表人工确认爆火原因。'}</span></div>

    {e.kind === 'launch' ? <section className="file-transition" aria-label="新游上榜依据">
      <div><span>Steam 商店发售日期</span><strong className="launch-release-date">{e.launch ? <><span>{e.launch.releaseDay.slice(0, 4)} 年</span>{Number(e.launch.releaseDay.slice(5, 7))}月{Number(e.launch.releaseDay.slice(8))}日</> : '待确认'}</strong><p>新游观察期为发售后 14 天内</p></div>
      <div className="file-change"><span aria-hidden="true">⟶</span><b>Top 100</b><small>多次榜单记录核验</small></div>
      <div><span>首次观测日 · 最高在线记录</span><strong>{fmt(e.peak)}<small>人</small></strong><p>{stamp(e.date)} · 当天观察到的最高值</p></div>
      <div className="file-verdict"><span>入选理由</span><b>新游进入在线人数 Top 100</b><p>至少两次有效榜单记录，跨度达到 15 分钟。首发期最高记录 {fmt(e.launch?.peak ?? e.peak)} 人（{stamp(e.launch?.peakDay ?? e.date)}）；达到 5 万人标记为首发热门，不重复归档。</p></div>
    </section> : <section className="file-transition" aria-label="走红前后的在线人数变化">
      <div><span>此前 {e.baselineDays || "—"} 日 · 常见高峰</span><strong className={e.baseline === null ? 'baseline-missing' : undefined}>{e.baseline === null ? '记录不足' : fmt(e.baseline)}<small>{e.baseline === null ? '' : '人'}</small></strong><p>走红前的在线水平参考</p></div>
      <div className="file-change"><span aria-hidden="true">⟶</span><b>{multiplier(e)}</b><small>相当于此前</small></div>
      <div><span>发现当天 · 最高在线记录</span><strong>{fmt(e.peak)}<small>人</small></strong><p>{stamp(e.date)} · 当天观察到的最高值</p></div>
      <div className="file-verdict"><span>入选理由</span><b>{e.baseline === null ? '先保留观察' : '在线人数出现明显增长'}</b><p>{e.baseline === null ? '此前记录不足，暂不能判断增长幅度。' : `当天最高记录比此前参考值高 ${fmt(e.peak - e.baseline)} 人。`}</p></div>
    </section>}

    <div className="file-research-grid">
      <section className="file-panel file-trajectory"><div className="file-section-title"><div><span className="eyebrow">01 / THE SIGNAL</span><h2>走红的轨迹</h2></div><span className="file-data-tag">当天在线记录 · 北京时间</span></div><p>看人数如何变化，再决定是否值得继续追踪。</p>{renderChart(e, true)}<div className="file-chart-notes"><span>当天记录 <b>{e.coverage === 'partial' ? '部分时段未记录' : '已覆盖主要时段'}</b></span><span>榜单观察 <b>{e.kind === 'launch' ? (e.rankAfter ? `核验时 #${e.rankAfter}` : '已采到 Top 100，旧样本未保存具体名次') : <>{e.rankBefore ? `#${e.rankBefore}` : '未观测到入榜'} → {e.rankAfter ? `#${e.rankAfter}` : '未观测到榜内名次'}</>}</b></span></div>{e.coverage === 'partial' && <p className="file-missing">缺测区间留白，不补零；不以空白区间推断玩家人数。</p>}<details className="file-method"><summary>查看统计方式</summary><p>采样峰值是北京时间当天有效样本中最大的在线人数，是实际峰值的下界，不代表全天独立玩家数。历史采用第三方小时记录，实时采用Steam官方定时采集。{e.kind === 'launch' ? '新游以发售14天内的官方Top 100榜单记录判断，至少两次、跨度15分钟，相邻记录不超过30分钟。首发期最高记录达到5万人即标记首发热门。新游不需要历史低人数基线，不计算增长倍数。' : '倍数为当日最高记录除以前七日中可用日峰值的中位数，至少三天、每日十二小时；不足七日仍标为疑似。缺少基线时不计算倍数。'}缺测区间不连线。</p></details></section>
      <section className="file-panel file-analysis"><div className="file-section-title"><div><span className="eyebrow">02 / THE CONTEXT</span><h2>为什么突然被看见？</h2></div></div><span className={`file-confidence ${e.reason ? '' : 'unknown'}`}>{e.reason ? 'AI 整理报道背景 · 附来源' : '原因未知'}</span><p className="file-reason">{e.reason ?? '目前没有可靠证据能够解释这次人数变化。我们保留未知，不把人数曲线当作爆火原因。'}</p><div className="file-evidence-title">线索与来源<span>{e.evidence.length} 个来源</span></div>{e.evidence.length ? e.evidence.map(source => <a className="file-evidence" key={source.url} href={source.url} target="_blank" rel="noreferrer"><div><strong>{source.label}</strong><p>{source.note}</p></div><IconArrowUpRight size={17}/></a>) : <div className="file-no-evidence">尚无线索，等待补充公告或报道。</div>}<p className="file-caution">人数增长不单独证明原因。AI总结仅限附列报道；统计来源与原因证据分别展示。</p></section>
    </div>
    <div className="file-bottom"><span>一场走红，是一条值得留下的记录。</span><button onClick={close}>继续回看这个月 <IconArrowLeft size={15}/></button></div>
  </article>;
}
