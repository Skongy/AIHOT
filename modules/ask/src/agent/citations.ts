/** Strip model reasoning tags so they never reach the user (closed or unclosed). */
export function stripThinkTags(text: string): string {
  let out = text.replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, "");
  // Unclosed opening tag: drop from the tag through end (avoids mid-stream flash).
  out = out.replace(/<think\b[^>]*>[\s\S]*$/i, "");
  out = out.replace(/<\/think>/gi, "");
  return out;
}

/**
 * Strip provider tool-call markup that leaked into assistant content
 * (MiniMax emits `<minimax:tool_call><invoke>…` as text when not using API tool_calls).
 */
export function stripToolCallMarkup(text: string): string {
  let out = text.replace(/<(?:minimax:)?tool_call\b[^>]*>[\s\S]*?<\/(?:minimax:)?tool_call>/gi, "");
  out = out.replace(/<(?:minimax:)?tool_call\b[^>]*>[\s\S]*$/i, "");
  out = out.replace(/<\/(?:minimax:)?tool_call>/gi, "");
  // Bare invoke / parameter blocks (and orphan closers) if wrapper was partial.
  out = out.replace(/<invoke\b[^>]*>[\s\S]*?<\/invoke>/gi, "");
  out = out.replace(/<invoke\b[^>]*>[\s\S]*$/i, "");
  out = out.replace(/<\/invoke>/gi, "");
  out = out.replace(/<parameter\b[^>]*>[\s\S]*?<\/parameter>/gi, "");
  out = out.replace(/<parameter\b[^>]*>[\s\S]*$/i, "");
  out = out.replace(/<\/parameter>/gi, "");
  return out;
}

/** Think tags + tool-call XML — anything that must never appear in a visible answer. */
export function stripAskModelText(text: string): string {
  return stripToolCallMarkup(stripThinkTags(text));
}

const LEAK_OPEN_PREFIXES = [
  "<think",
  "</think",
  "<minimax:tool_call",
  "</minimax:tool_call",
  "<tool_call",
  "</tool_call",
  "<invoke",
  "</invoke",
  "<parameter",
  "</parameter",
];

/** Drop a trailing incomplete open/close tag that could grow into a known leak tag. */
function withholdIncompleteLeakPrefix(text: string): string {
  const m = /<\/?[a-zA-Z0-9:_-]*$/.exec(text);
  if (!m || m.index === undefined) return text;
  const partial = m[0]!.toLowerCase();
  if (partial === "<" || partial === "</") return text.slice(0, m.index);
  if (LEAK_OPEN_PREFIXES.some((p) => p.startsWith(partial))) return text.slice(0, m.index);
  return text;
}

/**
 * For streaming: strip think + tool-call blocks, and withhold a trailing incomplete
 * leak-tag prefix so split tags across deltas never briefly appear.
 */
export function stripThinkTagsStreaming(accumulated: string): string {
  let out = stripAskModelText(accumulated);
  out = withholdIncompleteLeakPrefix(out);
  out = out.replace(/<$/, "");
  return out;
}

export interface XmlToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

function coerceXmlParamValue(raw: string): unknown {
  const v = raw.trim();
  if (v === "true") return true;
  if (v === "false") return false;
  if (v === "null") return null;
  if (/^-?\d+$/.test(v)) return Number(v);
  if (/^-?\d+\.\d+$/.test(v)) return Number(v);
  if ((v.startsWith("{") && v.endsWith("}")) || (v.startsWith("[") && v.endsWith("]"))) {
    try {
      return JSON.parse(v);
    } catch {
      /* keep string */
    }
  }
  return v;
}

function paramsFromInvokeBody(body: string): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  for (const m of body.matchAll(/<parameter\b[^>]*\bname\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/parameter>/gi)) {
    const name = (m[1] ?? m[2] ?? m[3] ?? "").trim();
    if (!name) continue;
    params[name] = coerceXmlParamValue(m[4] ?? "");
  }
  return params;
}

function pushInvokeMatches(inner: string, toolCalls: XmlToolCall[], startIndex: number): number {
  let n = startIndex;
  for (const inv of inner.matchAll(/<invoke\b[^>]*\bname\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/invoke>/gi)) {
    const name = (inv[1] ?? inv[2] ?? inv[3] ?? "").trim();
    if (!name) continue;
    n += 1;
    toolCalls.push({
      id: `xml_tc_${n}`,
      type: "function",
      function: { name, arguments: JSON.stringify(paramsFromInvokeBody(inv[4] ?? "")) },
    });
  }
  return n;
}

/**
 * Parse MiniMax-style XML tool calls from assistant content.
 * Official API usually returns structured tool_calls; some models still emit XML as text.
 */
export function extractXmlToolCalls(text: string): { toolCalls: XmlToolCall[]; remainder: string } {
  const toolCalls: XmlToolCall[] = [];
  let n = 0;
  let remainder = text.replace(/<(?:minimax:)?tool_call\b[^>]*>([\s\S]*?)<\/(?:minimax:)?tool_call>/gi, (_m, inner: string) => {
    n = pushInvokeMatches(inner, toolCalls, n);
    return "";
  });
  // Bare <invoke> outside a wrapper (partial leak / truncated wrapper).
  remainder = remainder.replace(/<invoke\b[^>]*\bname\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/invoke>/gi, (_m, d1: string, d2: string, d3: string, body: string) => {
    const name = (d1 ?? d2 ?? d3 ?? "").trim();
    if (!name) return "";
    n += 1;
    toolCalls.push({
      id: `xml_tc_${n}`,
      type: "function",
      function: { name, arguments: JSON.stringify(paramsFromInvokeBody(body ?? "")) },
    });
    return "";
  });
  // Drop leftover unclosed wrappers / orphan tags from remainder.
  remainder = stripToolCallMarkup(remainder);
  return { toolCalls, remainder };
}

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

/** Safe markdown render helper for ask answers: strip think/tool-call/images/iframes; only allow hrefs in allowlist. */
export function sanitizeAskMarkdown(md: string, allowedUrls: Set<string>): string {
  let out = stripAskModelText(md);
  out = out.replace(/!\[[^\]]*\]\([^)]*\)/g, ""); // no images
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
