// Deterministic claim checks. The model may propose a quote; only this file decides the verdict.
// A legal citation number is not enough: the quote has to occur in the cited evidence text.
import { beijingDate, beijingTime } from "@aihot/contracts/time";

export type ClaimStatus = "supported" | "insufficient" | "disputed" | "contradicted" | "withdrawn";
export type ClaimKind = "fact" | "inference";
export type SourceType = "官方来源" | "媒体报道" | "未知";

export interface VerifiableEvidence {
  id: number;
  title?: string | null;
  kind?: string;
  /** Internal public object identifier used to ground later research steps. */
  objectId?: string | null;
  /** Tool that registered this evidence; shown only to the research executor. */
  toolName?: string | null;
  /** Story id attached to a report returned by get_story. */
  parentObjectId?: string | null;
  sourceName?: string | null;
  sourceType?: string | null;
  excerpt?: string | null;
  /** Public article text already shown on the item page. Quotes may match it; it is not a new fact. */
  bodyExcerpt?: string | null;
  publishedAt?: string | null;
  /** When the item entered the site timeline. This is not the event time. */
  timelineAt?: string | null;
  siteUrl?: string | null;
}

export interface ProposedClaim {
  text: string;
  kind: ClaimKind;
  evidenceIds: number[];
  quote: string;
  conflictsWith: number[];
  /** Model semantic review, independently constrained by quote/number/source checks below. */
  relevant?: boolean;
  entailed?: boolean;
}

export interface VerifiedClaim {
  index: number;
  text: string;
  kind: ClaimKind;
  status: ClaimStatus;
  evidenceIds: number[];
  quote: string;
  note: string;
}

export interface ReportTimelineItem {
  at: string;
  timelineAt?: string | null;
  /** A date written inside the source text. It is not the publication time. */
  mentioned?: string | null;
  title: string;
  evidenceId: number;
  sourceType: SourceType;
  credibility: "来源支持" | "来源报道但尚未核实";
}

export interface ReportedItem {
  id: number;
  title: string;
  sourceName: string | null;
  sourceType: SourceType;
  siteUrl: string | null;
  publishedAt: string | null;
  timelineAt: string | null;
  mentioned: string | null;
  excerpt: string | null;
}

export interface ReportHeatItem {
  label: string;
  value: string;
  evidenceId: number;
}

export interface ResearchReport {
  showTimeline: boolean;
  showCoverage: boolean;
  lead: string;
  summary: string[];
  timeline: ReportTimelineItem[];
  reported: ReportedItem[];
  coverage: { official: number; media: number; unknown: number; cited: number };
  comparison: Array<{ text: string; evidenceIds: number[] }>;
  heat: ReportHeatItem[];
  chart: Array<{ label: string; value: number; evidenceId: number }> | null;
  uncertainty: Array<{ status: ClaimStatus; text: string; note: string; evidenceIds: number[] }>;
  citations: Array<{ id: number; title: string; sourceName: string | null; sourceType: SourceType; siteUrl: string | null; publishedAt: string | null }>;
  claims: VerifiedClaim[];
}

const CAUSAL = /导致|因此|所以|致使|推动了|因为.{0,12}热度|热度.{0,12}(?:导致|上升|下降|因为)/;
const OFFICIAL_SAY = /官方(?:确认|宣布|表示|公布|称)/;
const HEAT_LABELS: Array<{ label: string; pattern: RegExp }> = [
  { label: "热榜名次", pattern: /热榜第\s*(\d+)\s*名/ },
  { label: "近 48 小时参与方", pattern: /近\s*48\s*h?\s*参与方[：:]\s*(\d+)/ },
  { label: "近 6 小时新增参与方", pattern: /近\s*6\s*h?\s*新增参与方[：:]\s*(\d+)/ },
  { label: "近 24 小时报道", pattern: /近\s*24\s*h?\s*报道[：:]\s*(\d+)/ },
  { label: "报道篇数", pattern: /报道篇数[：:]\s*(\d+)/ },
];

export function sourceTypeOf(value: string | null | undefined, firstParty?: unknown): SourceType {
  if (value === "官方来源" || value === "媒体报道" || value === "未知") return value;
  if (firstParty === true) return "官方来源";
  if (firstParty === false) return "媒体报道";
  return "未知";
}

function compact(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, "");
}

function hasWholeNumber(text: string, number: string): boolean {
  return new RegExp(`(?<!\\d)${number.replace(/\./g, "\\.")}(?!\\d)`).test(compact(text));
}

