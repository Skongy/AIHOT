// Dynamic article shells must not discard publisher-supplied bodies or attach another article's text.
import "./setup.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { after, test } from "node:test";
import { config } from "@aihot/backend/config";
import { extractFromUrl } from "@aihot/backend/content/extract";
import { feedBody, officialBody } from "@aihot/backend/content/public-body";
import type { SourceRow } from "@aihot/backend/sources/types";

const { MockAgent, getGlobalDispatcher, setGlobalDispatcher } = createRequire(new URL("../packages/backend/package.json", import.meta.url))("undici");
const previousDispatcher = getGlobalDispatcher();
const mock = new MockAgent();
mock.disableNetConnect();
setGlobalDispatcher(mock);
const previousPrivate = config.allowPrivateNetworkFetch;
const previousProxy = config.egressProxyUrl;
config.allowPrivateNetworkFetch = true;
config.egressProxyUrl = null;
after(async () => { config.allowPrivateNetworkFetch = previousPrivate; config.egressProxyUrl = previousProxy; setGlobalDispatcher(previousDispatcher); await mock.close(); });

const body = "官方公告明确列出了本次更新的地图、玩法与稳定性调整，并提供完整的详细说明。".repeat(12);
const steamUrl = "https://store.steampowered.com/news/app/730/view/1234567890123456789";
const feedUrl = "https://store.steampowered.com/feeds/news/app/730/?l=schinese";
const source: SourceRow = { id: "steam-fixture", name: "Steam", kind: "rss", tier: "T1", participation_mode: "editorial", first_party: true, interval_minutes: 60, enabled: false, cursor: null, fail_count: 0, config: { feedUrl, summaryIsBody: true } };
const feed = `<rss><channel><item><title>Other announcement</title><link>https://store.steampowered.com/news/app/730/view/9999</link><description><![CDATA[<p>${"无关的另一篇文章。".repeat(80)}</p>]]></description></item><item><title>Requested announcement</title><link>${steamUrl}</link><description><![CDATA[<p>${body}</p><script>bad()</script>]]></description></item></channel></rss>`;
let feedHits = 0;
mock.get("https://store.steampowered.com").intercept({ path: "/feeds/news/app/730/?l=schinese" }).reply(() => { feedHits++; return { statusCode: 200, data: feed, responseOptions: { headers: { "content-type": "application/rss+xml" } } }; }).persist();

test("Steam full RSS descriptions recover exactly the requested body without reading a dynamic page", async () => {
  const got = await extractFromUrl(steamUrl, "test:steam", undefined, source);
  assert.equal(got?.via, "feed");
  assert.equal(got?.text, body);
  assert.ok(!got?.html.includes("script"));
  assert.ok(!got?.text.includes("无关的另一篇"));
  assert.equal(source.enabled, false, "reading an existing body does not resume source collection");
});

test("a feed without the requested article never supplies another item's text", async () => {
  assert.equal(await feedBody(steamUrl.replace(/\d+$/, "8888"), source), null);
});

test("a failed feed still permits the ordinary article extractor", async () => {
  mock.get("https://publisher.example").intercept({ path: "/feed" }).reply(503, "unavailable");
  mock.get("https://publisher.example").intercept({ path: "/article" }).reply(200, `<html><body><article><h1>Official update</h1><p>${body}</p></article></body></html>`, { headers: { "content-type": "text/html" } });
  const got = await extractFromUrl("https://publisher.example/article", "test:feed-fallback", undefined, { ...source, config: { feedUrl: "https://publisher.example/feed", summaryIsBody: true } });
  assert.equal(got?.via, "readability");
  assert.ok(got?.text.includes(body));
});

for (const [id, resultId, expected] of [["14514250113535829185", "14514250113535829185", true], ["14514250113535829186", "different", false], ["14514250113535829187", Number("14514250113535829187"), false]] as const) {
  test(`official CMC body requires an exact unrounded document identity (${id})`, async () => {
    const path = `/cmc/zmMcnContentInfo?r0=json&source=web_pc&type=0&docid=${id}`;
    mock.get("https://apps.game.qq.com").intercept({ path }).reply(200, { status: 1, data: { result: { iDocID: resultId, sContent: `<p>${body}</p><script>bad()</script>`, sIdxTime: "2026-10-24 15:34:23" } } });
    const got = await officialBody(`https://lol.qq.com/news/detail.shtml?docid=${id}`);
    assert.equal(!!got, expected);
    if (got) { assert.equal(got.via, "source-api"); assert.ok(!got.html.includes("script")); assert.equal(got.publishedAt?.toISOString(), "2026-10-24T07:34:23.000Z"); }
  });
}

test("unrecognized hosts and video pages never use publisher API/feed recovery", async () => {
  assert.equal(await officialBody("https://lol.qq.com.evil.example/news/detail.shtml?docid=123"), null);
  const before = feedHits;
  assert.equal(await extractFromUrl("https://www.youtube.com/watch?v=COJAZQM1aeQ", "test:video", undefined, source), null);
  assert.equal(feedHits, before);
});

test("Steam source definitions preserve full descriptions independently of collection enablement", () => {
  const pack = JSON.parse(readFileSync(new URL("../industry/sources.json", import.meta.url), "utf8"));
  for (const s of pack.sources) {
    if (s.config.feedUrl?.startsWith("https://store.steampowered.com/feeds/news/")) assert.equal(s.config.summaryIsBody, true, s.id);
  }
});
