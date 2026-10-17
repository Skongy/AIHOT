import { useEffect, useRef, useState } from "react";
import type { ChangelogRelease } from "@aihot/contracts/site";

const ASK_FLOW = ["提问", "检索", "引用", "回答"];
const ASK_CAPABILITIES = ["主动检索", "来源可追溯", "连续追问"];

/** The editorial feature card used for changelog milestones that deserve more than a timeline row. */
export function FeatureRelease({ release, id }: { release: ChangelogRelease; id?: string }) {
  const [, month, day] = release.date.split("-");
  const root = useRef<HTMLElement>(null);
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    const node = root.current;
    if (!node || typeof IntersectionObserver === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setEntered(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return;
      setEntered(true);
      observer.disconnect();
    }, { threshold: 0.22, rootMargin: "0px 0px -8%" });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <section ref={root} id={id} className={`changelog-feature scroll-mt-[calc(var(--bar-h)+1.5rem)] ${entered ? "is-entered" : ""}`} aria-labelledby={`feature-${release.date}`}>
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
        <p className="changelog-feature__eyebrow mb-2 text-[11px] font-semibold tracking-[0.16em] text-accent">GAMEHOT INTELLIGENCE</p>
        <h2 id={`feature-${release.date}`} className="changelog-feature__heading font-display text-[30px] font-semibold leading-[1.16] tracking-[-0.025em] text-ink sm:text-[38px]">
          {release.title}
        </h2>
        <p className="changelog-feature__lead mt-4 max-w-[52rem] text-[15px] leading-[1.9] text-ink-2 sm:text-[16px]">{release.body[0]}</p>

        <div className="changelog-feature__trajectory mt-8" role="img" aria-label="AI 问答工作过程：提问、检索、引用、回答">
          <span className="changelog-feature__trajectory-line" aria-hidden="true" />
          {ASK_FLOW.map((step, index) => (
            <span key={step} className="changelog-feature__node" style={{ animationDelay: `${360 + index * 110}ms` }}>
              <span className="changelog-feature__node-mark" aria-hidden="true">{index + 1}</span>
              <span>{step}</span>
            </span>
          ))}
        </div>

        <div className="mt-7 flex flex-wrap gap-2" aria-label="主要能力">
          {ASK_CAPABILITIES.map((capability, index) => (
            <span key={capability} className="changelog-feature__capability rounded-full border border-accent/20 bg-accent-softer px-3 py-1.5 text-[12px] font-medium text-accent-ink" style={{ animationDelay: `${820 + index * 70}ms` }}>
              {capability}
            </span>
          ))}
        </div>

        {release.body[1] && <p className="changelog-feature__summary mt-5 border-t border-line-soft pt-5 text-[13.5px] leading-[1.8] text-ink-3">{release.body[1]}</p>}
      </div>
    </section>
  );
}
