// Read-only research data. Never sample a ranked search page to manufacture totals.
import { sql } from "../db.ts";
import { withSearchCapacity, searchTerms } from "./pool.ts";
import { askSourceFilter, matchFor, scopeFor, type AskItemsQuery } from "./ask.ts";
import { listedCondition, ownFactEvidenceCondition } from "./scope.ts";
import { loadItemDetail } from "./detail.ts";
import { resolveStory, v1Story } from "./stories.ts";
import { stripTags } from "../lib/text.ts";

export type ResearchQuery = Pick<AskItemsQuery, "queries" | "firstParty" | "source" | "mode" | "from" | "until">;
export const MAX_RESEARCH_REPORTS = 20_000;
export class ResearchInputError extends Error {}

export function validateResearchRange(query: ResearchQuery, now = new Date()) {
  if (!query.from || query.from >= query.until || query.until > now || query.until.getTime() - query.from.getTime() > 31 * 86400000) {
    throw new ResearchInputError("研究范围须为过去31天以内的一段有效时间，不能使用 all。");
  }
}

async function researchRead<T>(read: (db: typeof sql) => Promise<T>): Promise<T> {
  return withSearchCapacity(async (db) => {
    await db`SET LOCAL statement_timeout = '5000ms'`;
    return read(db as typeof sql);
  });
}

/** Exact totals over a bounded public set; wire copies count once as independent reporting. */
export async function newsStats(query: ResearchQuery, now = new Date()) {
  validateResearchRange(query, now);
  const rows = await researchRead((db) => db<{ id: string; fact: number | null; source: string; independent: string; official: boolean; fact_evidence: boolean }[]>`
    SELECT p.article_id AS id, p.fact_id AS fact, p.source_id AS source, p.first_party AS official,
      ${ownFactEvidenceCondition()} AS fact_evidence,
      CASE WHEN a.wire_fingerprint IS NOT NULL THEN 'wire:' || a.wire_fingerprint ELSE 'source:' || p.source_id END AS independent
    FROM publications p JOIN articles a ON a.id = p.article_id
    WHERE ${scopeFor(query.mode, now)} ${matchFor(query.queries)} ${askSourceFilter(query)}
      AND p.timeline_at >= ${query.from!} AND p.timeline_at < ${query.until}
    LIMIT ${MAX_RESEARCH_REPORTS + 1}`);
  if (rows.length > MAX_RESEARCH_REPORTS) throw new ResearchInputError("统计范围过大，请缩小日期或增加游戏名称；未返回抽样统计。");
  return {
    from: query.from!.toISOString(), until: query.until.toISOString(), asOf: now.toISOString(),
    reports: rows.length, facts: new Set(rows.filter(r => r.fact !== null && r.fact_evidence).map(r => r.fact)).size,
    sources: new Set(rows.map(r => r.source)).size, independentSources: new Set(rows.map(r => r.independent)).size,
    officialReports: rows.filter(r => r.official).length,
    scope: query.mode === "selected" ? "本站精选，按事实代表去重" : "本站全部公开动态",
    completeWithinScope: true, collectionCoverage: "unknown",
    note: "按站内时间精确统计，不是全网热度或玩家人数；sources是不同信源数，independentSources按本站通稿合并口径计算报道组，不等于不同媒体数或事实核实。采集覆盖完整性未知。",
    articleIds: rows.map(r => r.id),
  };
}

export async function searchEvents(query: ResearchQuery, limit = 10, now = new Date()) {
  validateResearchRange(query, now);
  const rows = await researchRead((db) => db<{ public_id: string; title: string; reports: number; latest: Date }[]>`
    SELECT st.public_id::text, st.title, count(DISTINCT p.article_id)::int AS reports, max(p.timeline_at) AS latest
    FROM publications p JOIN stories st ON st.id = p.story_id
    WHERE ${scopeFor(query.mode, now)} ${matchFor(query.queries)} ${askSourceFilter(query)}
      AND st.merged_into IS NULL AND ${ownFactEvidenceCondition()}
      AND p.timeline_at >= ${query.from!} AND p.timeline_at < ${query.until}
    GROUP BY st.id ORDER BY max(p.timeline_at) DESC, st.public_id LIMIT ${limit + 1}`);
  return { from: query.from!.toISOString(), until: query.until.toISOString(), asOf: now.toISOString(),
    hasMore: rows.length > limit, items: rows.slice(0, limit).map(r => ({ public_id: r.public_id, title: r.title,
      matchingReports: r.reports, latestAt: r.latest.toISOString(), siteUrl: `/story/${r.public_id}` })),
    note: "仅列匹配的公开事件，不是完整事件总数；matchingReports 是该查询范围内的匹配报道数。" };
}

