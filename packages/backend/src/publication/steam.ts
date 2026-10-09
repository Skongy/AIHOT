// Public Steam store metadata for seed topic deep pages. Uses store appdetails JSON — no WebAPI key.
import type { SteamTopicPanel } from "@aihot/contracts/site";
import { guardedFetch, DEFAULT_UA } from "../lib/http-fetch.ts";
import { cachedByKey } from "../lib/cache.ts";

const APPDETAILS = "https://store.steampowered.com/api/appdetails";

interface RawAppdetails {
  success?: boolean;
  data?: {
    type?: string;
    name?: string;
    steam_appid?: number;
    short_description?: string;
    header_image?: string;
    developers?: string[];
    publishers?: string[];
    genres?: Array<{ description?: string }>;
    release_date?: { coming_soon?: boolean; date?: string };
    price_overview?: {
      currency?: string;
      initial?: number;
      final?: number;
      discount_percent?: number;
      final_formatted?: string;
    };
    is_free?: boolean;
    platforms?: { windows?: boolean; mac?: boolean; linux?: boolean };
    metacritic?: { score?: number; url?: string };
  };
}

/** Parse one appdetails payload into the reader-facing panel (null when unusable). */
export function parseSteamAppdetails(appId: number, body: unknown): SteamTopicPanel | null {
  if (!body || typeof body !== "object") return null;
  const root = body as Record<string, RawAppdetails>;
  const entry = root[String(appId)];
  if (!entry?.success || !entry.data) return null;
  const d = entry.data;
  if (d.type && d.type !== "game" && d.type !== "dlc") return null;
  const name = (d.name ?? "").trim();
  if (!name) return null;
  const price = d.is_free
    ? { free: true as const, label: "免费", discountPercent: 0 }
    : d.price_overview?.final_formatted
      ? {
          free: false as const,
          label: d.price_overview.final_formatted,
          discountPercent: Math.max(0, Math.floor(d.price_overview.discount_percent ?? 0)),
        }
      : null;
  const platforms = d.platforms
    ? [
        ...(d.platforms.windows ? ["Windows"] : []),
        ...(d.platforms.mac ? ["macOS"] : []),
        ...(d.platforms.linux ? ["Linux"] : []),
      ]
    : [];
  return {
    appId,
    name,
    shortDescription: (d.short_description ?? "").trim() || null,
    headerImage: (d.header_image ?? "").trim() || null,
    developers: (d.developers ?? []).map((s) => s.trim()).filter(Boolean).slice(0, 6),
    publishers: (d.publishers ?? []).map((s) => s.trim()).filter(Boolean).slice(0, 6),
    genres: (d.genres ?? []).map((g) => (g.description ?? "").trim()).filter(Boolean).slice(0, 8),
    releaseDate: d.release_date?.date?.trim() || null,
    comingSoon: !!d.release_date?.coming_soon,
    price,
    platforms,
    metacriticScore: typeof d.metacritic?.score === "number" ? d.metacritic.score : null,
    storeUrl: `https://store.steampowered.com/app/${appId}/?l=schinese`,
  };
}

async function fetchSteamAppdetails(appId: number): Promise<SteamTopicPanel | null> {
  try {
    const url = `${APPDETAILS}?${new URLSearchParams({ appids: String(appId), l: "schinese", cc: "cn" })}`;
    const res = await guardedFetch(url, {
      timeoutMs: 12_000,
      maxBytes: 2 * 1024 * 1024,
      headers: { "user-agent": DEFAULT_UA, accept: "application/json" },
    });
    if (res.status !== 200) return null;
    return parseSteamAppdetails(appId, JSON.parse(res.text()) as unknown);
  } catch {
    return null;
  }
}

/** Cached public store panel; failures cache as null briefly so a flaky Steam does not hammer the page. */
const steamPanel = cachedByKey(
  (appId: number) => String(appId),
  fetchSteamAppdetails,
  { freshMs: 60 * 60_000, maxStaleMs: 6 * 60 * 60_000, maxKeys: 32 },
);

export function loadSteamTopicPanel(appId: number | null | undefined): Promise<SteamTopicPanel | null> {
  if (appId == null || !Number.isInteger(appId) || appId <= 0) return Promise.resolve(null);
  // Database tests set AIHOT_SKIP_STEAM so topic pages stay hermetic (fixtures cover parsing).
  if (process.env.AIHOT_SKIP_STEAM === "1") return Promise.resolve(null);
  return steamPanel(appId);
}
