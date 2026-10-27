import { Link } from "react-router";
import { useEffect, useRef, useState } from "react";
import type { ChangelogRelease } from "@aihot/contracts/site";
import "./radar-release.css";
export function RadarRelease({ release, id }: { release: ChangelogRelease; id?: string }) {
  const root = useRef<HTMLElement>(null);
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const node = root.current;
    if (!node || typeof IntersectionObserver === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setEntered(true); return; }
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return;
      setEntered(true);
      observer.disconnect();
    }, { threshold: 0, rootMargin: "8% 0px 0px 0px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return <section ref={root} id={id} className={`radar-release ${entered ? "is-entered" : ""} scroll-mt-[calc(var(--bar-h)+1.5rem)]`}>
    <header><span>重大更新 / NEW CHAPTER</span><time dateTime={release.date}>{release.date.replaceAll("-", ".")}</time></header>
    <div className="radar-release-content"><div><p>GAMEHOT · 游戏异动</p><h2 className="font-display text-[30px] font-semibold leading-[1.16] tracking-[-0.025em] sm:text-[38px]">{release.title}</h2><p>{release.body[0]}</p><Link to="/radar">打开游戏异动 <span aria-hidden="true">↗</span></Link></div>
      <div className="radar-release-signal" aria-hidden="true"><span className="radar-release-scan"/>{[8, 12, 9, 15, 11, 18, 16, 30, 45, 69, 89, 104, 93, 110].map((h, i) => <i key={i} style={{ height: h, animationDelay: `${i * 110}ms` }}/>)}</div>
    </div><p className="radar-release-note">{release.body[1]}</p>
  </section>;
}
