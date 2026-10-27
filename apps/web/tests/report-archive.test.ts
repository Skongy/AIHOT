// Real browser coverage for the desktop archive disclosure and the unchanged phone navigation.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, test } from "node:test";
import { chromium, expect, type Browser } from "@playwright/test";
import type { ReportDetail } from "@aihot/contracts/site";
import { startWebServer, type WebServer } from "./web-server.ts";

const index = [
  { key: "2026-10-24", issueNumber: 2, title: "英雄联盟全球总决赛赛程公布" },
  { key: "2026-10-23", issueNumber: 1, title: "游戏更新与行业动态" },
];
function report(key: string): ReportDetail {
  return { kind: "daily", key, issueNumber: key === index[0]!.key ? 2 : 1,
    title: "游戏日报", generatedAt: "2026-10-24T00:00:00Z", lead: null, leadItemId: null,
    overview: null, highlights: [], sections: [], flashes: [], cover: null, metrics: {},
    readingMinutes: 1, prev: null, next: null };
}
const api = createServer((req, res) => {
  const path = new URL(req.url!, "http://fixture").pathname;
  res.setHeader("content-type", "application/json");
  if (path === "/api/site/meta") return res.end(JSON.stringify({ changelogVersion: null }));
  if (path === "/api/site/reports/daily/latest-page") return res.end(JSON.stringify({ index, report: report(index[0]!.key) }));
  if (path === "/api/site/reports/daily/navigation/2026-10-23") return res.end(JSON.stringify({ items: index }));
  if (path === "/api/site/reports/daily/2026-10-23") return res.end(JSON.stringify(report("2026-10-23")));
  res.statusCode = 404; res.end("{}");
});
let web: WebServer, browser: Browser;
before(async () => {
  web = await startWebServer(api);
  browser = await chromium.launch(process.env.ASK_TEST_CHROME_PATH ? { executablePath: process.env.ASK_TEST_CHROME_PATH } : { channel: "chromium" });
});
after(async () => { await browser?.close(); await web?.stop(); });

for (const colorScheme of ["light", "dark"] as const) {
  test(`${colorScheme}: archive collapses, widens the paper, and restores working issue links`, async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme, reducedMotion: "reduce" });
    try {
      await page.route("https://fonts.googleapis.com/**", (route) => route.abort());
      await page.goto(web.origin + "/daily");
      const panel = page.getByRole("complementary", { name: "往期列表面板" });
      const history = page.getByRole("navigation", { name: "日报历史", exact: true });
      await expect(history).toBeVisible();
      const paper = page.locator(".report-shell > div");
      const beforeWidth = (await paper.boundingBox())!.width;
      const toggle = panel.getByRole("button", { name: "收起往期列表" });
      await expect(panel.getByText("往期刊物", { exact: true })).toBeVisible();
      assert.ok((await toggle.boundingBox())!.width > 40);
      await toggle.focus();
      await page.keyboard.press("Enter");
      const expand = panel.getByRole("button", { name: "展开往期列表" });
      await expect(expand).toHaveAttribute("aria-expanded", "false");
      await expect(expand.getByText("往期", { exact: true })).toBeVisible();
      assert.ok((await expand.boundingBox())!.height >= 80);
      await expect(expand).toBeFocused();
      await expect(history).toBeHidden();
      await expect(panel).toHaveCSS("width", "52px");
      assert.ok((await paper.boundingBox())!.width >= beforeWidth + 220);
      await page.keyboard.press("Enter");
      await expect(history).toBeVisible();
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      await history.getByRole("link", { name: /游戏更新与行业动态/ }).click();
      await expect(page).toHaveURL(/\/daily\/2026-10-23$/);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    } finally { await page.close(); }
  });
  test(`${colorScheme}: phone keeps its existing navigation without a desktop collapse rail`, async () => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, colorScheme, reducedMotion: "reduce" });
    try {
      await page.goto(web.origin + "/daily");
      await expect(page.getByRole("complementary", { name: "往期列表面板" })).toBeHidden();
      await expect(page.getByRole("button", { name: "收起往期列表" })).toBeHidden();
      await expect(page.getByRole("link", { name: "日报", exact: true }).first()).toBeVisible();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    } finally { await page.close(); }
  });
}
