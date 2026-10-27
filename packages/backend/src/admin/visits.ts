import { isIP } from "node:net";
import { beijingDate, beijingMidnight, isValidDate } from "@aihot/contracts/time";
import type { AdminVisits, BeforeJson } from "@aihot/contracts/admin";
import { sql } from "../db.ts";

export async function listVisits(f: { date?: string; ip?: string; page?: string }): Promise<BeforeJson<AdminVisits>> {
  const date = f.date || beijingDate(new Date());
  const ip = f.ip?.trim() || null;
  const requestedPage = Number(f.page ?? 1);
  if (!isValidDate(date) || (ip && !isIP(ip)) || !Number.isSafeInteger(requestedPage) || requestedPage < 1 || requestedPage > 10000) {
    throw Object.assign(new Error("日期、IP 或页码格式不正确"), { statusCode: 400 });
  }
  const start = beijingMidnight(date);
  const end = new Date(start.getTime() + 86400_000);
  const [summary, rows] = await Promise.all([
    sql<{ views: number; ips: number }[]>`SELECT count(*)::int AS views, count(DISTINCT ip)::int AS ips FROM site_visits
      WHERE visited_at >= ${start} AND visited_at < ${end} AND (${ip}::inet IS NULL OR ip = ${ip}::inet)`,
    sql<BeforeJson<AdminVisits["rows"][number]>[]>`SELECT id, visited_at, host(ip) AS ip, path, referrer_origin, user_agent
      FROM site_visits WHERE visited_at >= ${start} AND visited_at < ${end} AND (${ip}::inet IS NULL OR ip = ${ip}::inet)
      ORDER BY visited_at DESC, id DESC LIMIT 51 OFFSET ${(requestedPage - 1) * 50}`,
  ]);
  return { date, ip, page: requestedPage, summary: summary[0]!, hasMore: rows.length > 50, rows: rows.slice(0, 50) };
}