function evidenceText(item: VerifiableEvidence): string {
  return [item.title, item.excerpt, item.bodyExcerpt, item.sourceName].filter((part): part is string => !!part && part.trim().length > 0).join("\n");
}

function propositionText(value: string): string {
  return compact(value)
    .replace(/^(?:据|根据).{1,40}?(?:报道|公告|消息|官方发布|官方公告)[，,:：]?/, "")
    .replace(/^官方(?:称|表示|宣布|确认|公布)[，,:：]?/, "");
}

function citedItems(claim: { evidenceIds: number[] }, evidence: VerifiableEvidence[]): VerifiableEvidence[] {
  const known = new Map(evidence.map((item) => [item.id, item]));
  return claim.evidenceIds.flatMap((id) => {
    const item = known.get(id);
    return item ? [item] : [];
  });
}

export function parseClaims(text: string): ProposedClaim[] | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = (fenced?.[1] ?? text).trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let json: unknown;
  try { json = JSON.parse(raw.slice(start, end + 1)); }
  catch { return null; }
  if (!json || typeof json !== "object" || !Array.isArray((json as { claims?: unknown }).claims)) return null;
  const claims: ProposedClaim[] = [];
  for (const row of (json as { claims: unknown[] }).claims.slice(0, 8)) {
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    const claimText = typeof record.text === "string" ? record.text.trim().slice(0, 240) : "";
    const quote = typeof record.quote === "string" ? record.quote.trim().slice(0, 240) : "";
    if (!claimText) continue;
    const evidenceIds = Array.isArray(record.evidenceIds)
      ? [...new Set(record.evidenceIds.filter((id): id is number => Number.isInteger(id) && id > 0 && id < 100))]
      : [];
    const conflictsWith = Array.isArray(record.conflictsWith)
      ? [...new Set(record.conflictsWith.filter((id): id is number => Number.isInteger(id) && id >= 0 && id < 8))]
      : [];
    claims.push({
      text: claimText,
      kind: record.kind === "inference" ? "inference" : "fact",
      evidenceIds,
      quote,
      conflictsWith,
      relevant: typeof record.relevant === "boolean" ? record.relevant : undefined,
      entailed: typeof record.entailed === "boolean" ? record.entailed : undefined,
    });
  }
  return claims;
}

function yearsIn(text: string): Set<string> {
  return new Set(text.match(/20\d{2}/g) ?? []);
}

/** A supported sentence about another year is not an answer to this question. */
function missesAskedYear(question: string, claim: ProposedClaim, items: VerifiableEvidence[]): boolean {
  const asked = yearsIn(question);
  if (!asked.size) return false;
  const stated = yearsIn(`${claim.text}\n${claim.quote}`);
  if ([...stated].some((year) => asked.has(year))) return false;
  if ([...stated].some((year) => !asked.has(year))) return true;
  const published = new Set(items.flatMap((item) => {
    const year = item.publishedAt?.match(/20\d{2}/)?.[0];
    return year ? [year] : [];
  }));
  return published.size > 0 && ![...published].some((year) => asked.has(year));
}

export function assessClaims(proposed: ProposedClaim[], evidence: VerifiableEvidence[], question = ""): VerifiedClaim[] {
  const preliminary = proposed.map((claim, index) => assessOne(claim, index, evidence, question));
  for (const claim of preliminary) {
    const rivals = claim.index >= 0
      ? proposed[claim.index]?.conflictsWith.filter((other) => other !== claim.index && preliminary[other]) ?? []
      : [];
    if (!rivals.length) continue;
    const quoteFound = claim.status === "supported" || claim.status === "disputed";
    const rivalFound = rivals.some((other) => {
      const status = preliminary[other]?.status;
      return status === "supported" || status === "disputed";
    });
    if (quoteFound && rivalFound) {
      claim.status = "contradicted";
      claim.note = "与另一条已核到引文的主张互相矛盾，两条都不进入核心结论。";
      for (const other of rivals) {
        const rival = preliminary[other];
        if (!rival || (rival.status !== "supported" && rival.status !== "disputed")) continue;
        rival.status = "contradicted";
        rival.note = "与另一条已核到引文的主张互相矛盾，两条都不进入核心结论。";
      }
    }
  }
  return preliminary;
}

