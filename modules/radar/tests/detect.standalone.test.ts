import assert from "node:assert/strict";
import { test } from "node:test";
import { confirmationPoints, dailyPoints, dayOf, detect } from "../backend/detect.ts";
import type { RadarPoint } from "../types.ts";
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
