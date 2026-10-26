import assert from "node:assert/strict";
import { createServer } from "node:http";
import { before, after, test } from "node:test";
import { chromium, expect, type Browser } from "@playwright/test";
import { startWebServer, type WebServer } from "./web-server.ts";

let web: WebServer;
let browser: Browser;
const api = createServer((req, res) => {
  res.setHeader("content-type", "application/json");
  if (req.url === "/api/site/meta") return res.end('{"changelogVersion":null}');
  if (req.url?.startsWith("/api/site/timeline")) return res.end(JSON.stringify({
    filters: { channel: "all", category: null, tag: null }, cards: [], nextCursor: null, hot: null, dayCounts: {},
  }));
  res.statusCode = 404; res.end("{}");
});
before(async () => {
  web = await startWebServer(api);
  browser = await chromium.launch(process.env.ASK_TEST_CHROME_PATH
    ? { executablePath: process.env.ASK_TEST_CHROME_PATH } : { channel: "chromium" });
});
after(async () => { await browser?.close(); await web?.stop(); });

test("fresh home is covered before delayed client code, then hands off to the splash", async () => {
  for (const theme of ["light", "dark"] as const) {
    const context = await browser.newContext({ colorScheme: theme, reducedMotion: "reduce" });
    try {
      const page = await context.newPage();
      let release!: () => void;
      const blocked = new Promise<void>(resolve => { release = resolve; });
      await page.route(/\.js(?:\?|$)/, async route => { await blocked; await route.continue(); });
      try {
        await page.goto(web.origin + "/", { waitUntil: "commit" });
        await expect(page.locator("html")).toHaveAttribute("data-intro-pending", "");
        assert.equal(await page.locator("html").evaluate(el => getComputedStyle(el, "::before").backgroundColor), "rgb(19, 20, 20)");
        assert.equal(await page.locator("html").evaluate(el => getComputedStyle(el, "::before").position), "fixed");
        await expect(page.getByRole("dialog", { name: "GAMEHOT 开场" })).toHaveCount(0);
      } finally { release(); }
      const splash = page.getByRole("dialog", { name: "GAMEHOT 开场" });
      await expect(splash).toBeVisible();
      await expect(page.locator("html")).not.toHaveAttribute("data-intro-pending", "");
      await page.getByRole("button", { name: "「进入」", exact: true }).click();
      await expect(splash).toHaveCount(0);
      await page.reload();
      await expect(splash).toHaveCount(0);
      await expect(page.locator("html")).not.toHaveAttribute("data-intro-pending", "");
      await page.goto(web.origin + "/?intro=1");
      await expect(splash).toBeVisible();
    } finally { await context.close(); }
  }
});

test("returning readers and non-home routes have no initial cover", async () => {
  for (const path of ["/", "/agent"]) {
    const context = await browser.newContext();
    try {
      if (path === "/") await context.addInitScript(() => sessionStorage.setItem("gamehot-intro-seen-v1", "1"));
      const page = await context.newPage();
      await page.route(/\.js(?:\?|$)/, route => route.abort());
      await page.goto(web.origin + path);
      await expect(page.locator("html")).not.toHaveAttribute("data-intro-pending", "");
    } finally { await context.close(); }
  }
});

test("failed client downloads release the cover rather than trapping the reader", async () => {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.route(/\.js(?:\?|$)/, route => route.abort());
    await page.goto(web.origin + "/");
    await expect(page.locator("html")).toHaveAttribute("data-intro-pending", "");
    await expect(page.locator("html")).not.toHaveAttribute("data-intro-pending", "", { timeout: 10000 });
  } finally { await context.close(); }
});
