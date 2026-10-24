import assert from "node:assert/strict";
import { createServer } from "node:http";
import { before, after, test } from "node:test";
import { chromium, expect, type Browser } from "@playwright/test";
import { startWebServer, type WebServer } from "./web-server.ts";

let web: WebServer;
let browser: Browser;
let cover: string | null = null;
let spark: Array<number | null> = [1, 4, 8, 6];
const api = createServer((req, res) => {
  const path = new URL(req.url!, "http://local").pathname;
  if (path === "/api/test/cover.svg") {
    res.setHeader("content-type", "image/svg+xml");
    return res.end('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><rect width="800" height="500" fill="#403b37"/></svg>');
  }
  if (path === "/api/test/broken.jpg") {
    res.statusCode = 502;
    res.setHeader("content-type", "text/plain");
    return res.end("upstream image failed");
  }
  res.setHeader("content-type", "application/json");
  if (path === "/api/site/meta") return res.end(JSON.stringify({ changelogVersion: "fixture" }));
  if (path === "/api/site/hot") return res.end(JSON.stringify({
    computedAt: null, windowHours: 48, entries: [{
      rank: 1, story: { publicId: "hot-fixture", title: "无畏契约发布新赛季调整说明" },
      heat: 100, trend: "up", trendPct: 10, badges: [], participantCount: 0,
      sourceCount: 1, sourceNames: ["赛事官方"], participants: [], spark,
      summary: "官方介绍地图调整方向。", latest: null,
      cover: cover ? { url: cover, width: 800, height: 500 } : null,
    }],
  }));
  res.statusCode = 404;
  res.end("{}");
});

before(async () => {
  web = await startWebServer(api);
  browser = await chromium.launch(process.env.ASK_TEST_CHROME_PATH
    ? { executablePath: process.env.ASK_TEST_CHROME_PATH } : { channel: "chromium" });
});
after(async () => { await browser?.close(); await web?.stop(); });

test("lead cover falls back to existing heat panel, preserving failed HTTP status", async () => {
  for (const path of ["/api/test/cover.svg", "/api/test/broken.jpg", null]) {
    cover = path;
    const context = await browser.newContext({ reducedMotion: "reduce" });
    try {
      await context.addInitScript(() => sessionStorage.setItem("gamehot-intro-seen-v1", "1"));
      const page = await context.newPage();
      await page.route("https://fonts.googleapis.com/**", (route) => route.abort());
      const failure = path?.endsWith("broken.jpg")
        ? page.waitForResponse((res) => res.url().endsWith("broken.jpg")) : null;
      await page.goto(web.origin + "/hot");
      const lead = page.locator("article").first();
      if (path?.endsWith("cover.svg")) {
        await expect(lead.locator("img")).toBeVisible();
        await expect.poll(() => lead.locator("img").evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
        await expect(lead.getByText("24 小时热度", { exact: true })).toHaveCount(0);
      } else {
        if (failure) assert.equal((await failure).status(), 502);
        await expect(lead.locator("img")).toHaveCount(0);
        await expect(lead.getByText("24 小时热度", { exact: true })).toBeVisible();
      }
    } finally { await context.close(); }
  }
});

test("failed cover with insufficient heat data leaves a full-width text layout", async () => {
  cover = "/api/test/broken.jpg";
  spark = [null, null, 2];
  const page = await browser.newPage();
  try {
    await page.route("https://fonts.googleapis.com/**", (route) => route.abort());
    await page.goto(web.origin + "/hot");
    const lead = page.locator("article").first();
    await expect(lead.locator("img")).toHaveCount(0);
    await expect(lead.getByText("24 小时热度", { exact: true })).toHaveCount(0);
    await expect(lead.getByRole("link", { name: "无畏契约发布新赛季调整说明" })).toBeVisible();
    assert.equal(await lead.locator("div.grid").evaluate((e) => getComputedStyle(e).gridTemplateColumns.split(" ").length), 1);
  } finally { await page.close(); }
});

test("a cover that failed before hydration also falls back", async () => {
  cover = "/api/test/broken.jpg";
  spark = [1, 4, 8, 6];
  const page = await browser.newPage();
  let release!: () => void;
  const ready = new Promise<void>((resolve) => { release = resolve; });
  try {
    await page.route("**/assets/*.js", async (route) => { await ready; await route.continue(); });
    await page.route("https://fonts.googleapis.com/**", (route) => route.abort());
    const failure = page.waitForResponse((res) => res.url().endsWith("broken.jpg"));
    await page.goto(web.origin + "/hot", { waitUntil: "commit" });
    assert.equal((await failure).status(), 502);
    const lead = page.locator("article").first();
    await expect.poll(() => lead.locator("img").evaluate((img) => (img as HTMLImageElement).complete)).toBe(true);
    release();
    await expect(lead.locator("img")).toHaveCount(0);
    await expect(lead.getByText("24 小时热度", { exact: true })).toBeVisible();
  } finally { release(); await page.close(); }
});
