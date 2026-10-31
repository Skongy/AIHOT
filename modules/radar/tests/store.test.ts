import "../../../tests/setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { sql, closeDb } from "@aihot/backend/db";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { installModules } from "@aihot/backend/modules";
import { loadRadarMonth } from "@aihot/backend/publication/radar";
import { ingestHistory, insertPoints, remember } from "../backend/collect.ts";
import { parseCurrent, safeCover, historySchema } from "../backend/steam.ts";
import { buildApp } from "../../../apps/api/src/app.ts";
import radar from "../server.ts";
after(closeDb);
test("valid zero differs from invalid appid/schema; covers stay on official Steam assets", () => {
  assert.equal(parseCurrent({ response: { result: 42, player_count: 0 } }), null);
  assert.equal(parseCurrent({ response: { result: 1, player_count: 0 } }), 0);
  assert.equal(parseCurrent({ response: { result: 1, player_count: -1 } }), null);
  assert.equal(safeCover("https://evil.test/header.jpg"), null);
  assert.equal(safeCover("https://shared.fastly.steamstatic.com/test.jpg"), "https://shared.fastly.steamstatic.com/test.jpg");
  assert.equal(historySchema.safeParse({ app_id: 1, resolution: "day", points: [] }).success, false);
});
test("replayed history is idempotent, retains provenance, rolls up Shanghai days, and never creates events on public reads", async () => {
  const id = 999000001;
  await sql`DELETE FROM radar_events WHERE appid = ${id}`;
  await sql`DELETE FROM radar_samples WHERE appid = ${id}`;
  await sql`DELETE FROM radar_daily WHERE appid = ${id}`;
  await sql`DELETE FROM radar_games WHERE appid = ${id}`;
  await remember({ app_id: id, name: "Radar fixture" }, "test");
  await sql`UPDATE radar_games SET metadata_at = now() WHERE appid = ${id}`;
  const start = new Date(); start.setUTCDate(start.getUTCDate() - 9); start.setUTCHours(16, 0, 0, 0);
  const points = Array.from({ length: 8 * 24 }, (_, h) => ({ t: Math.floor((start.getTime() + h * 3600000) / 1000), player_count: h >= 7 * 24 ? 6000 : 300 }));
  const raw = { app_id: id, resolution: "hour", points };
  const added = await ingestHistory(id, raw); assert.equal(added, 1);
  assert.equal(await ingestHistory(id, raw), 0);
  const [samples] = await sql`SELECT count(*)::int AS n FROM radar_samples WHERE appid = ${id}`; assert.equal(samples.n, 192);
  const [event] = await sql`SELECT * FROM radar_events WHERE appid = ${id}`;
  assert.equal(event.status, "confirmed"); assert.equal(event.origin, "historical"); assert.equal(event.proof.baselineDays.length, 7);
  const month = new Date(event.event_day).toISOString().slice(0, 7);
  const before = await sql`SELECT count(*)::int AS n FROM radar_requests`;
  const view = await loadRadarMonth(month); const item = view.events.find(e => e.appid === id)!;
  assert.equal(item.peak, 6000); assert.equal(item.baseline, 300); assert.equal(item.source, "historical"); assert.equal(item.reason, null);
  assert.equal(item.points.length, 24); assert.equal(item.evidence[0].url.includes(String(id)), true);
  const after = await sql`SELECT count(*)::int AS n FROM radar_requests`; assert.equal(before[0].n, after[0].n);
  await insertPoints(id, [{ at: new Date(points.at(-1)!.t * 1000).toISOString(), count: -1 }], "invalid");
  const [daily] = await sql`SELECT peak FROM radar_daily WHERE appid = ${id} ORDER BY day DESC LIMIT 1`; assert.equal(daily.peak, 6000);
});
test("radar REST validates month and only reads existing rows", async () => {
  installModules([radar]); const app = await buildApp();
  try {
    assert.equal((await app.inject({ url: "/api/radar/month?month=2026-13" })).statusCode, 400);
    const result = await app.inject({ url: "/api/radar/month?month=2026-10" });
    assert.equal(result.statusCode, 200); assert.equal(result.json().month, "2026-10");
    assert.equal(Array.isArray(result.json().coverage), true);
  } finally { await app.close(); installModules([]); }
});

test("batch citation checks keep public sources but redact withdrawn and unreleased explanations", async () => {
  const source = 'radar-evidence-fixture', day = new Date().toISOString().slice(0, 10);
  await sql`INSERT INTO sources (id,name,kind,tier) VALUES (${source},'Radar evidence','rss','T1')`;
  const ids: string[] = [];
  for (let i = 0; i < 3; i++) {
    const { articleId } = await upsertMaterial({ sourceId: source, url: `https://example.org/radar-citation-${i}`, title: '测试游戏报道', publishedAt: new Date(), via: 'fetch' });
    await sql`INSERT INTO publications (article_id,source_id,title,url,channel,discovered_at,timeline_at,sort_at,eligible,visibility,selected,visible_after)
      VALUES (${articleId},${source},'测试游戏报道','https://example.org/report','news',now(),now(),now(),true,${i === 1 ? 'withdrawn' : 'public'},${i === 2},now()+interval '1 day')`;
    ids.push(articleId);
  }
  for (let i = 0; i < 3; i++) {
    const appid = 999300001 + i;
    await remember({ app_id: appid, name: `Evidence ${i}` }, 'test');
    await sql`INSERT INTO radar_events (id,appid,event_day,origin,status,kind,peak,baseline_days,points,rule_version,proof,reason,evidence)
      VALUES (${`${appid}-${day}`},${appid},${day},'live','suspected','watch',6000,0,'[]','test',${sql.json({ source: 'https://api.steampowered.com/' })},'待核验的原因',
        ${sql.json([{ articleId: ids[0], label: '公开报道', url: 'https://example.org/public' }, ...(i ? [{ articleId: ids[i], label: '受限报道', url: 'https://example.org/restricted' }] : [])])})`;
  }
  const events = (await loadRadarMonth(day.slice(0, 7))).events;
  for (let i = 0; i < 3; i++) {
    const event = events.find(e => e.appid === 999300001 + i)!;
    assert.equal(event.reason, i === 0 ? '待核验的原因' : null);
    assert.equal(event.evidence.filter(e => e.articleId).length, 1);
    assert.equal(event.evidence[1].articleId, ids[0]);
  }
});
