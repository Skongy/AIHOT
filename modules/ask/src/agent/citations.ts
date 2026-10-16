/** Citation check: [n] must be in registered evidence ids. No model call. */
export function checkCitations(answer: string, evidenceIds: number[]): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  const registered = new Set(evidenceIds);
  const seen = new Set<number>();
  for (const m of answer.matchAll(/\[(\d+)\]/g)) {
    const n = Number(m[1]);
    seen.add(n);
    if (!registered.has(n)) issues.push(`unregistered_citation:${n}`);
  }
  if (registered.size && !seen.size && answer.trim()) issues.push("missing_citations");
  // Bare http(s) URLs in the answer that are not a simple citation marker — flagged for degraded (links must come from evidence).
  for (const m of answer.matchAll(/https?:\/\/[^\s)\]>]+/g)) {
    issues.push(`raw_url:${m[0]!.slice(0, 80)}`);
  }
  return { ok: issues.length === 0, issues };
}

/** Safe markdown render helper for ask answers: strip images/iframes; only allow hrefs in allowlist. */
export function sanitizeAskMarkdown(md: string, allowedUrls: Set<string>): string {
  let out = md.replace(/!\[[^\]]*\]\([^)]*\)/g, ""); // no images
  out = out.replace(/<iframe[\s\S]*?<\/iframe>/gi, "");
  out = out.replace(/<img\b[^>]*>/gi, "");
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, text: string, href: string) => {
    const h = href.trim();
    if (isAllowedAskHref(h, allowedUrls)) {
      return `[${text}](${h})`;
    }
    return text; // unlink unregistered
  });
  // Neutralize raw URLs that aren't allowlisted: keep as text without making links (renderer responsibility).
  return out;
}

export function isAllowedAskHref(href: string, allowedUrls: Set<string>): boolean {
  if (!href || /[\s\\\u0000-\u001f]/.test(href) || href.startsWith("//")) return false;
  if (!(href.startsWith("/") || /^https?:\/\//i.test(href))) return false;
  return allowedUrls.has(href);
}
