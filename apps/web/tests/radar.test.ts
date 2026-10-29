import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { mkdir } from "node:fs/promises";
import { before, after, test } from "node:test";
import { chromium, expect, type Browser } from "@playwright/test";
import { startWebServer, type WebServer } from "./web-server.ts";
import type { RadarEvent } from "@aihot/contracts/radar";
let browser: Browser, web: WebServer;
const fixture: RadarEvent = { id: "123-2026-10-10", appid: 123, name: "测试游戏 · Test Game", zh: "测试游戏", date: "2026-10-10", genre: "历史回溯", kind: "watch", status: "suspected", baseline: 500, baselineDays: 5, peak: 5000, rankBefore: null, rankAfter: null, coverage: "partial", points: [{ at: "2026-10-10T01:00:00Z", count: 1000 }, { at: "2026-10-10T02:00:00Z", count: 5000 }, { at: "2026-10-10T05:00:00Z", count: 3000 }], headline: "发现增长信号，仍需更多记录确认。", reason: null, evidence: [{ label: "测试来源", url: "https://store.steampowered.com/app/123/", note: "测试统计依据" }], coverUrl: "/api/test/broken.jpg", source: "historical", detectedAt: "2026-10-26T12:00:00Z", timezone: "Asia/Shanghai" };
const launchFixture: RadarEvent = { ...fixture, id: "456-2026-08-10", appid: 456, name: "新游测试 · Launch Game", date: "2026-08-10", genre: "持续监控", kind: "launch", status: "confirmed", source: "live", baseline: null, baselineDays: 0, peak: 21000,
  points: [{ at: "2026-08-10T01:00:00Z", count: 19000 }, { at: "2026-08-10T01:15:00Z", count: 21000 }],
  headline: "发售 14 天内进入 Steam 在线 Top 100，已由多次榜单记录核验。", launch: { releaseDay: "2026-08-09", qualifiedAt: "2026-08-10T01:15:00Z", peak: 71000, peakDay: "2026-08-11" } };
const api = createServer((req, res) => {
  const u = new URL(req.url!, "http://local"); res.setHeader("content-type", "application/json");
  if (u.pathname === "/api/site/meta") return res.end(JSON.stringify({ changelogVersion: "fixture" }));
  if (u.pathname === "/api/site/changelog") return res.end(readFileSync(new URL("../../../site/changelog.json", import.meta.url)));
  if (u.pathname === "/api/radar/month") { const month = u.searchParams.get("month") ?? "2026-10";
    return res.end(JSON.stringify({ month, events: month === "2026-10" ? [fixture] : month === "2026-08" ? [launchFixture] : [], coverage: month === "2026-10" ? [{ date: "2026-10-10", games: 10, samples: 240 }] : [], status: { healthy: true, lastSuccess: "2026-10-26T12:00:00Z", lastAttempt: "2026-10-26T12:00:00Z", tracked: 10 } })); }
  res.statusCode = u.pathname === "/api/test/broken.jpg" ? 502 : 404; res.end("{}");
});
before(async () => { web = await startWebServer(api); browser = await chromium.launch(process.env.ASK_TEST_CHROME_PATH ? { executablePath: process.env.ASK_TEST_CHROME_PATH } : { channel: "chromium" }); });
after(async () => { await browser?.close(); await web?.stop(); });
test("launch cards and reports show Top100 and a later 50k upgrade without a fabricated growth baseline", async () => {
  for (const width of [1440, 390]) for (const theme of ["light", "dark"] as const) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, colorScheme: theme, reducedMotion: "reduce" });
    try {
      await context.addInitScript(t => localStorage.setItem("aihot-theme", t), theme);
      const page = await context.newPage(); await page.route("https://fonts.googleapis.com/**", r => r.abort());
      await page.goto(web.origin + "/radar?month=2026-08");
      await expect(page.locator(".monthly-kind")).toHaveText("首发热门");
      await expect(page.locator(".monthly-baseline")).toHaveText(/首发期最高 71,000 人/);
      await expect(page.locator(".monthly-stat strong")).toHaveText("21,000");
      await page.getByRole("button", { name: /展开 新游测试/ }).click();
      await expect(page.getByRole("region", { name: "新游上榜依据" })).toBeVisible();
      await expect(page.locator(".launch-release-date")).toContainText("8月9日");
      await expect(page.locator(".file-disclaimer")).toContainText("满足规则时间");
      await expect(page.locator(".file-chart-notes")).toContainText("旧样本未保存具体名次");
      await expect(page.locator(".file-transition")).not.toContainText("记录不足");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await mkdir(".taste-skill/radar-launch", { recursive: true });
      await page.screenshot({ path: `.taste-skill/radar-launch/${width}-${theme}.png`, fullPage: true });
    } finally { await context.close(); }
  }
});
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
      const chart = page.locator(".file-trajectory svg");
      await chart.scrollIntoViewIfNeeded();
      await expect(chart.locator(".radar-chart-axis text").first()).toBeVisible();
      // Test the actual rendered coordinates, including a transformed ancestor and non-square viewports.
      await page.locator(".file-trajectory .radar-chart-surface").evaluate(node => { (node as HTMLElement).style.transform = "scale(.87)"; });
      for (const [index, value, time] of [[0, "1,000", "09:00"], [1, "5,000", "10:00"], [2, "3,000", "13:00"]] as const) {
        const dot = await chart.locator(`.radar-observation[data-index="${index}"]`).boundingBox();
        assert.ok(dot);
        const position = { x: dot.x + dot.width / 2, y: dot.y + dot.height / 2 };
        await page.mouse.move(position.x, position.y);
        await expect(page.locator(".radar-chart-tooltip strong")).toContainText(value);
        await expect(page.locator(".radar-chart-tooltip time")).toContainText(time);
        await expect.poll(() => chart.evaluate((node, i) => {
          const marker = node.querySelector(".radar-chart-marker")!.getBoundingClientRect();
          const dot = node.querySelector(`.radar-observation[data-index="${i}"]`)!.getBoundingClientRect();
          return Math.max(Math.abs(marker.x + marker.width / 2 - dot.x - dot.width / 2), Math.abs(marker.y + marker.height / 2 - dot.y - dot.height / 2));
        }, index)).toBeLessThan(1);
        const tip = await page.locator(".radar-chart-tooltip").boundingBox();
        assert.ok(tip && tip.x >= 0 && tip.x + tip.width <= width);
      }
      await page.locator(".file-trajectory .radar-chart-surface").evaluate(node => { (node as HTMLElement).style.transform = ""; });

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

