import { createHash } from "node:crypto";
import { isbot } from "isbot";
import { beijingDate } from "@aihot/contracts/time";
import { analyticsModule } from "@aihot/contracts/analytics";
import { sql } from "../db.ts";
import { referrerOrigin } from "./visits.ts";

export function visitorKey(value: unknown): string | null {
  return typeof value === "string" && /^[a-f0-9]{32}$/.test(value) ? createHash("sha256").update("gamehot-analytics-v1:" + value).digest("hex") : null;
}
export function deviceOf(userAgent: string): "PC" | "移动端" | "其他" {
  if (/mobile|android|iphone|ipad|ipod/i.test(userAgent)) return "移动端";
  return /windows|macintosh|linux|x11|cros/i.test(userAgent) ? "PC" : "其他";
}
export function humanBrowser(userAgent: string): boolean { return !!userAgent && !isbot(userAgent); }
export function trafficSource(value: unknown, siteUrl: string): string {
  const origin = referrerOrigin(value);
  if (!origin || origin === new URL(siteUrl).origin) return "直接访问 / 未提供";
  // Only a hostname, never a path, query, port, username or campaign token.
  return new URL(origin).hostname.toLowerCase().slice(0, 256);
}

/** Three bounded indexed upserts; no raw IP, URL, cookie, account or conversation content. */
export async function recordActivity(input: { visitor: unknown; path: string; userAgent: string; referrer: unknown; siteUrl: string }, now = new Date()) {
  const key = visitorKey(input.visitor), module = analyticsModule(input.path);
  if (!key || !module || !humanBrowser(input.userAgent)) return false;
  const day = beijingDate(now), device = deviceOf(input.userAgent), source = trafficSource(input.referrer, input.siteUrl);
  await sql.begin(async db => {
    await db`INSERT INTO analytics_visitors (visitor_key,first_seen_at,last_seen_at) VALUES (${key},${now},${now})
      ON CONFLICT (visitor_key) DO UPDATE SET first_seen_at = least(analytics_visitors.first_seen_at, excluded.first_seen_at),
        last_seen_at = greatest(analytics_visitors.last_seen_at, excluded.last_seen_at)`;
    await db`INSERT INTO analytics_days (day,visitor_key,source,device) VALUES (${day},${key},${source},${device})
      ON CONFLICT (day,visitor_key) DO UPDATE SET pv = analytics_days.pv + 1`;
    await db`INSERT INTO analytics_modules (day,visitor_key,module) VALUES (${day},${key},${module})
      ON CONFLICT (day,visitor_key,module) DO UPDATE SET pv = analytics_modules.pv + 1`;
  });
  return true;
}

export async function pruneAnalytics(now = new Date()) {
  const day = beijingDate(new Date(now.getTime() - 89 * 86400000));
  return sql.begin(async db => {
    const modules = await db`DELETE FROM analytics_modules WHERE day < ${day}::date`;
    const days = await db`DELETE FROM analytics_days WHERE day < ${day}::date`;
    const visitors = await db`DELETE FROM analytics_visitors WHERE last_seen_at < ${new Date(now.getTime() - 365 * 86400000)}
      AND NOT EXISTS (SELECT 1 FROM analytics_days d WHERE d.visitor_key = analytics_visitors.visitor_key)`;
    return { modules: modules.count, days: days.count, visitors: visitors.count };
  });
}