function boundClaim(claim: ProposedClaim, evidence: VerifiableEvidence[]): ProposedClaim {
  if (claim.evidenceIds.length) return claim;
  const quote = compact(claim.quote);
  if (quote.length < 12) return claim;
  const hits = evidence.filter((item) => compact(evidenceText(item)).includes(quote));
  return hits.length === 1 ? { ...claim, evidenceIds: [hits[0]!.id] } : claim;
}

function assessOne(claim: ProposedClaim, index: number, evidence: VerifiableEvidence[], question: string): VerifiedClaim {
  claim = boundClaim(claim, evidence);
  const items = citedItems(claim, evidence);
  const quote = compact(claim.quote);
  const base = { index, text: claim.text, kind: claim.kind, evidenceIds: items.map((item) => item.id), quote: claim.quote };
  if (claim.relevant === false) return { ...base, status: "withdrawn", note: "这条内容没有回答本轮问题，已排除。" };
  if (claim.entailed === false) return { ...base, status: "withdrawn", note: "引文没有支持这条结论的含义，已排除。" };
  if (claim.relevant !== true || claim.entailed !== true) {
    return { ...base, status: "insufficient", note: "尚未完成问题相关性与语义支持检查。" };
  }
  if (!items.length || !quote || !items.some((item) => compact(evidenceText(item)).includes(quote))) {
    return { ...base, status: "insufficient", note: items.length ? "引用的证据里没有这句原话，不能据此下结论。" : "没有对应的已登记证据。" };
  }
  if (CAUSAL.test(claim.text)) {
    return { ...base, kind: "inference", status: "withdrawn", note: "热度或时间上的同时出现不能写成因果关系，这条已从结论中移除。" };
  }
  if (claim.kind === "inference") {
    return { ...base, status: "withdrawn", note: "这是推测，不写入来源支持结论。" };
  }
  // Numeric publisher names (e.g. 17173) are attribution, not a factual value
  // that must occur in the quoted sentence. Keep the strict check for numbers
  // that are not part of any cited source's identity.
  const sourceIdentity = compact(items.map((item) => item.sourceName ?? "").join(" "));
  const missingNumber = [...claim.text.matchAll(/\d+(?:\.\d+)?/g)].map((match) => match[0]!)
    .find((number) => !hasWholeNumber(claim.quote, number) && !hasWholeNumber(sourceIdentity, number));
  if (missingNumber) {
    return { ...base, status: "insufficient", note: `结论中的数字 ${missingNumber} 没有出现在所引原话里。` };
  }
  if (missesAskedYear(question, claim, items)) {
    return { ...base, status: "insufficient", note: "这条结论对不上问题里的年份，不能写入来源支持结论。" };
  }
  // A model's entailed=true flag is not independent proof. Keep a claim in the
  // supported set only when its factual wording can be located verbatim in its quote.
  const proposition = propositionText(claim.text);
  if (!proposition || !quote.includes(proposition)) {
    return { ...base, status: "insufficient", note: `结论的事实表述${missingNumber ? `（数字 ${missingNumber}）` : ""}无法在所引原文中逐字定位，不能标记为来源支持。` };
  }
  if (OFFICIAL_SAY.test(claim.text) && !items.some((item) => sourceTypeOf(item.sourceType) === "官方来源")) {
    return { ...base, status: "disputed", note: "结论写成了官方表态，但所引证据没有官方来源。" };
  }
  const types = new Set(items.map((item) => sourceTypeOf(item.sourceType)));
  if (types.has("官方来源") && types.has("媒体报道") && !items.filter((item) => sourceTypeOf(item.sourceType) === "官方来源").some((item) => compact(evidenceText(item)).includes(quote))) {
    return { ...base, status: "disputed", note: "同一主张同时引用了官方和媒体，而这句原话只出现在媒体报道中。" };
  }
  return { ...base, status: "supported", note: "模型判断切题；事实表述在所引原文中逐字出现，数字、年份和来源检查通过。这不等于对现实事实的独立证实。" };
}

export function supplementQuery(claims: VerifiedClaim[], question: string): string | null {
  const claim = claims.find((item) => item.kind === "fact" && item.status === "insufficient" && !item.note.includes("逐字定位"));
  if (!claim) return null;
  const names = [...question.matchAll(/《([^》]{1,40})》/g)].map((match) => match[1]!.trim()).filter(Boolean);
  const text = claim.text.replace(/[？?。！!，,]/g, " ").replace(/\s+/g, " ").trim().slice(0, 40);
  const query = [...names, text].filter(Boolean).join(" ").slice(0, 80).trim();
  return query.length >= 2 ? query : null;
}