test("radar milestone shares AI heading typography, has its own reveal and respects reduced motion", async () => {
  for (const width of [1440, 390]) for (const theme of ["light", "dark"] as const) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, colorScheme: theme, reducedMotion: "no-preference" });
    try {
      await context.addInitScript(t => localStorage.setItem("aihot-theme", t), theme);
      const page = await context.newPage();
      await page.route("https://fonts.googleapis.com/**", route => route.abort());
      await page.goto(web.origin + "/changelog");
      const card = page.locator(".radar-release");
      await expect(card).toHaveClass(/is-entered/);
      const typography = await page.locator(".radar-release h2, .changelog-feature__heading").evaluateAll(nodes => nodes.map(n => {
        const s = getComputedStyle(n); return [s.fontFamily, s.fontSize, s.fontWeight, s.lineHeight, s.letterSpacing];
      }));
      assert.equal(typography.length, 2); assert.deepEqual(typography[0], typography[1]);
      assert.equal(await card.evaluate(n => getComputedStyle(n).animationName), "radar-release-enter");
      assert.equal(await page.locator(".radar-release-signal").evaluate(n => getComputedStyle(n).animationName), "radar-release-signal-enter");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.waitForTimeout(1100);
      await card.screenshot({ path: `.taste-skill/radar-live/release-polish-${width}-${theme}.png` });
    } finally { await context.close(); }
  }
  const context = await browser.newContext({ reducedMotion: "reduce" });
  try {
    const page = await context.newPage(); await page.goto(web.origin + "/changelog");
    await expect(page.locator(".radar-release")).toHaveClass(/is-entered/);
    for (const selector of [".radar-release", ".radar-release-signal", ".radar-release-signal i"]) assert.equal(await page.locator(selector).first().evaluate(n => getComputedStyle(n).animationName), "none");
  } finally { await context.close(); }
});

test("phone tapping a recorded point keeps its nearby tooltip available", async () => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, reducedMotion: "reduce" });
  try {
    const page = await context.newPage();
    await page.goto(web.origin + "/radar?month=2026-10");
    await page.locator(".monthly-hit").click();
    const chart = page.locator(".file-trajectory svg"); await chart.scrollIntoViewIfNeeded();
    const dot = await chart.locator('.radar-observation[data-index="1"]').boundingBox(); assert.ok(dot);
    await page.touchscreen.tap(dot.x + dot.width / 2, dot.y + dot.height / 2);
    await expect(page.locator(".radar-chart-tooltip strong")).toContainText("5,000");
    await expect(page.locator(".radar-chart-tooltip time")).toContainText("10:00");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  } finally { await context.close(); }
});