export function attentionSeries(points: Array<{ hour: Date; heat: number }>, from: Date, until: Date) {
  const byHour = new Map(points.map(p => [p.hour.getTime(), Number(p.heat)]));
  const intervalHours = until.getTime() - from.getTime() > 72 * 3600000 ? 24 : 1;
  const buckets: Array<{ at: Date; heat: number | null }> = [];
  for (let start = Math.ceil(from.getTime() / 3600000) * 3600000; start < until.getTime(); start += intervalHours * 3600000) {
    const values: number[] = [];
    let complete = true;
    for (let hour = start; hour < Math.min(start + intervalHours * 3600000, until.getTime()); hour += 3600000) {
      const value = byHour.get(hour);
      if (value === undefined) complete = false;
      else values.push(value);
    }
    buckets.push({ at: new Date(start), heat: complete && values.length ? values.reduce((a,b)=>a+b,0)/values.length : null });
  }
  const baseline = buckets.find(p => p.heat !== null && p.heat > 0);
  const slots: Array<{ at: string; index: number | null }> = [];
  for (const bucket of buckets) {
    slots.push({ at: bucket.at.toISOString(), index: bucket.heat === null || !baseline ? null : Math.round(bucket.heat / baseline.heat! * 1000) / 10 });
  }
  return { points: slots, intervalHours, measuredHourlyPoints: byHour.size, availablePoints: slots.filter(p => p.index !== null).length, missingPoints: slots.filter(p => p.index === null).length,
    observationSufficient: slots.filter(p => p.index !== null).length >= 2,
    baselineAt: baseline?.at.toISOString() ?? null };
}

export async function attentionTrend(publicId: string, from: Date, until: Date, now = new Date()) {
  validateResearchRange({ queries: [], mode: "all", from, until }, now);
  let found = await resolveStory(publicId);
  if (found.kind === "merged") found = await resolveStory(found.target);
  const story = found.kind === "found" ? await v1Story(found.storyId) : null;
  if (!story || found.kind !== "found") return null;
  const points = await researchRead((db) => db<{ hour: Date; heat: number }[]>`
    SELECT hour, heat FROM story_heat_hourly WHERE story_id = ${found.storyId} AND complete
      AND hour >= ${from} AND hour < ${until} ORDER BY hour`);
  return { public_id: story.story.publicId, title: story.story.title, from: from.toISOString(), until: until.toISOString(),
    asOf: now.toISOString(), ...attentionSeries(points, from, until),
    note: "本站事件关注指数：首个非零完整观测点=100；超过72小时按24小时均值归并，组内缺测则整点为null，intervalHours标明粒度。不是全网热度、玩家人数或因果证据；不足两个有效点不判断趋势。" };
}

/** Select numbered public paragraph excerpts; long paragraphs retain the query-matching section. */
export function articlePassages(html: string, question = "", maxChars = 2400) {
  const paragraphs = html.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(?:p|div|li|h[1-6]|blockquote)>/gi, "$&\n").split(/\n+/)
    .map(s => stripTags(s).replace(/\s+/g, " ").trim()).filter(Boolean);
  const terms = searchTerms(question);
  const ranked = paragraphs.map((text, i) => ({ paragraph: i + 1, text,
    score: terms.reduce((sum, t) => sum + (text.toLowerCase().includes(t) ? 1 : 0), 0) }))
    .sort((a, b) => b.score - a.score || a.paragraph - b.paragraph);
  const selected: Array<{ paragraph: number; text: string; startOffset: number; truncated: boolean }> = [];
  let used = 0;
  for (const p of ranked) {
    if (used >= maxChars || selected.length >= 6) break;
    const budget = maxChars - used;
    const matchAt = terms.map(t => p.text.toLowerCase().indexOf(t)).filter(i => i >= 0).sort((a, b) => a - b)[0] ?? 0;
    const startOffset = p.text.length > budget ? Math.max(0, matchAt - 200) : 0;
    const text = p.text.slice(startOffset, startOffset + budget);
    selected.push({ paragraph: p.paragraph, text, startOffset, truncated: startOffset > 0 || text.length < p.text.length }); used += text.length;
  }
  return selected.sort((a, b) => a.paragraph - b.paragraph);
}

export async function readResearchArticle(id: string, question = "") {
  const detail = await loadItemDetail(id);
  if (detail.kind !== "found" || detail.item.readingMode === "summary-only") return null;
  const it = detail.item;
  const html = it.readingMode === "full" ? it.body?.zh || it.body?.original || "" : "";
  const [metadata] = await sql<{ first_party: boolean }[]>`SELECT first_party FROM publications WHERE article_id = ${id}`;
  return { article_id: id, title: it.title, summary: it.summary, source: it.source.name,
    sourceType: metadata?.first_party ? "官方来源" : "媒体报道", publishedAt: it.publishedAt, timelineAt: it.timelineAt,
    story: it.story, originalUrl: it.links.original,
    bodyStatus: html ? (it.body?.complete ? "complete" : "partial") : "unavailable",
    passages: articlePassages(html, question),
    note: "只返回站内允许公开的正文片段，不是整篇全文；正文缺失时只能使用摘要。段落编号不是来源引用编号。" };
}

/** Withdrawn evidence also invalidates aggregate snapshots that counted it. */
export async function researchSnapshotAvailable(ids: string[], now = new Date()) {
  if (ids.length > MAX_RESEARCH_REPORTS) return false;
  const [row] = await sql<{ count: number }[]>`SELECT count(*) AS count FROM publications p
    WHERE p.article_id = ANY(${ids}::text[]) AND ${listedCondition(now)}`;
  return Number(row?.count) === new Set(ids).size;
}
