import "../../../tests/setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createRequire } from "node:module";
import { sql, closeDb } from "@aihot/backend/db";
import { config } from "@aihot/backend/config";
import { loadRadarMonth } from "@aihot/backend/publication/radar";
import { beijingDate, beijingMidnight, addDays } from "@aihot/contracts/time";
import { remember, insertPoints, live, metadata, evaluate } from "../backend/collect.ts";
import { evaluateLaunch } from "../backend/launch.ts";
const { MockAgent, getGlobalDispatcher, setGlobalDispatcher } = createRequire(new URL("../../../packages/backend/package.json", import.meta.url))("undici");
const previousDispatcher = getGlobalDispatcher(), mock = new MockAgent(); mock.disableNetConnect(); setGlobalDispatcher(mock);
const previousPrivate = config.allowPrivateNetworkFetch, previousProxy = config.egressProxyUrl;
config.allowPrivateNetworkFetch = true; config.egressProxyUrl = null;
after(async () => { config.allowPrivateNetworkFetch = previousPrivate; config.egressProxyUrl = previousProxy; setGlobalDispatcher(previousDispatcher); await mock.close(); await closeDb(); });
const day = addDays(beijingDate(new Date()), -1), start = beijingMidnight(day).getTime();
const point = (minutes: number, count: number, rank?: number) => ({ at: new Date(start + minutes * 60000).toISOString(), count, rank });
async function game(id: number, type = "game", established = false) {
  await remember({ app_id: id, name: `Launch fixture ${id}` }, "test");
  await sql`UPDATE radar_games SET app_type = ${type}, release_day = ${day}, established = ${established}, metadata_at = now() WHERE appid = ${id}`;
}

test("legacy official snapshots backfill once; 50k upgrade retains discovery date, proof and discovery-day peak", async () => {
  const id = 999100001; await game(id, "game", true);
  await insertPoints(id, [point(0, 19000), point(15, 21000)], "steam-chart");
  assert.equal((await evaluateLaunch(id)).added, 1);
  const [before] = await sql`SELECT * FROM radar_events WHERE appid = ${id}`;
  assert.equal(before.kind, "launch"); assert.equal(before.baseline, null); assert.equal(before.peak, 21000);
  assert.equal(before.proof.launch.qualification[0].rank, null);
  await insertPoints(id, [point(24 * 60, 71000, 10)], "steam-chart");
  assert.equal((await evaluateLaunch(id)).added, 0);
  const rows = await sql`SELECT * FROM radar_events WHERE appid = ${id}`;
  assert.equal(rows.length, 1); assert.equal(rows[0].peak, 21000); assert.equal(rows[0].proof.launch.peak, 71000);
  assert.equal(rows[0].proof.launch.peakObservation.count, 71000); assert.equal(rows[0].proof.launch.peakObservation.source, "steam-chart");
  assert.deepEqual(rows[0].proof.launch.qualification, before.proof.launch.qualification);
  assert.equal(new Date(rows[0].event_day).toISOString().slice(0, 10), day);
  const view = await loadRadarMonth(day.slice(0, 7)); const event = view.events.find(e => e.appid === id)!;
  assert.equal(event.kind, "launch"); assert.equal(event.launch?.peak, 71000); assert.equal(event.rankAfter, null);
  assert.ok(event.headline.includes("Top 100")); assert.ok(!event.headline.includes("此前低关注"));
});

test("off-chart counts, DLCs and cached duplicates cannot fabricate new launches", async () => {
  for (const [id, type, source] of [[999100002, "game", "steam-current"], [999100003, "dlc", "steam-chart"]] as const) {
    await game(id, type); await insertPoints(id, [point(0, 90000), point(15, 100000)], source);
    assert.equal((await evaluateLaunch(id)).added, 0);
  }
  await game(999100004); await insertPoints(999100004, [point(0, 90000), point(0, 90000)], "steam-chart");
  assert.equal((await evaluateLaunch(999100004)).added, 0);
  const dlc = 999100011; await game(dlc, "dlc");
  const old = start - 7 * 86400000;
  await insertPoints(dlc, Array.from({ length: 8 * 24 }, (_, h) => ({ at: new Date(old + h * 3600000).toISOString(), count: h < 7 * 24 ? 100 : 10000 })), "steamdata-hourly");
  assert.equal(await evaluate(dlc, "historical"), 0, "a known DLC must not fall through into the old growth rule");
});

