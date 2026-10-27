import "./setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import Fastify from "fastify";
import { closeDb, sql } from "@aihot/backend/db";
import { config } from "@aihot/backend/config";
import { listVisits } from "@aihot/backend/admin/visits";
import { pruneVisits } from "@aihot/backend/operations/visits";
import { registerVisits } from "../apps/api/src/routes/visits.ts";

after(closeDb);

test("real visit writes, Beijing day boundaries, exact-IP filtering, paging and retention", async () => {
  const app = Fastify();
  registerVisits(app);
  try {
    const result = await app.inject({ method: "POST", url: "/api/site/visit", headers: {
      origin: new URL(config.siteUrl).origin, "x-forwarded-for": "1.1.1.1, 203.0.113.9", "user-agent": "Test Browser",
    }, payload: { path: "/radar?secret=ignored", referrer: "https://example.com/private?secret=ignored" } });
    assert.equal(result.statusCode, 204);
    assert.equal(result.headers["cache-control"], "no-store");
    const [saved] = await sql`SELECT host(ip) AS ip, path, referrer_origin, user_agent FROM site_visits WHERE path = '/radar'`;
    assert.deepEqual(saved, { ip: "203.0.113.9", path: "/radar", referrer_origin: "https://example.com", user_agent: "Test Browser" });
    for (const at of ["2026-10-25T15:59:59Z", "2026-10-25T16:00:00Z", "2026-10-26T15:59:59Z", "2026-10-26T16:00:00Z"]) {
      await sql`INSERT INTO site_visits (visited_at, ip, path, user_agent) VALUES (${new Date(at)}, '2001:db8::1', '/', '')`;
    }
    const filtered = await listVisits({ date: "2026-10-26", ip: "2001:db8::1" });
    assert.equal(filtered.rows.length, 2);
    assert.deepEqual(filtered.summary, { views: 2, ips: 1 });
    for (let i = 0; i < 51; i++) await sql`INSERT INTO site_visits (visited_at, ip, path, user_agent) VALUES ('2026-10-26T00:00:00Z', '192.0.2.1', '/', '')`;
    const first = await listVisits({ date: "2026-10-26", ip: "192.0.2.1" });
    const second = await listVisits({ date: "2026-10-26", ip: "192.0.2.1", page: "2" });
    assert.equal(first.rows.length, 50); assert.equal(first.hasMore, true);
    assert.equal(second.rows.length, 1); assert.equal(second.hasMore, false);
    assert.ok(!first.rows.some((r) => r.id === second.rows[0]!.id));
    for (const f of [{ date: "2026-02-30" }, { ip: "1.2.3.4/24" }, { page: "Infinity" }, { page: "1.5" }]) await assert.rejects(listVisits(f), { statusCode: 400 });
    await sql`INSERT INTO site_visits (visited_at, ip, path, user_agent) VALUES ('2000-01-01', '192.0.2.2', '/', '')`;
    await pruneVisits(new Date("2026-10-27T00:00:00Z"));
    assert.equal((await sql`SELECT 1 FROM site_visits WHERE ip = '192.0.2.2'::inet`).length, 0);
    assert.equal((await listVisits({ date: "2026-10-26", ip: "192.0.2.1" })).summary.views, 51);
  } finally { await app.close(); }
});

test("collection throttles repeated reports without returning visitor data", async () => {
  const app = Fastify(); registerVisits(app);
  try {
    const report = () => app.inject({ method: "POST", url: "/api/site/visit", headers: {
      origin: new URL(config.siteUrl).origin, "x-forwarded-for": "192.0.2.99",
    }, payload: { path: "/hot" } });
    for (let i = 0; i < 60; i++) assert.equal((await report()).statusCode, 204);
    const refused = await report();
    assert.equal(refused.statusCode, 429);
    assert.equal(refused.headers["retry-after"], "60");
    assert.equal(refused.body, "");
  } finally { await app.close(); }
});
