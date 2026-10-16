import assert from "node:assert/strict";
import { test } from "node:test";
import { askAliases, askRange } from "../src/tools/search-query.ts";
import { checkCitations, isAllowedAskHref } from "../src/agent/citations.ts";
import { executeAskTool, askToolSpecs } from "../src/tools/whitelist.ts";

const now = new Date("2026-10-16T12:00:00Z");
test("one-hour queries use an exact backend range", () => {
  const range = askRange({ window: "1h" }, "24h", now);
  assert.equal(range.from?.toISOString(), "2026-10-16T11:00:00.000Z");
  assert.equal(range.until.toISOString(), now.toISOString());
});
test("today uses a Beijing calendar day instead of a rolling 24h", () => {
  assert.equal(askRange({ from: "2026-10-16" }, "7d", now).from?.toISOString(), "2026-10-15T16:00:00.000Z");
});
test("date-only end includes the whole Beijing day", () => {
  const range = askRange({ from: "2026-10-10", until: "2026-10-12" }, "7d", now);
  assert.equal(range.until.toISOString(), "2026-10-12T16:00:00.000Z");
});
test("ISO end is exclusive and history has no arbitrary 7-day cut-off", () => {
  const range = askRange({ window: "all", until: "2026-10-12T18:00:00+08:00" }, "7d", now);
  assert.equal(range.from, null);
  assert.equal(range.until.toISOString(), "2026-10-12T10:00:00.000Z");
});
test("invalid dates, missing timezone and reversed ranges are rejected", () => {
  for (const from of ["2026-02-30", "nonsense", "2026-10-12T13:00:00"]) assert.throws(() => askRange({ from }, "7d", now));
  assert.throws(() => askRange({ from: "2026-10-12", until: "2026-10-10" }, "7d", now));
});
test("existing game vocabulary bridges English, Chinese, abbreviations and extra terms", () => {
  assert.ok(askAliases("BG3").includes("博德之门3"));
  assert.ok(askAliases("《无畏契约》").includes("valorant"));
  assert.ok(askAliases("BG3 补丁").includes("博德之门3 补丁"));
  assert.deepEqual(askAliases("unrelatedgame"), ["unrelatedgame"]);
  assert.deepEqual(askAliases("xbg3x"), ["xbg3x"]);
});
test("citation validation flags missing sources without claiming fact verification", () => {
  assert.equal(checkCitations("报道说有更新", [1]).ok, false);
  assert.equal(checkCitations("报道说有更新 [1]", [1]).ok, true);
});
test("evidence URL checks reject suffix spoofing and unsafe protocols", () => {
  const urls = new Set(["/items/a", "https://example.org/report"]);
  for (const href of ["https://evil.test/items/a", "https://evil.test/https://example.org/report", "//evil.test/items/a", "javascript:alert(1)", "/items/b"]) assert.equal(isAllowedAskHref(href, urls), false, href);
  assert.equal(isAllowedAskHref("/items/a", urls), true);
});
test("bad tool ranges fail before any database or model access", async () => {
  const result = await executeAskTool("search", JSON.stringify({ q: "BG3", from: "2026-02-30" }));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.errorCode, "invalid_arguments");
  const specs = askToolSpecs();
  assert.ok(specs.find((s) => s.function.name === "get_article"));
});
