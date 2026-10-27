import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, test } from "node:test";
import { chromium, expect, type Browser } from "@playwright/test";
import { startWebServer, type WebServer } from "./web-server.ts";

let web: WebServer, browser: Browser;
const api = createServer((req, res) => {
  res.setHeader("content-type", "application/json");
  if (req.url === "/api/site/meta") return res.end(JSON.stringify({ changelogVersion: null }));
  if (req.url === "/api/site/visit") { res.statusCode = 204; return res.end(); }
  res.statusCode = 404; res.end("{}");
});
before(async () => {
  web = await startWebServer(api);
  browser = await chromium.launch(process.env.ASK_TEST_CHROME_PATH ? { executablePath: process.env.ASK_TEST_CHROME_PATH } : { channel: "chromium" });
});
after(async () => { await browser?.close(); await web?.stop(); });

test("sidebar groups, equal rows and all entries fit without scrolling in both themes at seven heights", async () => {
  for (const theme of ["light", "dark"]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
    try {
      await context.addInitScript(t => localStorage.setItem("aihot-theme", t), theme);
      const page = await context.newPage();
      await page.route("https://fonts.googleapis.com/**", r => r.abort());
      await page.goto(web.origin + "/terms");
      const panel = page.locator(".sd-panel");
      await expect(panel).toBeVisible();
      assert.deepEqual(await panel.locator("nav a").evaluateAll(links => links.map(a => a.getAttribute("aria-label"))), ["精选", "全部动态", "热点事件", "游戏日报", "游戏异动", "游戏主题", "AI 问答", "我的收藏", "Agent 接入", "关于", "更新日志"]);
      assert.deepEqual(await panel.locator("h2").allTextContents(), ["资讯", "探索", "助手"]);
      await expect(page.getByRole("button", { name: "原版", exact: true })).toHaveCount(0);
      for (const height of [900, 800, 720, 640, 600, 540, 480]) {
        await page.setViewportSize({ width: 1440, height });
        for (const collapsed of [false, true]) {
          if ((await panel.getAttribute("class"))!.includes("is-collapsed") !== collapsed) await panel.getByRole("button", { name: collapsed ? "收起侧边栏" : "展开侧边栏", exact: true }).click();
          const metrics = await panel.evaluate(p => {
            const n = p.querySelector("nav")!, bounds = p.getBoundingClientRect(), footer = p.querySelector("footer")!.getBoundingClientRect();
            const rows = [...n.querySelectorAll("a")].map(a => a.getBoundingClientRect());
            return { overflow: getComputedStyle(n).overflowY, scroll: n.scrollHeight, client: n.clientHeight,
              widths: rows.map(r => r.width), heights: rows.map(r => r.height),
              fits: rows.every(r => r.y >= bounds.top && r.bottom <= footer.top + .5) && footer.bottom <= bounds.bottom + .5,
              overlap: rows.some((r, i) => i > 0 && r.top < rows[i - 1]!.bottom - .5) };
          });
          assert.ok(!["auto", "scroll"].includes(metrics.overflow));
          assert.ok(metrics.scroll <= metrics.client + 1, JSON.stringify({ theme, height, collapsed, metrics }));
          assert.ok(Math.max(...metrics.widths) - Math.min(...metrics.widths) < .5);
          assert.ok(Math.max(...metrics.heights) - Math.min(...metrics.heights) < .5);
          assert.ok(metrics.fits && !metrics.overlap);
        }
      }
    } finally { await context.close(); }
  }
});

test("collapsed navigation, session persistence, appearance controls and keyboard activation work", async () => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  try {
    const page = await context.newPage();
    await page.route("https://fonts.googleapis.com/**", r => r.abort());
    await page.goto(web.origin + "/terms");
    const panel = page.locator(".sd-panel");
    const collapse = panel.getByRole("button", { name: "收起侧边栏", exact: true });
    await collapse.focus(); await page.keyboard.press("Enter");
    await expect(panel).toHaveCSS("width", "76px");
    await expect(panel.getByRole("link", { name: "我的收藏", exact: true })).toHaveAttribute("title", "我的收藏");
    await page.reload();
    await expect(panel).toHaveClass(/is-collapsed/);
    await panel.getByRole("link", { name: "我的收藏", exact: true }).click();
    await expect(page).toHaveURL(/\/starred$/);
    await expect(panel.getByRole("link", { name: "我的收藏", exact: true })).toHaveAttribute("aria-current", "page");
    await panel.getByRole("button", { name: "切换外观" }).click();
    await panel.getByRole("menuitem", { name: "深色", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await panel.getByRole("button", { name: "展开侧边栏", exact: true }).click();
    await expect(panel).toHaveCSS("width", "246px");
    await panel.getByRole("radio", { name: "浅色", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  } finally { await context.close(); }
});
