// Radar's only public projection, including the evidence it may use. No network/model work on reads.
import { sql } from "../db.ts";
import { listedCondition } from "./scope.ts";
import { proxiedImage } from "../media/imgproxy.ts";
import type { RadarEvent, RadarEvidence, RadarMonth } from "@aihot/contracts/radar";

export async function radarNews(name: string, day: string): Promise<RadarEvidence[]> {
  if (name.startsWith("Steam App ") || name.length < 4) return [];
  const pattern = "%" + name.replace(/[\\%_]/g, "\\$&") + "%";
  const rows = await sql`SELECT p.article_id, p.title, p.summary, p.url FROM publications p
    WHERE ${listedCondition(new Date())} AND p.channel = 'news'
      AND p.timeline_at BETWEEN ${day}::date - interval '7 days' AND ${day}::date + interval '3 days'
      AND (p.title ILIKE ${pattern} OR p.original_title ILIKE ${pattern}) ORDER BY p.timeline_at DESC LIMIT 5`;
  return rows.map(r => ({ articleId: r.article_id, label: r.title, note: r.summary ?? "", url: r.url }));
}
export async function radarSteamLinks(): Promise<number[]> {
  const rows = await sql`SELECT p.url, p.summary FROM publications p WHERE ${listedCondition(new Date())}
    AND p.timeline_at > now() - interval '7 days' AND (p.url LIKE '%store.steampowered.com/app/%' OR p.summary LIKE '%store.steampowered.com/app/%') ORDER BY p.timeline_at DESC LIMIT 100`;
  return [...new Set(rows.flatMap(r => [...`${r.url} ${r.summary ?? ""}`.matchAll(/https:\/\/store\.steampowered\.com\/app\/(\d+)(?:\/|\b)/g)].map(m => Number(m[1]))))].filter(id => Number.isSafeInteger(id) && id > 0).slice(0, 30);
}
export async function loadRadarMonth(month: string): Promise<RadarMonth> {
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("Invalid radar month");
  const rows = await sql`SELECT e.*, g.name, g.cover_url FROM radar_events e JOIN radar_games g USING (appid)
    WHERE e.event_day >= ${month + "-01"}::date AND e.event_day < ${month + "-01"}::date + interval '1 month'
    ORDER BY e.event_day DESC, e.peak DESC LIMIT 300`;
  const events: RadarEvent[] = [];
  const articleIds = [...new Set(rows.flatMap(row => (row.evidence as RadarEvidence[]).flatMap(e => e.articleId ? [e.articleId] : [])))];
  const now = new Date();
  // Recheck all cited reports once, rather than issuing one visibility query per event.
  const visible = articleIds.length ? new Set((await sql`SELECT p.article_id FROM publications p WHERE p.article_id = ANY(${articleIds}) AND ${listedCondition(now)}`).map(r => r.article_id)) : new Set<string>();
  for (const row of rows) {
    const evidence = row.evidence as RadarEvidence[];
    const current = evidence.filter(e => !e.articleId || visible.has(e.articleId));
    const date = new Date(row.event_day).toISOString().slice(0, 10);
    events.push({ id: row.id, appid: row.appid, name: row.name, zh: row.name, date, genre: row.origin === "historical" ? "历史回溯" : "持续监控",
      kind: row.kind, status: row.status, baseline: row.baseline, baselineDays: row.baseline_days, peak: row.peak,
      rankBefore: null, rankAfter: row.kind === "launch" ? row.proof.launch?.qualification?.at(-1)?.rank ?? null : null, coverage: new Set((row.points as Array<{ at: string }>).map(p => p.at.slice(0, 13))).size >= 20 ? "complete" : "partial", points: row.points,
      headline: row.kind === "launch" ? "发售 14 天内进入 Steam 在线 Top 100，已由多次榜单记录核验。" : row.status === "confirmed" ? "此前低关注，在线人数持续显著增长。" : "发现增长信号，仍需更多记录确认。",
      reason: current.length === evidence.length ? row.reason : null,
      evidence: [{ label: row.origin === "historical" ? "SteamData 历史小时记录" : "Steam 官方在线记录", url: row.proof.source, note: "统计依据；不单独证明爆火原因。历史响应及统计依据已归档。" }, ...current],
      coverUrl: proxiedImage(row.cover_url, "card"), source: row.origin, detectedAt: new Date(row.detected_at).toISOString(), timezone: "Asia/Shanghai",
      ...(row.kind === "launch" && row.proof.launch ? { launch: { releaseDay: row.proof.launch.releaseDay, qualifiedAt: row.proof.launch.qualifiedAt, peak: row.proof.launch.peak, peakDay: row.proof.launch.peakDay } } : {}) });
  }
  const coverage = await sql`SELECT day::text AS date, count(*)::int AS games, sum(samples)::int AS samples FROM radar_daily
    WHERE day >= ${month + "-01"}::date AND day < ${month + "-01"}::date + interval '1 month' GROUP BY day ORDER BY day`;
  const [status] = await sql`SELECT
    (SELECT max(finished_at) FROM job_runs WHERE job = 'radar.execute.live' AND status = 'ok') AS success,
    (SELECT max(started_at) FROM job_runs WHERE job = 'radar.execute.live') AS attempt,
    (SELECT count(*)::int FROM radar_games) AS tracked`;
  return { month, events, coverage: coverage.map(r => ({ date: r.date, games: r.games, samples: r.samples })),
    status: { lastSuccess: status.success?.toISOString() ?? null, lastAttempt: status.attempt?.toISOString() ?? null,
      healthy: !!status.success && Date.now() - status.success.getTime() < 45 * 60000, tracked: status.tracked } };
}
