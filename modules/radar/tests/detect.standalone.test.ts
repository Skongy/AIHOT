import assert from "node:assert/strict";
import { test } from "node:test";
import { confirmationPoints, dailyPoints, dayOf, detect, detectLaunch } from "../backend/detect.ts";
import type { RadarPoint } from "../types.ts";
import { appSchema, officialNewsUrl } from "../backend/steam.ts";
function series(days = 8, before = 300, after = 6000): RadarPoint[] {
  return Array.from({ length: days * 24 }, (_, h) => ({ at: new Date(Date.parse("2026-10-01T00:00:00+08:00") + h * 3600000).toISOString(), count: h >= (days - 1) * 24 ? after : before }));
}
test("hourly historical growth has a seven-day baseline and emits one confirmed event", () => {
  const result = detect(series()); assert.equal(result.length, 1);
  assert.equal(result[0].date, "2026-10-08"); assert.equal(result[0].status, "confirmed"); assert.equal(result[0].baseline, 300);
});
test("short history is explicitly suspected; starting to monitor a hot game is not an ascent", () => {
  assert.equal(detect(series(4))[0].status, "suspected");
  assert.deepEqual(detect(series(1, 6000, 6000)), []);
  assert.deepEqual(detect(series(8, 0, 6000)).map(s => s.status), ["suspected"]);
});
test("large releases, known established games and everyday noise do not enter confirmed blackhorses", () => {
  assert.deepEqual(detect(series(), { established: true }), []);
  assert.deepEqual(detect(series(8, 300, 60000), { releaseDay: "2026-10-07" }), []);
  assert.deepEqual(detect(series(8, 10000, 14000)), []);
  assert.deepEqual(detect(series(8, 10, 100)), []);
});
test("cached repeats and faster sampling cannot fabricate three hourly confirmations", () => {
  const ps = series().slice(0, 7 * 24); const at = "2026-10-08T04:00:00Z";
  ps.push(...Array.from({ length: 20 }, (_, i) => ({ at: new Date(Date.parse(at) + i * 10000).toISOString(), count: 10000 })));
  assert.deepEqual(detect(ps), []);
});
test("Shanghai midnight, true zeros, invalid readings and missing days retain their meaning", () => {
  assert.equal(dayOf("2026-10-01T16:00:00Z"), "2026-10-02");
  const daily = dailyPoints([{ at: "2026-10-01T16:00:00Z", count: 0 }, { at: "bad", count: 100 }, { at: "2026-10-02T01:00:00Z", count: -1 }]);
  assert.equal(daily.length, 1); assert.equal(daily[0].peak, 0); assert.equal(daily[0].hours, 1);
});
test("sustained surge is one event during cooldown; established low periods can rearm", () => {
  const ps = series(8);
  for (let i = 0; i < 4 * 24; i++) ps.push({ at: new Date(Date.parse(ps.at(-1)!.at) + 3600000).toISOString(), count: 6500 });
  assert.equal(detect(ps).length, 1);
});
test("watch promotion needs three independently timed readings above the full confirmation threshold", () => {
  const at = Date.parse("2026-10-26T01:00:00Z");
  const points = [5000, 5100, 5200].map((count, i) => ({ at: new Date(at + i * 3600000).toISOString(), count }));
  assert.equal(confirmationPoints(points, 1000).length, 3);
  assert.deepEqual(confirmationPoints(points.slice(0, 2), 1000), []);
  assert.deepEqual(confirmationPoints(points, 0), []);
  assert.deepEqual(confirmationPoints(points.map(p => ({ ...p, count: 4000 })), 1000), []);
});
test("real catalog null metadata is accepted without inventing a game name or cover", () => {
  const game = appSchema.parse({ app_id: 123, name: null, header_image: null, player_count: 100 });
  assert.equal(game.name, ""); assert.equal(game.header_image, undefined);
  assert.equal(appSchema.safeParse({ app_id: -1, name: null }).success, false);
});
test("actual Steam legacy announcement links keep their identity on the canonical official host", () => {
  assert.equal(officialNewsUrl("https://steamstore-a.akamaihd.net/news/externalpost/steam_community_announcements/1847286114032610"), "https://store.steampowered.com/news/externalpost/steam_community_announcements/1847286114032610");
  assert.equal(officialNewsUrl("https://steamstore-a.akamaihd.net/elsewhere"), null);
  assert.equal(officialNewsUrl("https://store.steampowered.com.evil.test/news/123"), null);
  assert.equal(officialNewsUrl("javascript:alert(1)"), null);
});

test("new launch needs independent Top100 observations, no low baseline or publisher exclusion", () => {
  const first = { at: "2026-10-29T01:00:00Z", count: 110000, rank: 3 };
  const second = { at: "2026-10-29T01:15:00Z", count: 300000, rank: 2 };
  assert.equal(detectLaunch([first, second], "2026-10-28", "game")?.date, "2026-10-29");
  assert.equal(detectLaunch([first, first], "2026-10-28", "game"), null);
  assert.equal(detectLaunch([first], "2026-10-28", "game"), null);
  assert.equal(detectLaunch([first, { ...second, at: "2026-10-29T02:00:00Z" }], "2026-10-28", "game"), null);
  for (const type of ["dlc", "demo", null]) assert.equal(detectLaunch([first, second], "2026-10-28", type), null);
  for (const date of [null, "2026-02-30", "2026-10-01", "2026-10-30"]) assert.equal(detectLaunch([first, second], date, "game"), null);
  assert.equal(detectLaunch([first, second].map(p => ({ ...p, rank: 101 })), "2026-10-28", "game"), null);
  assert.equal(detectLaunch([first, second].map(p => ({ ...p, rank: null, count: 9000 })), "2026-10-28", "game")?.qualification.length, 2);
  assert.ok(detectLaunch([first, second], "2026-10-16", "game"));
  assert.equal(detectLaunch([first, second], "2026-10-15", "game"), null);
});

test("launch confirmation crossing Shanghai midnight retains the first observation day", () => {
  const points = [{ at: "2026-10-28T15:50:00Z", count: 12000, rank: 99 }, { at: "2026-10-28T16:05:00Z", count: 15000, rank: 95 }];
  const signal = detectLaunch(points, "2026-10-28", "game")!;
  assert.equal(signal.date, "2026-10-28"); assert.equal(dayOf(signal.qualifiedAt), "2026-10-29");
});
