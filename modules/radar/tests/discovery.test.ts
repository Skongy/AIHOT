import "../../../tests/setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { sql, closeDb } from "@aihot/backend/db";
import { loadRadarMonth } from "@aihot/backend/publication/radar";
import { remember, insertPoints, evaluate } from "../backend/collect.ts";
import { evaluateLaunch } from "../backend/launch.ts";
import { dayOf, previousDay } from "../backend/detect.ts";
after(closeDb);

async function game(id: number, release: string | null = null) {
  await remember({ app_id: id, name: `Discovery ${id}` }, "test");
  await sql`UPDATE radar_games SET app_type = 'game', release_day = ${release}, metadata_at = now() WHERE appid = ${id}`;
}

test("two-sample growth is published immediately, then matures and cools in the same archive record", async t => {
  const id = 999500001, end = Date.now() - 60000, base = end - 10 * 3600000;
  t.mock.timers.enable({ apis: ["Date"], now: base + 195 * 60000 });
  const p = (minutes: number, count: number) => ({ at: new Date(base + minutes * 60000).toISOString(), count });
  await game(id);
  await insertPoints(id, [p(0, 500), p(60, 500), p(120, 500), p(180, 8000), p(195, 8000)], "steam-current");
  const results = await Promise.all([evaluate(id, "live"), evaluate(id, "live")]);
  assert.equal(results.reduce((a, b) => a + b, 0), 1);
  let [event] = await sql`SELECT * FROM radar_events WHERE appid = ${id}`;
  assert.equal(event.status, "suspected"); assert.equal(event.baseline, 500); assert.equal(event.kind, "breakout");
  const initialId = event.id, initialProof = event.proof, detectedAt = event.detected_at.toISOString();
  assert.equal(event.proof.baselinePoints.length, 3);
  t.mock.timers.tick(15 * 60000);
  await insertPoints(id, [p(210, 8000)], "steam-current"); await evaluate(id, "live");
  [event] = await sql`SELECT * FROM radar_events WHERE appid = ${id}`; assert.equal(event.status, "surging");
  t.mock.timers.tick(90 * 60000);
  await insertPoints(id, [p(240, 8000), p(300, 8000)], "steam-current"); await evaluate(id, "live");
  [event] = await sql`SELECT * FROM radar_events WHERE appid = ${id}`; assert.equal(event.status, "confirmed");
  t.mock.timers.tick(180 * 60000);
  await insertPoints(id, [p(330, 1000), p(390, 1000), p(450, 1000), p(480, 1000)], "steam-current"); await evaluate(id, "live");
  const rows = await sql`SELECT * FROM radar_events WHERE appid = ${id}`;
  assert.equal(rows.length, 1); event = rows[0]; assert.equal(event.status, "cooled");
  assert.equal(event.id, initialId); assert.equal(event.detected_at.toISOString(), detectedAt);
  assert.equal(event.proof.qualifiedAt, initialProof.qualifiedAt); assert.deepEqual(event.proof.baselinePoints, initialProof.baselinePoints);
  assert.equal(event.baseline, 500); assert.equal(event.peak, 8000);
  const view = await loadRadarMonth(dayOf(p(180, 8000).at).slice(0, 7));
  const item = view.events.find(e => e.appid === id)!;
  assert.equal(item.status, "cooled"); assert.match(item.headline, /持续回落/);
});

test("off-chart 20k launch records its real basis; low or third-party counts do not qualify", async () => {
  const base = Date.now() - 45 * 60000, release = previousDay(dayOf(new Date()), 1);
  for (const [id, count, source, expected] of [[999500002, 21000, "steam-current", 1], [999500003, 20000, "steam-current", 0], [999500004, 50000, "steamdata-hourly", 0]] as const) {
    await game(id, release);
    await insertPoints(id, [0, 30].map(m => ({ at: new Date(base + m * 60000).toISOString(), count })), source);
    assert.equal((await evaluateLaunch(id)).added, expected);
    if (!expected) continue;
    assert.equal((await evaluateLaunch(id)).added, 0);
    const [event] = await sql`SELECT * FROM radar_events WHERE appid = ${id}`;
    assert.equal(event.status, "suspected"); assert.equal(event.proof.launch.basis, "players");
    const item = (await loadRadarMonth(dayOf(new Date(base)).slice(0, 7))).events.find(e => e.appid === id)!;
    assert.equal(item.launch?.basis, "players"); assert.equal(item.rankAfter, null);
    assert.match(item.headline, /超过 2 万/); assert.doesNotMatch(item.headline, /Top 100/);
  }
});

