import { stub, pointModels } from "../../../tests/setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createRequire } from "node:module";
import { sql, closeDb } from "@aihot/backend/db";
import { config } from "@aihot/backend/config";
import { beijingDate, beijingMidnight } from "@aihot/contracts/time";
import { explainPending } from "../backend/collect.ts";

const provider = await stub(() => ({ choices: [{ message: { content: JSON.stringify({ summary: "官方公告显示游戏现已发售。", sources: [0] }) } }] }));
pointModels(provider.url, ["deepseek-flash"]);
process.env.SUMMARIZE_MODEL = "deepseek-flash";
const { MockAgent, getGlobalDispatcher, setGlobalDispatcher } = createRequire(new URL("../../../packages/backend/package.json", import.meta.url))("undici");
const previous = getGlobalDispatcher(), mock = new MockAgent(); mock.disableNetConnect(); mock.enableNetConnect(/^127\.0\.0\.1:\d+$/); setGlobalDispatcher(mock);
const savedPrivate = config.allowPrivateNetworkFetch, savedProxy = config.egressProxyUrl;
config.allowPrivateNetworkFetch = true; config.egressProxyUrl = null;
after(async () => { config.allowPrivateNetworkFetch = savedPrivate; config.egressProxyUrl = savedProxy; setGlobalDispatcher(previous); await mock.close(); await provider.close(); await closeDb(); });

test("publishing an evidence-based explanation completes its paid receipt without another model call", async () => {
  const day = beijingDate(new Date()), appid = 999200001, id = `${appid}-${day}`;
  await sql`INSERT INTO radar_games (appid,name,origin) VALUES (${appid},'Launch Receipt Fixture','test')`;
  await sql`INSERT INTO radar_events (id,appid,event_day,origin,status,kind,peak,baseline_days,points,rule_version,proof)
    VALUES (${id},${appid},${day},'live','confirmed','launch',60000,0,'[]','test','{}')`;
  const enddate = Math.floor(Date.parse(day + "T16:00:00Z") / 1000) + 86400;
  mock.get("https://api.steampowered.com").intercept({ path: `/ISteamNews/GetNewsForApp/v2/?appid=${appid}&count=5&maxlength=1200&enddate=${enddate}&feeds=steam_community_announcements` }).reply(200, {
    appnews: { appid, newsitems: [{ title: "正式发售公告", url: "https://store.steampowered.com/news/app/999200001/view/123", contents: "游戏今天正式发售。", date: Math.floor(beijingMidnight(day).getTime() / 1000), feedname: "steam_community_announcements" }] },
  });
  assert.deepEqual(await explainPending(), { attempted: 1 });
  const [event] = await sql`SELECT reason,evidence,analyzed_at FROM radar_events WHERE id = ${id}`;
  assert.ok(event.analyzed_at); assert.equal(event.evidence.length, 1); assert.ok(event.reason);
  const [receipt] = await sql`SELECT status,completed_at FROM receipts WHERE purpose = 'radar_explanation' AND subject = ${id}`;
  assert.equal(receipt.status, "completed"); assert.ok(receipt.completed_at);
  assert.deepEqual(await explainPending(), { attempted: 0 }); assert.equal(provider.hits(), 1);
});
