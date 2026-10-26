import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir } from "node:fs/promises";
import { before, after, test } from "node:test";
import { chromium, expect, type Browser } from "@playwright/test";
import { startWebServer, type WebServer } from "./web-server.ts";
import type { RadarEvent } from "@aihot/contracts/radar";
let browser: Browser, web: WebServer;
const fixture: RadarEvent = { id: "123-2026-10-10", appid: 123, name: "测试游戏 · Test Game", zh: "测试游戏", date: "2026-10-10", genre: "历史回溯", kind: "watch", status: "suspected", baseline: 500, baselineDays: 5, peak: 5000, rankBefore: null, rankAfter: null, coverage: "partial", points: [{ at: "2026-10-10T01:00:00Z", count: 1000 }, { at: "2026-10-10T02:00:00Z", count: 5000 }, { at: "2026-10-10T05:00:00Z", count: 3000 }], headline: "发现增长信号，仍需更多记录确认。", reason: null, evidence: [{ label: "测试来源", url: "https://store.steampowered.com/app/123/", note: "测试统计依据" }], coverUrl: "/api/test/broken.jpg", source: "historical", detectedAt: "2026-10-26T12:00:00Z", timezone: "Asia/Shanghai" };
const api = createServer((req, res) => {
  const u = new URL(req.url!, "http://local"); res.setHeader("content-type", "application/json");
  if (u.pathname === "/api/site/meta") return res.end(JSON.stringify({ changelogVersion: "fixture" }));
  if (u.pathname === "/api/radar/month") { const month = u.searchParams.get("month") ?? "2026-10";
    return res.end(JSON.stringify({ month, events: month === "2026-10" ? [fixture] : [], coverage: month === "2026-10" ? [{ date: "2026-10-10", games: 10, samples: 240 }] : [], status: { healthy: true, lastSuccess: "2026-10-26T12:00:00Z", lastAttempt: "2026-10-26T12:00:00Z", tracked: 10 } })); }
  res.statusCode = u.pathname === "/api/test/broken.jpg" ? 502 : 404; res.end("{}");
});
before(async () => { web = await startWebServer(api); browser = await chromium.launch(process.env.ASK_TEST_CHROME_PATH ? { executablePath: process.env.ASK_TEST_CHROME_PATH } : { channel: "chromium" }); });
after(async () => { await browser?.close(); await web?.stop(); });
test("A2 month navigation, inline detail, truthful chart interaction and empty months work in both themes at four widths", async () => {
  await mkdir(".taste-skill/radar-live", { recursive: true });
  for (const width of [1440, 768, 390, 320]) for (const theme of ["light", "dark"] as const) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, colorScheme: theme, reducedMotion: "reduce" });
    try {
      await context.addInitScript(t => { localStorage.setItem("aihot-theme", t); sessionStorage.setItem("gamehot-intro-seen-v1", "1"); }, theme);
      const page = await context.newPage(), errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
      await page.route("https://fonts.googleapis.com/**", route => route.abort());
      await page.goto(web.origin + "/radar?month=2026-10");
      await expect(page.locator(".month-day")).toHaveCount(31);
      await expect(page.locator(".monthly-event")).toHaveCount(1);
      await expect(page.locator(".cover-fallback").first()).toBeVisible();
      await page.screenshot({ path: `.taste-skill/radar-live/pre-${width}-${theme}.png`, fullPage: true });
      const overflow = await page.evaluate(() => ({width: innerWidth, scroll: document.documentElement.scrollWidth, elements: [...document.querySelectorAll(".radar-app *")].filter(e=>e.getBoundingClientRect().right > innerWidth + 1).slice(0,8).map(e=>({tag:e.tagName,cls:e.className,right:e.getBoundingClientRect().right}))}));
      assert.equal(overflow.scroll <= overflow.width, true, JSON.stringify({width,theme,overflow}));
      await page.screenshot({ path: `.taste-skill/radar-live/${width}-${theme}.png`, fullPage: true });
      await page.locator('.month-day').nth(9).click();
      await expect(page.locator(".month-focus-line")).toContainText("10 月 10 日");
      await page.locator(".monthly-hit").click();
      await expect(page.locator(".monthly-file")).toBeVisible();
      await expect(page.locator(".radar-app").getByRole("dialog")).toHaveCount(0);
      await expect(page.locator(".file-disclaimer")).toContainText("历史回溯");
      await expect(page.locator(".file-disclaimer")).toContainText("仍在观察");
      await page.locator(".file-trajectory svg").focus(); await page.keyboard.press("Home");
      await expect(page.locator(".radar-chart-readout")).toContainText("09:00");
      await expect(page.locator(".radar-chart-readout")).toContainText("1,000");
      await page.screenshot({ path: `.taste-skill/radar-live/detail-${width}-${theme}.png`, fullPage: true });
      await page.getByRole("button", { name: "返回月度事件流" }).click();
      await page.getByRole("button", { name: "上个月" }).click();
      await expect(page.locator(".month-day")).toHaveCount(30);
      await expect(page.locator(".monthly-empty")).toBeVisible();
      assert.equal(await page.evaluate(() => scrollY), 0);
      await page.locator(".month-day").first().click();
      await expect(page.locator(".quiet-day")).toContainText("暂无可靠记录");
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  }
});
