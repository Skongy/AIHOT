// Provider 429 / quota answers become BudgetExceededError so analysis waits quietly (no attempts burn).
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertAccepted,
  BudgetExceededError,
  isProviderQuotaError,
  parseRetryAfterSeconds,
  ProviderRejectedError,
} from "@aihot/backend/providers/receipts";

test("isProviderQuotaError recognizes 429 and quota-shaped bodies", () => {
  assert.equal(isProviderQuotaError(429, "whatever"), true);
  assert.equal(isProviderQuotaError(403, "insufficient_quota on token plan"), true);
  assert.equal(isProviderQuotaError(400, "rate_limit exceeded: TPM"), true);
  assert.equal(isProviderQuotaError(503, "额度已用尽，请稍后重试"), true);
  assert.equal(isProviderQuotaError(401, "invalid api key"), false);
  assert.equal(isProviderQuotaError(500, "internal error"), false);
  assert.equal(isProviderQuotaError(403, "forbidden for this org"), false);
});

test("parseRetryAfterSeconds accepts delta-seconds and clamps", () => {
  assert.equal(parseRetryAfterSeconds("120"), 120);
  assert.equal(parseRetryAfterSeconds("0"), undefined);
  assert.equal(parseRetryAfterSeconds("999999"), 86_400);
  assert.equal(parseRetryAfterSeconds(null), undefined);
});

test("assertAccepted maps quota to BudgetExceededError and keeps hard refusals", () => {
  assert.doesNotThrow(() => assertAccepted("llm", 200, "ok"));
  assert.throws(
    () => assertAccepted("llm", 429, "rate limited", { retryAfterSeconds: 90 }),
    (err: unknown) => err instanceof BudgetExceededError && err.retryAfterSeconds === 90 && /provider/.test(err.message),
  );
  assert.throws(
    () => assertAccepted("llm", 403, "insufficient_quota"),
    BudgetExceededError,
  );
  assert.throws(
    () => assertAccepted("llm", 401, "bad key"),
    (err: unknown) => err instanceof ProviderRejectedError && err.retryable === false && err.status === 401,
  );
  assert.throws(
    () => assertAccepted("llm", 502, "bad gateway"),
    (err: unknown) => err instanceof ProviderRejectedError && err.retryable === true && err.status === 502,
  );
});
