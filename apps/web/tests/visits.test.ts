import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir } from "node:fs/promises";
import { after, before, test } from "node:test";
import { chromium, expect, type Browser } from "@playwright/test";
import { startWebServer, type WebServer } from "./web-server.ts";

let web: WebServer, browser: Browser;
const reports: Array<{ path: string; referrer: string; cookie?: string }> = [];
let reads = 0;
const api = createServer(async (req, res) => {
  const url = new URL(req.url!, "http://api.local");
  res.setHeader("content-type", "application/json");
  if (url.pathname === "/api/site/meta") return res.end(JSON.stringify({ changelogVersion: null }));
  if (url.pathname === "/api/admin/me") return res.end(JSON.stringify({ name: "测试管理员", csrf: "dev", dev: true }));
  if (url.pathname === "/api/admin/nav-counts") return res.end("{}");
  if (url.pathname === "/api/admin/visits") {
    reads++;
    const date = url.searchParams.get("date") || "2026-10-27";
    const ip = url.searchParams.get("ip") || null;
    let rows = [{ id: 2, visited_at: "2026-10-27T02:30:00Z", ip: "203.0.113.9", path: "/radar", referrer_origin: "https://example.com", user_agent: "Mozilla/5.0 Test Browser" },
      { id: 1, visited_at: "2026-10-27T01:30:00Z", ip: "2001:db8:1234:5678:90ab:cdef:1234:5678", path: "/items/123456789", referrer_origin: null, user_agent: "Test Mobile Browser" }];
    rows = date === "2026-10-27" ? rows.filter(r => !ip || ip === r.ip) : [];
    return res.end(JSON.stringify({ date, ip, page: 1, hasMore: false, summary: { views: rows.length, ips: rows.length }, rows }));
  }
  if (url.pathname === "/api/site/visit") {
    let raw = ""; for await (const chunk of req) raw += String(chunk);
    reports.push({ ...JSON.parse(raw), cookie: req.headers.cookie });
    res.statusCode = 204; return res.end();
  }
  res.statusCode = 404; res.end("{}");
});

before(async () => {
  web = await startWebServer(api);
  browser = await chromium.launch(process.env.ASK_TEST_CHROME_PATH ? { executablePath: process.env.ASK_TEST_CHROME_PATH } : { channel: "chromium" });
});
after(async () => { await browser?.close(); await web?.stop(); });

test("visitor admin table, filters, refresh and empty state work on desktop/mobile in both themes", async () => {
  await mkdir(".taste-skill/visits", { recursive: true });
  for (const width of [1440, 390]) for (const theme of ["light", "dark"]) {
    const context = await browser.newContext({ viewport: { width, height: 950 }, reducedMotion: "reduce" });
    try {
      await context.addInitScript(t => localStorage.setItem("aihot-theme", t), theme);
      const page = await context.newPage();
      const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
      await page.route("https://fonts.googleapis.com/**", r => r.abort());
      const before = reports.length;
      await page.goto(web.origin + "/admin/visits");
      await expect(page.getByRole("heading", { name: "访问记录" })).toBeVisible();
      await expect(page.getByRole("cell", { name: "203.0.113.9", exact: true })).toBeVisible();
      await page.getByText("查看 User-Agent").first().click();
      await expect(page.getByText("Mozilla/5.0 Test Browser")).toBeVisible();
      await page.locator("table").evaluate(table => { table.parentElement!.scrollLeft = 0; });
      await page.screenshot({ path: `.taste-skill/visits/${width}-${theme}.png` });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      const n = reads;
      await page.getByRole("button", { name: "刷新记录" }).click();
      await expect.poll(() => reads).toBeGreaterThan(n);
      await page.getByRole("textbox", { name: "IP 地址" }).fill("203.0.113.9");
      await page.getByRole("button", { name: "筛选", exact: true }).click();
      await expect(page.getByRole("cell", { name: "2001:db8:1234:5678:90ab:cdef:1234:5678", exact: true })).toHaveCount(0);
      await page.getByLabel("访问日期（北京时间）").fill("2026-10-01");
      await page.getByRole("button", { name: "筛选", exact: true }).click();
      await expect(page.getByText("所选日期暂无访问记录")).toBeVisible();
      assert.equal(reports.length, before, "admin browsing must not be counted");
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  }
});

test("page tracking captures real navigation once and omits query strings and cookies", async () => {
  const context = await browser.newContext();
  try {
    await context.addCookies([{ name: "visit-test-secret", value: "never-send", url: web.origin }]);
    await context.addInitScript(() => sessionStorage.setItem("gamehot-intro-seen-v1", "1"));
    const page = await context.newPage();
    await page.route("https://fonts.googleapis.com/**", r => r.abort());
    const before = reports.length;
    await page.goto(web.origin + "/privacy?token=never-store", { referer: "https://example.com/private?token=never-store" });
    await expect.poll(() => reports.length).toBe(before + 1);
    assert.equal(reports.at(-1)!.path, "/privacy");
    assert.equal(reports.at(-1)!.cookie, undefined);
    assert.equal(reports.at(-1)!.referrer, "https://example.com");
    await page.locator('a[href="/terms"]').first().click();
    await expect.poll(() => reports.length).toBe(before + 2);
    assert.equal(reports.at(-1)!.path, "/terms");
    await page.goBack();
    await expect.poll(() => reports.length).toBe(before + 3);
    assert.equal(reports.at(-1)!.path, "/privacy");
  } finally { await context.close(); }
});
