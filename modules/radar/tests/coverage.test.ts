import "../../../tests/setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createRequire } from "node:module";
import { sql, closeDb } from "@aihot/backend/db";
import { config } from "@aihot/backend/config";
import { remember, offChartCandidates, refreshCandidates } from "../backend/collect.ts";
const { MockAgent, getGlobalDispatcher, setGlobalDispatcher } = createRequire(new URL("../../../packages/backend/package.json", import.meta.url))("undici");
const previousDispatcher = getGlobalDispatcher(), mock = new MockAgent(); mock.disableNetConnect(); setGlobalDispatcher(mock);
const previousPrivate = config.allowPrivateNetworkFetch, previousProxy = config.egressProxyUrl;
config.allowPrivateNetworkFetch = true; config.egressProxyUrl = null;
after(async () => { config.allowPrivateNetworkFetch = previousPrivate; config.egressProxyUrl = previousProxy; setGlobalDispatcher(previousDispatcher); await mock.close(); await closeDb(); });

test("bounded off-chart rotation reserves discovery capacity and does not starve the catalog", async () => {
  const games = Array.from({ length: 160 }, (_, i) => ({ appid: 999600000 + i, name: `Coverage ${i}`, origin: i < 80 ? "news-link" : "steamdata-catalog", app_type: "game" }));
  await sql`INSERT INTO radar_games ${sql(games)}`;
  const first = await offChartCandidates([]);
  assert.equal(first.length, 50); assert.equal(first.filter(g => g.origin === "news-link").length, 30);
  assert.equal(first.filter(g => g.origin === "steamdata-catalog").length, 20);
  await sql`UPDATE radar_games SET last_sample_at = now() WHERE appid = ANY(${first.map(g => g.appid)})`;
  const second = await offChartCandidates([]);
  assert.equal(second.length, 50); assert.ok(second.every(g => !first.some(f => f.appid === g.appid)));
  await sql`UPDATE radar_games SET watch_until = now() - interval '1 day'`;
  const active = games[0].appid;
  await sql`INSERT INTO radar_events (id,appid,event_day,origin,status,kind,peak,baseline,baseline_days,points,rule_version,proof)
    VALUES ('coverage-event',${active},(now() AT TIME ZONE 'Asia/Shanghai')::date,'live','suspected','breakout',8000,500,1,'[]','test','{}')`;
  assert.deepEqual((await offChartCandidates([])).map(g => g.appid), [active], "existing events stay watched after candidate expiration");
  assert.equal((await offChartCandidates([active])).length, 0, "ranked games are not sampled twice");
});

test("an empty priority tier can use all fifty slots, while non-games and established old games stay excluded", async () => {
  await sql`DELETE FROM radar_events`;
  await sql`UPDATE radar_games SET watch_until = now() + interval '1 day', origin = 'steamdata-catalog', last_sample_at = NULL`;
  await sql`UPDATE radar_games SET established = true WHERE appid = 999600000`;
  await sql`UPDATE radar_games SET app_type = 'dlc' WHERE appid = 999600001`;
  const selected = await offChartCandidates([]);
  assert.equal(selected.length, 50); assert.ok(selected.every(g => ![999600000, 999600001].includes(g.appid)));
  await sql`UPDATE radar_games SET release_day = (now() AT TIME ZONE 'Asia/Shanghai')::date, origin = 'news-link' WHERE appid = 999600000`;
  assert.ok((await offChartCandidates([])).some(g => g.appid === 999600000), "established publisher cannot suppress a genuinely new launch");
});

test("catalog refresh renews monitoring and duplicate mover entries cannot consume distinct candidate slots", async () => {
  const id = 999600100;
  await sql`UPDATE radar_games SET watch_until = now() - interval '1 day' WHERE appid = ${id}`;
  await remember({ app_id: id, name: "Renewed" }, "steamdata-catalog");
  const [renewed] = await sql`SELECT watch_until > now() AS active FROM radar_games WHERE appid = ${id}`;
  assert.equal(renewed.active, true);
  const apps = Array.from({ length: 10 }, (_, i) => ({ app_id: 999610000 + i, name: `Mover ${i}` }));
  mock.get("https://api.steamdata.dev").intercept({ path: "/api/movers?limit=10" }).reply(200, { tags: { a: { rising: apps }, b: { rising: apps } } });
  const result = await refreshCandidates(); assert.equal(result.movers, 10);
  assert.equal((await sql`SELECT 1 FROM radar_games WHERE origin = 'steamdata-mover'`).length, 10);
});
