import type { ChangelogRelease } from "@aihot/contracts/site";

const ASK_TOOLS = ["近期资讯", "站内搜索", "热点", "事件", "精选解释", "热榜解释", "日报", "文章摘要"];

/** The editorial feature card used for changelog milestones that deserve more than a timeline row. */
export function FeatureRelease({ release, id }: { release: ChangelogRelease; id?: string }) {
  const [, month, day] = release.date.split("-");
  return (
    <section id={id} className="changelog-feature scroll-mt-[calc(var(--bar-h)+1.5rem)]" aria-labelledby={`feature-${release.date}`}>
      <div className="changelog-feature__glow" aria-hidden="true" />
      <div className="changelog-feature__rings" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>

      <header className="relative z-10 flex flex-wrap items-center justify-between gap-3 border-b border-accent/20 pb-5">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-2 rounded-full border border-accent/25 bg-accent-softer px-3 py-1 text-[11px] font-semibold tracking-[0.12em] text-accent">
            <span className="changelog-feature__pulse size-1.5 rounded-full bg-accent" aria-hidden="true" />
            重大更新
          </span>
          <span className="mono text-[11px] tracking-[0.12em] text-ink-4">MAJOR RELEASE</span>
        </div>
        <time dateTime={release.date} className="mono text-[12px] text-ink-3">
          {Number(month)} 月 {Number(day)} 日 · {release.time}
        </time>
      </header>

      <div className="relative z-10 pt-7">
        <p className="mb-2 text-[11px] font-semibold tracking-[0.16em] text-accent">GAMEHOT INTELLIGENCE</p>
        <h2 id={`feature-${release.date}`} className="font-display text-[30px] font-semibold leading-[1.16] tracking-[-0.025em] text-ink sm:text-[38px]">
          {release.title}
        </h2>
        <p className="mt-4 max-w-[52rem] text-[15px] leading-[1.9] text-ink-2 sm:text-[16px]">{release.body[0]}</p>

        <div className="mt-6 flex flex-wrap gap-2" aria-label="AI 问答可用工具">
          {ASK_TOOLS.map((tool, index) => (
            <span key={tool} className="changelog-feature__tool rounded-full border border-line bg-surface/75 px-3 py-1.5 text-[12px] text-ink-2" style={{ animationDelay: `${180 + index * 45}ms` }}>
              {tool}
            </span>
          ))}
        </div>

        <ol className="mt-8 grid gap-3 border-t border-line-soft pt-5 lg:grid-cols-3">
          {release.body.slice(1).map((line, index) => (
            <li key={line} className="changelog-feature__detail flex gap-3 rounded-tile bg-surface/55 p-4" style={{ animationDelay: `${360 + index * 80}ms` }}>
              <span className="mono mt-0.5 text-[11px] font-semibold text-accent">0{index + 1}</span>
              <span className="text-[13px] leading-[1.75] text-ink-3">{line}</span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