test("live growth spanning midnight is archived on first surge day and normal hot games stay excluded", async t => {
  const id = 999500005, date = previousDay(dayOf(new Date()), 2);
  const midnight = Date.parse(date + "T16:00:00Z");
  t.mock.timers.enable({ apis: ["Date"], now: midnight + 10 * 60000 });
  await game(id);
  const points = [-300, -240, -180, -10, 5].map((m, i) => ({ at: new Date(midnight + m * 60000).toISOString(), count: i < 3 ? 500 : 8000 }));
  await insertPoints(id, points, "steam-current");
  assert.equal(await evaluate(id, "live"), 1);
  const [event] = await sql`SELECT * FROM radar_events WHERE appid = ${id}`;
  assert.equal(new Date(event.event_day).toISOString().slice(0, 10), date);
  assert.equal(dayOf(event.proof.qualifiedAt), previousDay(date, -1));
  const hot = 999500006; await game(hot);
  await insertPoints(hot, points.map(p => ({ ...p, count: 100000 })), "steam-current");
  assert.equal(await evaluate(hot, "historical"), 0);
});

test("metadata catch-up does not permanently lose an earlier two-sample growth qualification", async t => {
  const id = 999500007, base = Date.now() - 8 * 3600000;
  const p = (minutes: number, count: number) => ({ at: new Date(base + minutes * 60000).toISOString(), count });
  t.mock.timers.enable({ apis: ["Date"], now: base + 195 * 60000 });
  await remember({ app_id: id, name: "Unenriched candidate" }, "news-link");
  await insertPoints(id, [p(0, 500), p(60, 500), p(120, 500), p(180, 8000), p(195, 8000)], "steam-current");
  assert.equal(await evaluate(id, "live", "2026-10-01", false), 0, "live must respect its separate metadata request budget");
  await sql`UPDATE radar_games SET app_type = 'game', metadata_at = now() WHERE appid = ${id}`;
  t.mock.timers.tick(180 * 60000);
  await insertPoints(id, [p(375, 8000)], "steam-current");
  assert.equal(await evaluate(id, "live", "2026-10-01", false), 1);
  const [event] = await sql`SELECT proof FROM radar_events WHERE appid = ${id}`;
  assert.equal(event.proof.qualifiedAt, p(195, 8000).at);
  assert.equal(await evaluate(id, "live", "2026-10-01", false), 0);
});

test("a still-active growth event is updated rather than rediscovered after fourteen days", async () => {
  const id = 999500008, now = Date.now() - 60000, oldDate = previousDay(dayOf(new Date()), 20), start = now - 195 * 60000;
  await game(id);
  await sql`INSERT INTO radar_events (id,appid,event_day,origin,status,kind,peak,baseline,baseline_days,points,rule_version,proof)
    VALUES ('ongoing-growth',${id},${oldDate},'live','confirmed','breakout',8000,500,1,'[]','test',${sql.json({ firstObservedAt: oldDate + "T00:00:00Z" })})`;
  await insertPoints(id, [0, 60, 120, 180, 195].map((m, i) => ({ at: new Date(start + m * 60000).toISOString(), count: i < 3 ? 500 : 10000 })), "steam-current");
  assert.equal(await evaluate(id, "live"), 0);
  const rows = await sql`SELECT id, proof FROM radar_events WHERE appid = ${id}`;
  assert.equal(rows.length, 1); assert.equal(rows[0].id, 'ongoing-growth');
  assert.equal(rows[0].proof.lifecycle.peak, 10000);
});
