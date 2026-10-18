import { Fragment, useId, type ReactNode } from "react";
import { Link } from "react-router";
import { isAllowedAskHref, sanitizeAskMarkdown } from "../src/agent/citations.ts";
import type { Evidence } from "./types";

function SourceLink({ href, allowed, children }: { href: string; allowed: Set<string>; children: ReactNode }) {
  if (!isAllowedAskHref(href, allowed)) return <>{children}</>;
  return href.startsWith("/") ? <Link to={href}>{children}</Link> : <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
}
const dateLabel = (date?: string | null) => date && Number.isFinite(Date.parse(date)) ? new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(date)) : "时间未提供";

/** React-only Markdown subset: external content never becomes raw HTML. */
export function Answer({ text, evidence, streaming }: { text: string; evidence: Evidence[]; streaming: boolean }) {
  const prefix = useId().replace(/:/g, "");
  const allowed = new Set(evidence.flatMap((e) => e.unavailable ? [] : [e.siteUrl, e.originalUrl].filter((v): v is string => !!v)));
  const safe = sanitizeAskMarkdown(text, allowed);
  // 参考来源只展示答案正文里出现过的 [n]，无引用则不展示整块。
  const citedIds = new Set([...safe.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])));
  const citedEvidence = evidence.filter((e) => citedIds.has(e.id));
  const cite = (id: number) => {
    const element = document.getElementById(`${prefix}-source-${id}`);
    const details = element?.closest("details");
    if (details) details.open = true;
    element?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "center" });
    element?.focus({ preventScroll: true });
  };
  const inline = (line: string): ReactNode[] => line.split(/(\[[^\]]+\]\([^)]+\)|\[\d+\]|\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
    if (link) return <SourceLink key={i} href={link[2]!} allowed={allowed}>{link[1]}</SourceLink>;
    const marker = /^\[(\d+)\]$/.exec(part);
    if (marker) {
      const id = Number(marker[1]); const source = evidence.find((e) => e.id === id && !e.unavailable);
      return source ? <button key={i} type="button" className="ask-citation" aria-label={`查看来源 ${id}：${source.title ?? "资料"}`} onClick={() => cite(id)}>{id}</button> : <span key={i}>{part}</span>;
    }
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={i}>{part.slice(2,-2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={i}>{part.slice(1,-1)}</code>;
    return <Fragment key={i}>{part}</Fragment>;
  });
  const lines = safe.replace(/\r\n/g, "\n").split("\n"); const blocks: ReactNode[] = [];
  for (let i = 0; i < lines.length;) {
    const line = lines[i]!;
    if (!line.trim()) { i++; continue; }
    const heading = /^#{1,6}\s+(.+)$/.exec(line);
    if (heading) { blocks.push(<h3 key={i}>{inline(heading[1]!)}</h3>); i++; continue; }
    if (/^\s*(?:[-*]|\d+[.、])\s+/.test(line)) {
      const start = i; const ordered = /^\s*\d+[.、]\s+/.test(line); const items: ReactNode[] = [];
      const pattern = ordered ? /^\s*\d+[.、]\s+/ : /^\s*[-*]\s+/;
      while (i < lines.length && pattern.test(lines[i]!)) items.push(<li key={i}>{inline(lines[i++]!.replace(pattern, ""))}</li>);
      blocks.push(ordered ? <ol key={start}>{items}</ol> : <ul key={start}>{items}</ul>); continue;
    }
    blocks.push(<p key={i}>{inline(line.replace(/^>\s?/, ""))}</p>); i++;
  }
  return <>
    <div className={`ask-answer${streaming ? " is-streaming" : ""}`}>{blocks}</div>
    {citedEvidence.length > 0 && <details className="ask-sources">
      <summary><span>参考来源 <span className="ask-source-count">{citedEvidence.length}</span></span><span>查看出处</span></summary>
      <p className="ask-source-note">来源与回答关联，新闻事实仍以原始报道为准。</p>
      <ol>{citedEvidence.map((e) => <li id={`${prefix}-source-${e.id}`} key={e.id} tabIndex={-1}>
        <span className="ask-source-number">{e.id}</span><div><p className="ask-source-title">{e.unavailable ? "来源已不可用" : e.title ?? "参考资料"}</p>
          {!e.unavailable && <><p className="ask-source-meta">{e.sourceName ?? (e.kind?.includes("explain") ? "GAMEHOT 机制说明" : "GAMEHOT")}<span>{dateLabel(e.publishedAt)}</span></p>
          <div className="ask-source-links">{e.siteUrl && <SourceLink href={e.siteUrl} allowed={allowed}>站内阅读</SourceLink>}{e.originalUrl && <SourceLink href={e.originalUrl} allowed={allowed}>查看原文 ↗</SourceLink>}</div></>}
        </div></li>)}</ol>
    </details>}
  </>;
}