function heatOf(evidence: VerifiableEvidence[]): ReportHeatItem[] {
  const out: ReportHeatItem[] = [];
  const seen = new Set<string>();
  for (const item of evidence) {
    const text = evidenceText(item);
    for (const spec of HEAT_LABELS) {
      const match = spec.pattern.exec(text);
      if (!match) continue;
      const key = `${item.id}:${spec.label}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ label: spec.label, value: match[1]!, evidenceId: item.id });
    }
  }
  return out;
}

function chartOf(heat: ReportHeatItem[]): ResearchReport["chart"] {
  const groups = new Map<string, ReportHeatItem[]>();
  for (const item of heat) {
    const rows = groups.get(item.label) ?? [];
    rows.push(item);
    groups.set(item.label, rows);
  }
  for (const [label, rows] of groups) {
    const unique = new Map(rows.map((row) => [row.evidenceId, row]));
    if (unique.size < 2) continue;
    return [...unique.values()].map((row) => ({ label: `${label} · [${row.evidenceId}]`, value: Number(row.value), evidenceId: row.evidenceId }));
  }
  return null;
}

function clock(at: string): string {
  return `${beijingDate(at)} ${beijingTime(at)}`;
}

/** A date written in the source. Publication time stays on publishedAt. */
function mentionedWhen(text: string): string | null {
  return text.replace(/\s+/g, "").match(/20\d{2}年\d{1,2}月\d{1,2}日|\d{1,2}月\d{1,2}日/)?.[0] ?? null;
}

function coverageOf(items: VerifiableEvidence[]): { official: number; media: number; unknown: number } {
  const coverage = { official: 0, media: 0, unknown: 0 };
  for (const item of items) {
    const type = sourceTypeOf(item.sourceType);
    if (type === "官方来源") coverage.official += 1;
    else if (type === "媒体报道") coverage.media += 1;
    else coverage.unknown += 1;
  }
  return coverage;
}

function timeBits(item: { publishedAt?: string | null; timelineAt?: string | null; mentioned?: string | null }): string {
  const bits: string[] = [];
  if (item.publishedAt) bits.push(`报道发布 ${clock(item.publishedAt)}`);
  const skew = item.publishedAt && item.timelineAt ? Math.abs(Date.parse(item.timelineAt) - Date.parse(item.publishedAt)) : Number.POSITIVE_INFINITY;
  if (item.timelineAt && (!item.publishedAt || skew >= 60_000)) bits.push(`站内时间 ${clock(item.timelineAt)}`);
  if (item.mentioned) bits.push(`报道中写到 ${item.mentioned}，这不是报道发布时间`);
  return bits.join(" · ");
}

export function buildReport(
  question: string,
  claims: VerifiedClaim[],
  evidence: VerifiableEvidence[],
  opts: { unparsed?: boolean; incomplete?: boolean } = {},
): { markdown: string; report: ResearchReport } {
  const supported = claims.filter((claim) => claim.status === "supported" && claim.kind === "fact");
  const showTimeline = /时间线|进展|发展|经过|历程|何时|什么时候/.test(question);
  const showCoverage = /官方|媒体|来源|报道差异/.test(question);
  const shownIds = new Set(supported.flatMap((claim) => claim.evidenceIds));
  const shown = evidence.filter((item) => shownIds.has(item.id));
  const timeline = (showTimeline ? shown : [])
    .filter((item) => item.publishedAt)
    .map((item) => ({
      // The article title can state a fact this pass rejected. The line is only the supported sentences.
      at: item.publishedAt!,
      timelineAt: item.timelineAt ?? null,
      mentioned: mentionedWhen(supported.filter((claim) => claim.evidenceIds.includes(item.id)).map((claim) => claim.quote).join("\n")),
      title: supported.filter((claim) => claim.evidenceIds.includes(item.id)).map((claim) => claim.text).join("；"),
      evidenceId: item.id,
      sourceType: sourceTypeOf(item.sourceType),
      credibility: "来源支持" as const,
    }))
    .filter((item) => item.title)
    .sort((a, b) => a.at.localeCompare(b.at));
  const coverage = { ...coverageOf(evidence), cited: shown.length };
  const heat = heatOf(shown);
  const comparison = claims
    .filter((claim) => claim.status === "disputed" || claim.status === "contradicted")
    .map((claim) => ({ text: claim.text, evidenceIds: claim.evidenceIds }));
  const uncertainty = claims
    .filter((claim) => claim.status !== "supported" && claim.status !== "withdrawn")
    .map((claim) => ({ status: claim.status, text: claim.text, note: claim.note, evidenceIds: claim.evidenceIds }));
  const citations = shown.map((item) => ({
    id: item.id,
    title: item.title ?? item.kind ?? "资料",
    sourceName: item.sourceName ?? null,
    sourceType: sourceTypeOf(item.sourceType),
    siteUrl: item.siteUrl ?? null,
    publishedAt: item.publishedAt ?? null,
  }));
  const rejectedIds = new Set(claims.filter((claim) => claim.status === "withdrawn").flatMap((claim) => claim.evidenceIds));
  const reviewedIds = new Set(claims.flatMap((claim) => claim.evidenceIds));
  const reported = evidence.filter((item) => !shownIds.has(item.id) && !rejectedIds.has(item.id)
    && (!claims.length || reviewedIds.has(item.id))).map((item) => ({
    id: item.id,
    title: item.title ?? item.kind ?? "资料",
    sourceName: item.sourceName ?? null,
    sourceType: sourceTypeOf(item.sourceType),
    siteUrl: item.siteUrl ?? null,
    publishedAt: item.publishedAt ?? null,
    timelineAt: item.timelineAt ?? null,
    mentioned: mentionedWhen(evidenceText(item)),
    excerpt: (item.excerpt ?? "").trim().slice(0, 160) || null,
  }));
  const lead = !evidence.length
    ? "站内公开资料里没有检索到可以引用的报道，所以这次不能给出具体结论。"
    : [
        supported.length ? opts.incomplete ? "目前只能确认下面这些信息，仍不足以完整回答你的问题。" : "以下结论均可在所列来源中核对。" : "目前检索到的资料不足以可靠回答这个问题。",
        opts.unparsed
          ? "这次没能完成资料核对，暂时无法给出可靠结论。"
          : coverage.cited
            ? ""
            : "找到新闻不代表已经找到答案。",
      ].filter(Boolean).join("");
  const report: ResearchReport = {
    showTimeline,
    showCoverage,
    lead,
    summary: supported.map((claim) => `${claim.text}${claim.evidenceIds.length ? ` [${claim.evidenceIds.join("][")}]` : ""}`),
    timeline,
    reported,
    coverage,
    comparison,
    heat,
    chart: chartOf(heat),
    uncertainty,
    citations,
    claims,
  };
  const lines = [
    `# ${question.trim().slice(0, 80) || "深度研究报告"}`,
    "",
    lead,
    "",
    "## 核心结论",
    ...(report.summary.length ? report.summary.map((line) => `- ${line}`) : [opts.unparsed ? "这次没能核对出可靠结论。" : "目前没有足够证据支持结论。"]),
    "",
    ...(showTimeline && timeline.length ? ["## 报道时间",
    ...timeline.map((item) => `- ${timeBits({ ...item, publishedAt: item.at })} · ${item.credibility} · ${item.title} [${item.evidenceId}] · ${item.sourceType}`),
    ""] : []),
    ...(showCoverage ? ["## 官方与媒体",
    `这次检索到的资料中，官方来源 ${coverage.official} 条，媒体报道 ${coverage.media} 条，未能区分来源类型 ${coverage.unknown} 条。核心结论引用了其中 ${coverage.cited} 条。来源类型只说明材料出处，不等于事实已经核实。`,
    ""] : []),
    ...(reported.length ? [`另有 ${reported.length} 条检索结果暂不足以支持结论。`, ""] : []),
    ...(heat.length ? [
      "## 热度观察",
      ...heat.map((item) => `- ${item.label}：${item.value} [${item.evidenceId}]`),
      "这些数字只来自对应证据里的统计，不能据此断言热度变化的原因。",
      "",
    ] : []),
    "## 引用",
    ...(citations.length
      ? citations.map((item) => `- [${item.id}] ${item.title}${item.sourceName ? ` · ${item.sourceName}` : ""} · ${item.sourceType}`)
      : [evidence.length ? `没有可用于核心结论的资料。上面列出了检索到的 ${evidence.length} 条来源报道。` : "没有可用于回答的证据。"]),
  ];
  return { markdown: lines.join("\n"), report };
}
