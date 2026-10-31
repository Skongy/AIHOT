import "../../../tests/setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createRequire } from "node:module";
import { sql, closeDb } from "@aihot/backend/db";
import { config } from "@aihot/backend/config";
import { publicJson } from "../backend/steam.ts";

const { MockAgent, getGlobalDispatcher, setGlobalDispatcher } = createRequire(new URL("../../../packages/backend/package.json", import.meta.url))("undici");
const previous = getGlobalDispatcher(), mock = new MockAgent(); mock.disableNetConnect(); setGlobalDispatcher(mock);
const savedPrivate = config.allowPrivateNetworkFetch, savedProxy = config.egressProxyUrl;
config.allowPrivateNetworkFetch = true; config.egressProxyUrl = null;
after(async () => { config.allowPrivateNetworkFetch = savedPrivate; config.egressProxyUrl = savedProxy; setGlobalDispatcher(previous); await mock.close(); await closeDb(); });
const host = "api.steamdata.dev", url = `https://${host}/api/apps/1/history?range=30d`;
function success() { mock.get(`https://${host}`).intercept({ path: "/api/apps/1/history?range=30d" }).reply(200, { ok: true }); }

test("Retry-After remains binding beyond the short failure window and newer requests", async () => {
  await sql`INSERT INTO radar_requests (host,path,status,at,retry_at) VALUES (${host},'/rate-limit',429,now()-interval '20 minutes',now()+interval '40 minutes')`;
  for (let i = 0; i < 3; i++) await sql`INSERT INTO radar_requests (host,path,status) VALUES (${host},'/concurrent',200)`;
  success();
  await assert.rejects(publicJson(url), /cooling down/);
  assert.equal((await sql`SELECT 1 FROM radar_requests WHERE path = '/api/apps/1/history'`).length, 0);
  await sql`DELETE FROM radar_requests`;
  assert.deepEqual(await publicJson(url), { ok: true });
});

test("missing app histories do not trip the host-wide server failure breaker", async () => {
  await sql`DELETE FROM radar_requests`;
  for (let i = 0; i < 3; i++) await sql`INSERT INTO radar_requests (host,path,status,error) VALUES (${host},'/missing',404,'Radar upstream HTTP 404')`;
  success();
  assert.deepEqual(await publicJson(url), { ok: true });
});

test("three recent server failures cool down, and collection can resume after the window", async () => {
  await sql`DELETE FROM radar_requests`;
  for (let i = 0; i < 3; i++) await sql`INSERT INTO radar_requests (host,path,status,error) VALUES (${host},'/unavailable',503,'Radar upstream HTTP 503')`;
  await assert.rejects(publicJson(url), /cooling down/);
  await sql`UPDATE radar_requests SET at = now()-interval '16 minutes'`;
  success(); assert.deepEqual(await publicJson(url), { ok: true });
});
