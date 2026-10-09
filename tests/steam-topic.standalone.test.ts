import "./setup.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { parseSteamAppdetails } from "@aihot/backend/publication/steam";
import { TOPICS, findTopic } from "@aihot/backend/publication/topics";

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/steam");

test("four seed topics carry the agreed Steam app ids", () => {
  const expected: Record<string, number> = {
    "binding-of-isaac-rebirth": 250900,
    "slay-the-spire-2": 2868840,
    mewgenics: 686060,
    "baldurs-gate-3": 1086940,
  };
  for (const [slug, appId] of Object.entries(expected)) {
    const t = findTopic(slug);
    assert.ok(t, slug);
    assert.equal(t!.steamAppId, appId);
  }
  assert.equal(findTopic("pc-steam")!.steamAppId, null);
  assert.equal(TOPICS.filter((t) => t.steamAppId).length, 4);
});

test("parseSteamAppdetails maps public store fields", () => {
  const body = JSON.parse(readFileSync(path.join(FIX, "appdetails-bg3.json"), "utf8"));
  const panel = parseSteamAppdetails(1086940, body);
  assert.ok(panel);
  assert.equal(panel!.appId, 1086940);
  assert.equal(panel!.name, "博德之门3");
  assert.match(panel!.shortDescription!, /队伍/);
  assert.ok(panel!.headerImage?.includes("1086940"));
  assert.deepEqual(panel!.developers, ["Larian Studios"]);
  assert.equal(panel!.price?.label, "¥ 298.00");
  assert.equal(panel!.metacriticScore, 96);
  assert.equal(panel!.storeUrl, "https://store.steampowered.com/app/1086940/?l=schinese");
  assert.ok(panel!.platforms.includes("Windows"));
});

test("parseSteamAppdetails returns null on failure payload", () => {
  const body = JSON.parse(readFileSync(path.join(FIX, "appdetails-fail.json"), "utf8"));
  assert.equal(parseSteamAppdetails(686060, body), null);
  assert.equal(parseSteamAppdetails(1086940, null), null);
  assert.equal(parseSteamAppdetails(1086940, {}), null);
});
