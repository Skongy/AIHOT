import assert from "node:assert/strict";
import { createServer } from "node:http";
import { before, after, test } from "node:test";
import { chromium, expect, type Browser } from "@playwright/test";
import type { TopicPage } from "@aihot/contracts/site";
import { startWebServer, type WebServer } from "./web-server.ts";

const at = "2026-10-24T08:00:00Z";
const api = createServer((req, res) => {
  const path = new URL(req.url!, "http://fixture").pathname;
  res.setHeader("content-type", "application/json");
  if (path === "/api/site/meta") return res.end(JSON.stringify({ changelogVersion: null }));
  const slug = /^\/api\/site\/topics\/(slay-the-spire-2|gta-6)$/.exec(path)?.[1];
  if (slug) {
    const name = slug === "gta-6" ? "GTA 6" : "杀戮尖塔 2";
    const data: TopicPage = {
      topic: { slug, name, group: "company", groupName: "游戏", definition: `《${name}》的版本更新与相关新闻。`, brand: null, total: 1, recent: 1, poolTotal: 12, indexable: false, latest: { at, title: `${name} 最新消息` } },
      modules: {}, page: 1, pageCount: 1, pageSize: 20,
      items: [{ id: "topic-fixture", title: `${name} 最新消息`, summary: "游戏的最新开发进展与版本消息。", reason: null, source: { name: "测试来源" }, publishedAt: at, timelineAt: at, category: "updates", tags: [], score: 65, selected: true, channel: "news", x: null }],
    };
    // Even an old cached response must not revive the removed store card.
    return res.end(JSON.stringify({ ...data, steam: { name: "Store card must not render", headerImage: "/unwanted-cover.jpg", storeUrl: "https://store.steampowered.com/app/2868840/" } }));
  }
  res.statusCode = 404; res.end("{}");
});
let web: WebServer, browser: Browser;
before(async () => {
  web = await startWebServer(api);
  browser = await chromium.launch(process.env.ASK_TEST_CHROME_PATH ? { executablePath: process.env.ASK_TEST_CHROME_PATH } : { channel: "chromium" });
});
after(async () => { await browser?.close(); await web?.stop(); });

for (const theme of ["light", "dark"] as const) test(`${theme}: old and new game topics use the same compact news layout on desktop and phone`, async () => {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: "reduce" });
    try {
      await page.addInitScript((theme) => { localStorage.setItem("aihot-theme", theme); sessionStorage.setItem("gamehot-intro-seen-v1", "1"); }, theme);
      await page.route("https://fonts.googleapis.com/**", (route) => route.abort());
      const coverRequests: string[] = [];
      page.on("request", (request) => { if (request.url().endsWith("unwanted-cover.jpg")) coverRequests.push(request.url()); });
      for (const [slug, name] of [["slay-the-spire-2", "杀戮尖塔 2"], ["gta-6", "GTA 6"]]) {
        await page.goto(web.origin + "/topics/" + slug);
        await expect(page.getByRole("heading", { name: `${name} 最新动态`, exact: true })).toBeVisible();
        await expect(page.getByText(`${name} 最新消息`, { exact: true })).toBeVisible();
        await expect(page.getByText("Store card must not render")).toHaveCount(0);
        await expect(page.getByRole("link", { name: /在 Steam 查看/ })).toHaveCount(0);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      }
      assert.deepEqual(coverRequests, []);
    } finally { await page.close(); }
  }
});
