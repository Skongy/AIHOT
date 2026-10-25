// Real format regression: Minecraft's UTF-16 RSS uses Atom-namespaced links, not RSS <link>.
import "./setup.ts";
import assert from "node:assert/strict";
import http from "node:http";
import { readFileSync } from "node:fs";
import { after, test } from "node:test";
import { config, REPO_ROOT } from "@aihot/backend/config";
import { fetchRss } from "@aihot/backend/sources/rss";
import { extractFromUrl } from "@aihot/backend/content/extract";
import { unsupportedConfig } from "@aihot/backend/sources/config-keys";
import { admitListing } from "@aihot/backend/sources/filters";
import type { Candidate, SourceRow } from "@aihot/backend/sources/types";
import path from "node:path";

const pack = JSON.parse(readFileSync(path.join(REPO_ROOT, "industry/sources.json"), "utf8"));
const source = (id: string): SourceRow => pack.sources.find((s: SourceRow) => s.id === id);
const root = "https://www.minecraft.net/en-us/article/";
const body = "The official update improves the game and documents compatibility changes for players. ".repeat(12);
const xml = (prefix: string, uri: string, links: string, itemNamespace = "") => `<?xml version="1.0" encoding="utf-16"?><rss version="2.0" xmlns:${prefix}="${uri}"><channel><title>Minecraft</title><item ${itemNamespace}><title>Minecraft Preview 26.70.21</title><description>Official preview patch notes.</description><pubDate>Tue, 20 Oct 2026 15:08:00 Z</pubDate>${links}</item></channel></rss>`;
const atom = "http://www.w3.org/2005/Atom";
const agents: Array<{ url: string; agent: string | undefined }> = [];
const server = http.createServer((req, res) => {
  agents.push({ url: req.url!, agent: req.headers["user-agent"] });
  if (req.url === "/article") {
    res.setHeader("content-type", "text/html");
    return res.end(`<html><head><title>Official Minecraft preview</title></head><body><article><h1>Official Minecraft preview</h1><p>${body}</p></article></body></html>`);
  }
  res.setHeader("content-type", "application/rss+xml; charset=utf-16");
  const prefix = req.url === "/renamed" ? "custom" : "a10";
  const links = req.url === "/self" ? `<${prefix}:link rel="self" href="https://www.minecraft.net/feed.xml"/>`
    : `<${prefix}:link rel="self" href="https://www.minecraft.net/feed.xml"/><${prefix}:link href="${root}preview"/>`;
  const uri = req.url === "/wrong-namespace" ? "https://example.org/not-atom" : atom;
  const rssLink = req.url === "/standard" ? `<link>${root}standard</link>` : "";
  const shadow = req.url === "/shadow" ? 'xmlns:a10="https://example.org/not-atom"' : "";
  const output = req.url === "/xbox" ? `<?xml version="1.0" encoding="utf-16"?><rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><item><title>Gameplay update</title><link>https://news.xbox.com/en-us/game-update/</link><category>Great Games</category><content:encoded><![CDATA[<p>${body}</p><script>bad()</script>]]></content:encoded></item></channel></rss>`
    : xml(prefix, uri, rssLink + links, shadow);
  res.end(Buffer.from(output, "utf16le"));
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const previous = config.allowPrivateNetworkFetch;
config.allowPrivateNetworkFetch = true;
after(async () => { config.allowPrivateNetworkFetch = previous; await new Promise<void>((resolve) => server.close(() => resolve())); });
async function read(url: string, id = "rss-minecraft") {
  const original = source(id);
  return (await fetchRss({ ...original, config: { ...original.config, feedUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}${url}` } }, { force: true })).candidates;
}

test("Minecraft UTF-16 and differently named Atom link prefixes produce a dated article URL", async () => {
  for (const url of ["/minecraft", "/renamed"]) {
    const items = await read(url);
    assert.equal(items.length, 1);
    assert.equal(items[0]!.url, root + "preview");
    assert.equal(items[0]!.publishedAt?.toISOString(), "2026-10-20T15:08:00.000Z");
    assert.equal(items[0]!.bodyStatus, "pending", "a short feed teaser is not the original body");
  }
});
test("RSS links retain priority and unrelated, shadowed or self-only namespace links are excluded", async () => {
  assert.equal((await read("/standard"))[0]!.url, root + "standard");
  for (const url of ["/self", "/wrong-namespace", "/shadow"]) assert.deepEqual(await read(url), [], url);
});
test("Xbox full RSS articles are preserved and sanitized without a page request", async () => {
  const items = await read("/xbox", "rss-xbox-wire");
  assert.equal(items[0]!.bodyStatus, "ok");
  assert.equal(items[0]!.bodyText, body.trim());
  assert.doesNotMatch(items[0]!.bodyHtml!, /script|bad\(\)/);
  assert.equal(admitListing(items, source("rss-xbox-wire")).length, 1);
  assert.equal(admitListing([{ ...items[0]!, categories: ["Games"] }], source("rss-xbox-wire")).length, 0);
});
test("source filters retain game news while excluding the observed non-news and promotion cases", () => {
  const candidate = (url: string, title: string): Candidate => ({ url, title });
  const nintendo = source("rss-nintendo-jp");
  const kept = candidate("https://www.nintendo.com/jp/topics/article/test", "新作ゲーム発売のお知らせ");
  assert.deepEqual(admitListing([kept, candidate("https://www.nintendo.co.jp/jobs/recruit/event/", "採用イベント"), candidate("https://www.nintendo.com/jp/character/splatoon/gallery/", "ギャラリー更新")], nintendo), [kept]);
  const game = candidate("https://www.4gamers.com.tw/news/detail/1/game", "Steam新作遊戲發售");
  assert.deepEqual(admitListing([game, candidate(game.url, "歌手演唱會精選影片")], source("rss-4gamers-tw")), [game]);
  const preview = candidate(root + "preview", "Minecraft Preview 26.70.21");
  assert.deepEqual(admitListing([preview, candidate(root + "market", "Marketplace Spotlight: new packs")], source("rss-minecraft")), [preview]);
});

test("Minecraft's compatibility agent is used for RSS and body reads, and unsafe values are refused", async () => {
  assert.equal(agents.find((a) => a.url === "/minecraft")?.agent, "Mozilla/5.0");
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/article`;
  assert.equal((await extractFromUrl(url, "test:official-body", undefined, source("rss-minecraft")))?.via, "readability");
  assert.equal(agents.find((a) => a.url === "/article")?.agent, "Mozilla/5.0");
  assert.deepEqual(unsupportedConfig("rss", { userAgent: "bad\r\nHeader: value" }), ["userAgent"]);
  assert.deepEqual(unsupportedConfig("rss", { userAgent: "" }), ["userAgent"]);
});
