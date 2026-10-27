import assert from "node:assert/strict";
import { after, test } from "node:test";
import Fastify from "fastify";
import { closeDb } from "@aihot/backend/db";
import { config } from "@aihot/backend/config";
import { referrerOrigin, visitIp, visitPath } from "@aihot/backend/operations/visits";
import { registerVisits } from "../apps/api/src/routes/visits.ts";
import { adminHandler } from "../apps/api/src/routes/admin-auth.ts";

after(closeDb);

test("visit input strips secrets and excludes non-page/admin paths", () => {
  assert.equal(visitPath("/ask?question=private#token"), "/ask");
  for (const path of [null, {}, "https://evil.test/", "//evil.test", "/admin", "/admin/login", "/%61dmin/login", "/api/health", "/assets/main.js", "/foo/../admin", "/%", "/a\\b", "/x\ny", "/" + "x".repeat(512)]) assert.equal(visitPath(path), null);
  assert.equal(visitPath("/radar"), "/radar");
  assert.equal(visitPath("/"), "/");
  assert.equal(referrerOrigin("https://user:pass@example.com/private?token=secret#fragment"), "https://example.com");
  assert.equal(referrerOrigin("javascript:alert(1)"), null);
  assert.equal(referrerOrigin(""), null);
});

test("visitor IP uses the proxy's rightmost address rather than a spoofed left entry", () => {
  assert.equal(visitIp("1.2.3.4, 203.0.113.9", "127.0.0.1"), "203.0.113.9");
  assert.equal(visitIp(undefined, "::ffff:127.0.0.1"), "127.0.0.1");
  assert.equal(visitIp("2001:db8::1", "127.0.0.1"), "2001:db8::1");
  assert.equal(visitIp("bad", "127.0.0.1"), null);
});

test("public collection rejects cross-origin/malformed reports; records are admin-only", async () => {
  const app = Fastify();
  const dev = config.devAdmin;
  config.devAdmin = null;
  registerVisits(app);
  app.get("/api/admin/visits", adminHandler(async () => { assert.fail("anonymous must not reach visitor data"); }));
  try {
    const headers = { origin: new URL(config.siteUrl).origin };
    assert.equal((await app.inject({ method: "POST", url: "/api/site/visit", payload: { path: "/" } })).statusCode, 403);
    assert.equal((await app.inject({ method: "POST", url: "/api/site/visit", headers: { origin: "https://evil.test" }, payload: { path: "/" } })).statusCode, 403);
    assert.equal((await app.inject({ method: "POST", url: "/api/site/visit", headers: { ...headers, "sec-fetch-site": "cross-site" }, payload: { path: "/" } })).statusCode, 403);
    assert.equal((await app.inject({ method: "POST", url: "/api/site/visit", headers, payload: { path: "/admin" } })).statusCode, 400);
    assert.equal((await app.inject({ method: "POST", url: "/api/site/visit", headers, payload: { path: "/" + "x".repeat(2100) } })).statusCode, 413);
    const result = await app.inject("/api/admin/visits");
    assert.equal(result.statusCode, 401);
    assert.equal(result.headers["cache-control"], "no-store");
  } finally { config.devAdmin = dev; await app.close(); }
});
