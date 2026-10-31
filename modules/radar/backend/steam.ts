import { sql } from "@aihot/backend/db";
import { guardedFetch } from "@aihot/backend/lib/http-fetch";
import { parseRetryAfterSeconds } from "@aihot/backend/providers/receipts";
import { z } from "zod";

const allowedHosts = new Set(["api.steampowered.com", "store.steampowered.com", "api.steamdata.dev"]);
export class RadarHttpError extends Error {
  readonly status: number;
  constructor(host: string, status: number) { super(`Radar upstream ${host} HTTP ${status}`); this.status = status; }
}
/** Durable shared request budget includes retries and backfill, and survives worker restarts. */
export async function publicJson(url: string): Promise<unknown> {
  const target = new URL(url);
  if (target.protocol !== "https:" || !allowedHosts.has(target.hostname)) throw new Error("Unsupported radar data host");
  const id = await sql.begin(async tx => {
    await tx`SELECT pg_advisory_xact_lock(726138012)`;
    const [budget] = await tx`SELECT count(*)::int AS n FROM radar_requests WHERE at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`;
    if (budget.n >= 8000) throw new Error("Radar daily HTTP budget exhausted");
    const [limited] = await tx`SELECT 1 FROM radar_requests WHERE host = ${target.hostname} AND retry_at > now() LIMIT 1`;
    const recent = await tx`SELECT status, error FROM radar_requests WHERE host = ${target.hostname} AND at > now() - interval '15 minutes' ORDER BY at DESC, id DESC LIMIT 3`;
    // Missing app histories are normal 404s, not a failure of the whole upstream host.
    if (limited || (recent.length === 3 && recent.every(r => (r.status !== null && r.status >= 500) || (r.error && (r.status === null || r.status === 200))))) throw new Error("Radar upstream cooling down");
    const [row] = await tx`INSERT INTO radar_requests (host, path) VALUES (${target.hostname}, ${target.pathname}) RETURNING id`;
    return row.id;
  });
  try {
    const response = await guardedFetch(url, { timeoutMs: 15000, maxBytes: 2 * 1024 * 1024, maxRedirects: 2 });
    const wait = parseRetryAfterSeconds(response.headers.get("retry-after")) ?? 3600;
    const retryAt = response.status === 429 ? new Date(Date.now() + Math.max(60, wait) * 1000) : null;
    await sql`UPDATE radar_requests SET status = ${response.status}, retry_at = ${retryAt}, finished_at = now() WHERE id = ${id}`;
    if (response.status !== 200) throw new RadarHttpError(target.hostname, response.status);
    return JSON.parse(response.text());
  } catch (error) {
    await sql`UPDATE radar_requests SET error = ${String(error).slice(0, 300)}, finished_at = now() WHERE id = ${id}`;
    throw error;
  }
}
export const appSchema = z.object({ app_id: z.number().int().positive(), name: z.string().max(300).nullish().transform(value => value?.trim() ?? ""), header_image: z.string().nullish().transform(value => value ?? undefined), player_count: z.number().int().nonnegative().optional() });
export const listSchema = z.object({ apps: z.array(appSchema).max(100), total: z.number().int().nonnegative(), pages: z.number().int().nonnegative() });
export const historySchema = z.object({ app_id: z.number().int().positive(), resolution: z.literal("hour"), points: z.array(z.object({ t: z.number().int().positive(), player_count: z.number().int().nonnegative() })).max(2000) });
export const chartSchema = z.object({ response: z.object({ last_update: z.number().int().positive(), ranks: z.array(z.object({ appid: z.number().int().positive(), rank: z.number().int().positive(), concurrent_in_game: z.number().int().nonnegative() })).min(1).max(100) }) });
export function parseCurrent(value: unknown): number | null {
  const parsed = z.object({ response: z.object({ result: z.literal(1), player_count: z.number().int().nonnegative() }) }).safeParse(value);
  return parsed.success ? parsed.data.response.player_count : null;
}
export function safeCover(input: string | undefined): string | null {
  try { const u = new URL(input ?? ""); return u.protocol === "https:" && /(^|\.)steamstatic\.com$/.test(u.hostname) ? u.href : null; } catch { return null; }
}
/** Steam's news API still returns this legacy CDN hostname for official announcements. */
export function officialNewsUrl(input: string): string | null {
  try {
    const url = new URL(input);
    if (url.protocol !== "https:") return null;
    if (url.hostname === "steamstore-a.akamaihd.net" && /^\/news\/externalpost\/steam_community_announcements\/\d+\/?$/.test(url.pathname)) url.hostname = "store.steampowered.com";
    return ["store.steampowered.com", "steamcommunity.com", "www.steamcommunity.com"].includes(url.hostname) ? url.href : null;
  } catch { return null; }
}
