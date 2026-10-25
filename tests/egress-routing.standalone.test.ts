// Failures: domestic feeds inherit the proxy's overseas DNS/CDN; a host exception leaks to
// unrelated domains or redirect targets; choosing a direct route bypasses the private-address guard.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, test } from "node:test";
import { MockAgent, getGlobalDispatcher, setGlobalDispatcher } from "undici";
import { DEPLOYMENT } from "@aihot/site";
import { config } from "@aihot/backend/config";
import { guardedFetch } from "@aihot/backend/lib/http-fetch";

const deployment = DEPLOYMENT as unknown as { directFetchHosts?: string[] };
const previousHosts = deployment.directFetchHosts;
const previousProxy = config.egressProxyUrl;
const previousProxyHosts = config.egressProxyHosts;
const previousPrivate = config.allowPrivateNetworkFetch;
const previousDispatcher = getGlobalDispatcher();
const mock = new MockAgent(); mock.disableNetConnect(); setGlobalDispatcher(mock);
let proxyHits = 0;
const proxy = createServer();
proxy.on("connect", (_req, socket) => {
  proxyHits++;
  socket.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
});
await new Promise<void>(resolve => proxy.listen(0, "127.0.0.1", resolve));
config.egressProxyUrl = `http://127.0.0.1:${(proxy.address() as { port: number }).port}`;
config.allowPrivateNetworkFetch = true;
config.egressProxyHosts = [];
deployment.directFetchHosts = ["domestic.invalid", "localhost"];
after(async () => {
  deployment.directFetchHosts = previousHosts;
  config.egressProxyUrl = previousProxy;
  config.egressProxyHosts = previousProxyHosts;
  config.allowPrivateNetworkFetch = previousPrivate;
  setGlobalDispatcher(previousDispatcher);
  await mock.close();
  await new Promise<void>(resolve => proxy.close(() => resolve()));
});

test("configured public host uses the direct transport without consulting proxy DNS", async () => {
  mock.get("https://domestic.invalid").intercept({ path: "/feed" }).reply(200, "feed");
  const before = proxyHits;
  assert.equal((await guardedFetch("https://domestic.invalid/feed", { timeoutMs: 1000 })).text(), "feed");
  assert.equal(proxyHits, before);
});

test("a redirect recalculates routing for its destination instead of inheriting the exception", async () => {
  mock.get("https://domestic.invalid").intercept({ path: "/move" }).reply(302, "", { headers: { location: "https://abroad.invalid/feed" } });
  const before = proxyHits;
  await assert.rejects(guardedFetch("https://domestic.invalid/move", { timeoutMs: 1000 }));
  assert.ok(proxyHits > before);
  assert.equal(mock.pendingInterceptors().some(i => i.path === "/move"), false, "the direct first hop was read");
});

test("the host list matches exact hostnames and explicit direct callers still work", async () => {
  const before = proxyHits;
  await assert.rejects(guardedFetch("https://domestic.invalid.evil.invalid/feed", { timeoutMs: 1000 }));
  assert.ok(proxyHits > before);
  mock.get("https://paid.invalid").intercept({ path: "/api" }).reply(200, "api");
  assert.equal((await guardedFetch("https://paid.invalid/api", { route: "direct" })).text(), "api");
});

test("direct host exceptions never grant permission to fetch a private address", async () => {
  config.allowPrivateNetworkFetch = false;
  try { await assert.rejects(guardedFetch("http://localhost/metadata"), /Blocked/); }
  finally { config.allowPrivateNetworkFetch = true; }
});

test("a scoped proxy leaves unrelated hosts direct and matches only exact hostnames", async () => {
  config.egressProxyHosts = ["abroad.invalid"];
  try {
    for (const host of ["other.invalid", "abroad.invalid.evil.invalid", "child.abroad.invalid"]) {
      mock.get(`https://${host}`).intercept({ path: "/feed" }).reply(200, "direct");
      const before = proxyHits;
      assert.equal((await guardedFetch(`https://${host}/feed`)).text(), "direct");
      assert.equal(proxyHits, before);
    }
    const before = proxyHits;
    await assert.rejects(guardedFetch("https://ABROAD.invalid/feed", { timeoutMs: 1000 }));
    assert.ok(proxyHits > before);
  } finally { config.egressProxyHosts = []; }
});

test("redirect destinations respect proxy scope and out-of-scope requests never reuse its dispatcher", async () => {
  config.egressProxyHosts = ["abroad.invalid"];
  try {
    mock.get("https://other.invalid").intercept({ path: "/move" }).reply(302, "", { headers: { location: "https://abroad.invalid/feed" } });
    const before = proxyHits;
    await assert.rejects(guardedFetch("https://other.invalid/move", { timeoutMs: 1000 }));
    assert.ok(proxyHits > before);
    // A host removed from scope between requests must not keep using the cached proxy dispatcher.
    config.egressProxyHosts = ["other.invalid"];
    mock.get("https://abroad.invalid").intercept({ path: "/move" }).reply(302, "", { headers: { location: "https://domestic.invalid/feed-redirect" } });
    mock.get("https://domestic.invalid").intercept({ path: "/feed-redirect" }).reply(200, "direct");
    const afterProxy = proxyHits;
    assert.equal((await guardedFetch("https://abroad.invalid/move")).text(), "direct");
    assert.equal(proxyHits, afterProxy);
  } finally { config.egressProxyHosts = []; }
});

test("neither a scoped host nor an out-of-scope host bypasses the private-address guard", async () => {
  config.egressProxyHosts = ["localhost"];
  config.allowPrivateNetworkFetch = false;
  try {
    await assert.rejects(guardedFetch("http://localhost/metadata"), /Blocked/);
    await assert.rejects(guardedFetch("http://127.0.0.1/metadata"), /Blocked/);
  } finally { config.egressProxyHosts = []; config.allowPrivateNetworkFetch = true; }
});
