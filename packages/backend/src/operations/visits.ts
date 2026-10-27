import { isIP } from "node:net";
import { sql } from "../db.ts";

/** Query strings, fragments and admin/API paths never enter visitor records. */
export function visitPath(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return null;
  const path = value.split(/[?#]/, 1)[0]!;
  if (!path || path.length > 512 || /[\u0000-\u0020\u007f]/.test(path)) return null;
  let decoded: string;
  try { decoded = decodeURIComponent(path); } catch { return null; }
  if (/^\/(admin|api|assets)(\/|$)/i.test(decoded) || decoded.includes("\\") || decoded.split("/").some((p) => p === "." || p === "..")) return null;
  return path;
}

export function referrerOrigin(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 4096) return null;
  try {
    const url = new URL(value);
    return /^https?:$/.test(url.protocol) ? url.origin : null;
  } catch { return null; }
}

/** API is internal: the web server/proxy overwrites/appends the actual peer at the right edge. */
export function visitIp(forwarded: string | undefined, remote: string): string | null {
  const value = (forwarded?.split(",").at(-1)?.trim() || remote).replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/, "$1");
  return isIP(value) ? value : null;
}

export async function recordVisit(input: { ip: string; path: string; referrer: unknown; userAgent: string }) {
  await sql`INSERT INTO site_visits (ip, path, referrer_origin, user_agent)
    VALUES (${input.ip}::inet, ${input.path}, ${referrerOrigin(input.referrer)}, ${input.userAgent.slice(0, 512)})`;
}

export async function pruneVisits(now = new Date()) {
  const deleted = await sql`DELETE FROM site_visits WHERE visited_at < ${new Date(now.getTime() - 30 * 86400_000)}`;
  return deleted.count;
}
