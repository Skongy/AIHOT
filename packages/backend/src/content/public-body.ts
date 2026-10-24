// Public publisher data only: bounded feed reads and the same JSON endpoint the official page uses.
import type { ExtractedBody } from "./extract.ts";
import type { SourceRow } from "../sources/types.ts";
import { fetchRss } from "../sources/rss.ts";
import { guardedFetch } from "../lib/http-fetch.ts";
import { normalizeUrl } from "../lib/url.ts";
import { stripTags } from "../lib/text.ts";
import { parseLooseDate } from "../sources/dates.ts";
import { sanitizeBody, trimTrailingChrome } from "./sanitize.ts";

/** Never substitute the newest feed item for the requested article. */
export async function feedBody(url: string, source: SourceRow): Promise<ExtractedBody | null> {
  const target = normalizeUrl(url);
  if (!target) return null;
  const { candidates } = await fetchRss(source, { force: true });
  const item = candidates.find((candidate) => normalizeUrl(candidate.url) === target);
  if (!item?.bodyHtml || !item.bodyText || item.bodyStatus !== "ok") return null;
  return {
    html: item.bodyHtml, text: item.bodyText, via: "feed", publishedAt: item.publishedAt,
    images: (item.media ?? []).filter((m) => m.kind === "image").slice(0, 12).map((m) => ({ kind: "image", url: m.url, width: m.width ?? null, height: m.height ?? null })),
  };
}

/** Tencent's article pages render their body from CMC; the page HTML itself is a shell. */
export async function officialBody(url: string, utcOffset?: string): Promise<ExtractedBody | null> {
  const page = new URL(url);
  const hosts = new Set(["lol.qq.com", "val.qq.com", "vct.qq.com"]);
  if (page.protocol !== "https:" || page.port || !hosts.has(page.hostname)) return null;
  if (!/^(?:\/news\/detail\.shtml|\/news\.html|\/news_details\.html)$/.test(page.pathname)) return null;
  const id = page.searchParams.get("docid") ?? page.searchParams.get("docId");
  if (!id || !/^\d{1,24}$/.test(id)) return null;
  const endpoint = new URL("https://apps.game.qq.com/cmc/zmMcnContentInfo");
  endpoint.search = new URLSearchParams({ r0: "json", source: page.hostname === "lol.qq.com" ? "web_pc" : "val_gw", type: "0", docid: id }).toString();
  const response = await guardedFetch(endpoint.href, { headers: { accept: "application/json" }, timeoutMs: 12_000, maxBytes: 4 * 1024 * 1024 });
  if (response.status !== 200) return null;
  const payload = JSON.parse(response.text());
  const article = payload?.data?.result;
  // Keep 64-bit document IDs as strings; a rounded numeric ID is not proof of identity.
  if (payload.status !== 1 || String(article?.iDocID) !== id || typeof article?.sContent !== "string") return null;
  const html = trimTrailingChrome(sanitizeBody(article.sContent, url));
  const text = stripTags(html);
  if (text.length < 200) return null;
  return { html, text, images: [], via: "source-api", publishedAt: parseLooseDate(article.sIdxTime, utcOffset ?? "+08:00") };
}
