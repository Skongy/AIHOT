import { beijingDate, beijingMidnight, addDays } from "@aihot/contracts/time";
import type { AdminAnalytics } from "@aihot/contracts/analytics";
import { sql } from "../db.ts";

export async function analyticsOverview(value = "30", now = new Date()): Promise<AdminAnalytics> {
  if (!["7", "30", "90"].includes(value)) throw Object.assign(new Error("时间范围仅支持 7、30 或 90 天"), { statusCode: 400 });
  const days = Number(value) as 7 | 30 | 90, today = beijingDate(now), start = addDays(today, 1 - days);
  const todayStart = beijingMidnight(today), end = beijingMidnight(addDays(today, 1)), rangeStart = beijingMidnight(start);
  return sql.begin("isolation level repeatable read read only", async db => {
    const [summary] = await db<AdminAnalytics["summary"][]>`SELECT
      count(*) FILTER (WHERE day = ${today}::date)::int AS dau,
      count(*) FILTER (WHERE day = ${addDays(today, -1)}::date)::int AS yesterday,
      count(DISTINCT visitor_key) FILTER (WHERE day >= ${addDays(today, -6)}::date)::int AS wau,
      count(DISTINCT visitor_key)::int AS mau,
      coalesce(sum(pv) FILTER (WHERE day = ${today}::date),0)::int AS pv,
      (SELECT count(*)::int FROM analytics_visitors WHERE first_seen_at >= ${todayStart} AND first_seen_at < ${end}) AS "newVisitors"
      FROM analytics_days WHERE day >= ${addDays(today, -29)}::date AND day <= ${today}::date`;
    const [coverage] = await db`SELECT least(
      (SELECT min(applied_at) FROM schema_migrations WHERE name = '0075_analytics_visitors.sql'),
      (SELECT min(first_seen_at) FROM analytics_visitors)) AS started`;
    const startedAt = coverage.started ? new Date(coverage.started).toISOString() : now.toISOString();
    const trend = await db<AdminAnalytics["trend"]>`SELECT d.day::date::text AS date,
      CASE WHEN d.day < ${beijingDate(new Date(startedAt))}::date THEN NULL ELSE count(a.visitor_key)::int END AS active,
      CASE WHEN d.day < ${beijingDate(new Date(startedAt))}::date THEN NULL ELSE count(a.visitor_key) FILTER
        (WHERE (v.first_seen_at AT TIME ZONE 'Asia/Shanghai')::date = d.day)::int END AS "newVisitors"
      FROM generate_series(${start}::date,${today}::date,interval '1 day') d(day)
      LEFT JOIN analytics_days a ON a.day = d.day
      LEFT JOIN analytics_visitors v USING(visitor_key) GROUP BY d.day ORDER BY d.day`;
    const modules = await db<AdminAnalytics["modules"]>`SELECT module,count(DISTINCT visitor_key)::int AS visitors,sum(pv)::int AS pv
      FROM analytics_modules WHERE day BETWEEN ${start}::date AND ${today}::date GROUP BY module ORDER BY visitors DESC,pv DESC,module`;
    const [audience] = await db<AdminAnalytics["audience"][]>`SELECT count(*)::int AS total,
      count(*) FILTER(WHERE v.first_seen_at >= ${rangeStart} AND v.first_seen_at < ${end})::int AS "newVisitors",
      count(*) FILTER(WHERE v.first_seen_at < ${rangeStart})::int AS returning
      FROM analytics_visitors v WHERE EXISTS (SELECT 1 FROM analytics_days d WHERE d.visitor_key = v.visitor_key AND d.day BETWEEN ${start}::date AND ${today}::date)`;
    // One attribution per visitor in the selected range; distribution totals equal the range UV.
    const attribution = await db`SELECT source,device,count(*)::int AS visitors FROM (
      SELECT DISTINCT ON(visitor_key) visitor_key,source,device FROM analytics_days
      WHERE day BETWEEN ${start}::date AND ${today}::date ORDER BY visitor_key,day
    ) first_visits GROUP BY source,device`;
    const group = (key: "source" | "device") => {
      const totals = new Map<string, number>();
      for (const row of attribution) totals.set(row[key], (totals.get(row[key]) ?? 0) + row.visitors);
      const rows = [...totals].map(([label, visitors]) => ({ label, visitors })).sort((a, b) => b.visitors - a.visitors || a.label.localeCompare(b.label));
      return key === "source" && rows.length > 8 ? [...rows.slice(0, 8), { label: "其他来源", visitors: rows.slice(8).reduce((n, r) => n + r.visitors, 0) }] : rows;
    };
    return { days, today, start, generatedAt: now.toISOString(), startedAt, summary, trend, modules, audience, sources: group("source"), devices: group("device") };
  });
}
