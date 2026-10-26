import assert from "node:assert/strict";
import { createServer } from "node:http";
import { before, after, test } from "node:test";
import { chromium, expect, type Browser } from "@playwright/test";
import type { FeedItemSummary } from "@aihot/contracts/site";
import { startWebServer, type WebServer } from "./web-server.ts";

const at = "2026-10-26T07:34:00.000Z";
const item: FeedItemSummary = {
  id: "image-fixture", title: "《三角洲行动》新赛季公布地图调整与玩法更新，开发团队回应玩家反馈",
  summary: "新赛季将调整部分地图路线与战术装备，并优化匹配体验。开发团队介绍了更新安排，也回应了近期玩家关注的问题。",
  reason: "整理赛季更新内容与上线安排，方便玩家了解值得体验的变化。",
  source: { name: "游戏官方" }, publishedAt: at, timelineAt: at,
  category: "new-games", tags: [], score: 80, selected: true, channel: "news", x: null,
};
let web: WebServer;
let browser: Browser;
const api = createServer((req, res) => {
  const url = new URL(req.url!, "http://local");
  if (url.pathname === "/api/test/cover.svg") {
    res.setHeader("content-type", "image/svg+xml");
    return res.end('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><rect width="800" height="500" fill="#3b5550"/><path d="M0 500 400 80 800 500" fill="#7a9685"/></svg>');
  }
  if (url.pathname === "/api/test/broken.jpg") {
    res.statusCode = 502;
    return res.end("upstream failed");
  }
  res.setHeader("content-type", "application/json");
  if (url.pathname === "/api/site/meta") return res.end('{"changelogVersion":null}');
  if (url.pathname === "/api/site/timeline") {
    const category = url.searchParams.get("category");
    const image = { url: "/api/test/cover.svg", width: 800, height: 500 };
    const cover = category ? { ...image, url: "/api/test/broken.jpg", srcSet: "/api/test/cover.svg 336w" } : image;
    const rows = [
      { ...item, cover },
      { ...item, id: "broken-fixture", cover: { ...cover, url: "/api/test/broken.jpg" } },
      { ...item, id: "no-image-fixture", cover: null },
    ];
    return res.end(JSON.stringify({
      filters: { channel: "all", category, tag: null },
      cards: rows.map(i => ({ key: i.id, anchorAt: at, item: i, group: null })),
      nextCursor: null, hot: null, dayCounts: { "2026-10-26": 3 },
    }));
  }
  res.statusCode = 404; res.end("{}");
});

before(async () => {
  web = await startWebServer(api);
  browser = await chromium.launch(process.env.ASK_TEST_CHROME_PATH
    ? { executablePath: process.env.ASK_TEST_CHROME_PATH } : { channel: "chromium" });
});
after(async () => { await browser?.close(); await web?.stop(); });

test("news previews stay compact in both themes and collapse failed/missing pictures", async () => {
  for (const width of [1440, 768, 390]) for (const theme of ["light", "dark"]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    try {
      await context.addInitScript(theme => {
        sessionStorage.setItem("gamehot-intro-seen-v1", "1");
        localStorage.setItem("aihot-theme", theme);
      }, theme);
      const page = await context.newPage();
      await page.route("https://fonts.googleapis.com/**", r => r.abort());
      const failure = page.waitForResponse(r => r.url().endsWith("broken.jpg"));
      await page.goto(web.origin);
      const card = page.locator('[data-item-id="image-fixture"]');
      const cover = card.locator(".feed-cover");
      await expect(cover).toBeVisible();
      await expect.poll(() => cover.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
      assert.equal((await failure).status(), 502);
      await expect(page.locator('[data-item-id="broken-fixture"] .feed-cover')).toHaveCount(0);
      await expect(page.locator('[data-item-id="no-image-fixture"] .feed-cover')).toHaveCount(0);
      const img = (await cover.boundingBox())!;
      const title = (await card.locator("h3").boundingBox())!;
      assert.ok(title.x + title.width <= img.x, "image must sit beside, not overlap the headline");
      assert.equal(Math.round(img.width), width >= 961 ? 176 : width >= 640 ? 128 : 88);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await card.getByRole("button", { name: "收藏", exact: true }).click();
      await expect(card.getByRole("button", { name: "取消收藏", exact: true })).toBeVisible();
      if (width === 1440) {
        await page.getByRole("link", { name: "新游", exact: true }).click();
        await expect(cover).toHaveAttribute("srcset", "/api/test/cover.svg 336w");
        await expect.poll(() => cover.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
        await expect(page.locator('[data-item-id="broken-fixture"] .feed-cover')).toBeVisible();
      }
      const target = (await cover.boundingBox())!;
      await page.mouse.click(target.x + target.width / 2, target.y + target.height / 2);
      await expect(page).toHaveURL(/\/items\/image-fixture$/);
    } finally { await context.close(); }
  }
});

test("a picture that fails before hydration is removed when client code starts", async () => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  try {
    await context.addInitScript(() => sessionStorage.setItem("gamehot-intro-seen-v1", "1"));
    const page = await context.newPage();
    await page.route("https://fonts.googleapis.com/**", r => r.abort());
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    await page.route(/\.js(?:\?|$)/, async route => { await blocked; await route.continue(); });
    try {
      await page.goto(web.origin, { waitUntil: "commit" });
      const broken = page.locator('[data-item-id="broken-fixture"] .feed-cover');
      await expect(broken).toHaveCount(1);
      await expect.poll(() => broken.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth === 0)).toBe(true);
    } finally { release(); }
    await expect(page.locator('[data-item-id="broken-fixture"] .feed-cover')).toHaveCount(0);
    await expect(page.locator('[data-item-id="image-fixture"] .feed-cover')).toBeVisible();
  } finally { await context.close(); }
});