test("live collection enriches a high-starting new game before evaluation and saves actual ranks", async () => {
  const id = 999100005, dlc = 999100006, upcoming = 999100007, retry = 999100008;
  await sql`UPDATE radar_games SET watch_until = now() - interval '1 day'`;
  const at = Math.floor(Date.now() / 1000) - 60;
  await remember({ app_id: id, name: "" }, "steam-chart");
  await insertPoints(id, [{ at: new Date((at - 900) * 1000).toISOString(), count: 110000, rank: 3 }], "steam-chart");
  await remember({ app_id: retry, name: "" }, "steam-chart");
  await insertPoints(retry, [{ at: new Date((at - 900) * 1000).toISOString(), count: 100000, rank: 6 }], "steam-chart");
  mock.get("https://api.steampowered.com").intercept({ path: "/ISteamChartsService/GetGamesByConcurrentPlayers/v1/" }).reply(200, { response: { last_update: at, ranks: [
    { appid: id, rank: 3, concurrent_in_game: 700000 }, { appid: dlc, rank: 4, concurrent_in_game: 200000 },
    { appid: upcoming, rank: 5, concurrent_in_game: 100000 }, { appid: retry, rank: 6, concurrent_in_game: 100000 },
  ] } });
  for (const appid of [id, dlc, upcoming]) mock.get("https://store.steampowered.com").intercept({ path: `/api/appdetails?appids=${appid}&cc=us&l=english` }).reply(200, {
    [appid]: { success: true, data: { name: `Official ${appid}`, type: appid === dlc ? "dlc" : "game", release_date: { date: day, coming_soon: appid === upcoming }, publishers: ["Electronic Arts"] } },
  });
  mock.get("https://store.steampowered.com").intercept({ path: `/api/appdetails?appids=${retry}&cc=us&l=english` }).reply(503, {});
  const result = await live(); assert.equal(result.metadataFailed, 1);
  const [event] = await sql`SELECT e.kind,e.peak,g.name,g.established,g.app_type FROM radar_events e JOIN radar_games g USING(appid) WHERE appid = ${id}`;
  assert.equal(event.kind, "launch"); assert.equal(event.peak, 700000); assert.equal(event.established, true); assert.equal(event.name, `Official ${id}`);
  assert.equal((await sql`SELECT 1 FROM radar_events WHERE appid = ${dlc}`).length, 0);
  assert.equal((await sql`SELECT 1 FROM radar_events WHERE appid = ${upcoming}`).length, 0);
  assert.equal((await sql`SELECT 1 FROM radar_events WHERE appid = ${retry}`).length, 0);
  assert.equal((await sql`SELECT 1 FROM radar_samples WHERE appid = ${retry}`).length, 2);
  const [sample] = await sql`SELECT rank FROM radar_samples WHERE appid = ${id} ORDER BY observed_at DESC LIMIT 1`; assert.equal(sample.rank, 3);
  mock.get("https://store.steampowered.com").intercept({ path: `/api/appdetails?appids=${retry}&cc=us&l=english` }).reply(200, {
    [retry]: { success: true, data: { name: "Recovered new game", type: "game", release_date: { date: day, coming_soon: false } } },
  });
  await metadata(retry); assert.equal((await evaluateLaunch(retry)).added, 1);
});

test("concurrent reassessment produces one event and does not suppress old growth after the launch window", async () => {
  const id = 999100009; await game(id);
  await insertPoints(id, [point(0, 12000), point(15, 15000)], "steam-chart");
  const results = await Promise.all([evaluateLaunch(id), evaluateLaunch(id)]);
  assert.equal(results.reduce((n, r) => n + r.added, 0), 1);
  assert.equal((await sql`SELECT 1 FROM radar_events WHERE appid = ${id}`).length, 1);
  const older = 999100010, releaseDay = addDays(day, -20), early = beijingMidnight(releaseDay).getTime();
  await game(older); await sql`UPDATE radar_games SET release_day = ${releaseDay} WHERE appid = ${older}`;
  await insertPoints(older, [0, 15].map(minutes => ({ at: new Date(early + minutes * 60000).toISOString(), count: 15000 })), "steam-chart");
  assert.equal((await evaluateLaunch(older)).added, 1);
  assert.equal((await evaluateLaunch(older)).handled, false);
});
