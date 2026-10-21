import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";
import {
  answerMetrics,
  citationCaseResult,
  parseAskEvalJsonl,
  retrievalMetrics,
  type RetrievalCaseResult,
} from "../src/evals/core.ts";

const caseRow = (id: string, replay?: Record<string, unknown>) => ({
  caseId: id,
  question: "最近发生了什么？",
  search: { q: "无畏契约", mode: "all", window: "30d", limit: 10 },
  gold: { relevantArticleIds: [`article-${id}`], requiredCitationIds: [1] },
  ...(replay ? { replay } : {}),
});

test("Ask eval JSONL is strict, skips reviewer comments and rejects duplicate ids", () => {
  const text = ["// development set", JSON.stringify(caseRow("a")), "", JSON.stringify(caseRow("b"))].join("\n");
  const rows = parseAskEvalJsonl(text);
  assert.deepEqual(rows.map((row) => row.caseId), ["a", "b"]);
  assert.equal(rows[0]!.search.mode, "all");
  assert.throws(() => parseAskEvalJsonl([JSON.stringify(caseRow("a")), JSON.stringify(caseRow("a"))].join("\n")), /duplicate caseId/);
  assert.throws(() => parseAskEvalJsonl(JSON.stringify({ ...caseRow("a"), invented: true })), /unrecognized/i);
});

test("reviewed GameHot gold cases reference the frozen public snapshot and cover intended strata", () => {
  const rows = parseAskEvalJsonl(readFileSync(new URL("../evals/ask-gold.2026-10-21.jsonl", import.meta.url), "utf8"));
  const snapshot = JSON.parse(gunzipSync(readFileSync(new URL("../evals/fixtures/gamehot-public-2026-10-21.json.gz", import.meta.url))).toString("utf8")) as { items: Array<{ id: string }> };
  const ids = new Set(snapshot.items.map((item) => item.id));
  assert.equal(rows.length, 25);
  assert.equal(snapshot.items.length, 1117);
  for (const row of rows) for (const id of row.gold.relevantArticleIds) assert.ok(ids.has(id), `${row.caseId}: ${id}`);
  const strata = new Set(rows.map((row) => row.samplingContext?.stratum));
  for (const required of ["named-fact", "alias", "semantic-paraphrase", "duplicate-coverage", "negative-control"]) assert.ok(strata.has(required));
});

test("retrieval metrics report macro hit rate, recall, precision, MRR and latency", () => {
  const runtime = { retrievalMode: "keyword-v1", fallbackReason: null, embeddingCalls: 0, embeddingCost: null, embeddingCurrency: null };
  const results: RetrievalCaseResult[] = [
    { caseId: "a", question: "a", returnedArticleIds: ["x", "a"], relevantArticleIds: ["a", "b"], latencyMs: 10, ...runtime, error: null },
    { caseId: "b", question: "b", returnedArticleIds: ["c", "y"], relevantArticleIds: ["c"], latencyMs: 30, ...runtime, error: null },
    { caseId: "negative", question: "negative", returnedArticleIds: [], relevantArticleIds: [], latencyMs: 20, ...runtime, error: null },
  ];
  const metrics = retrievalMetrics(results);
  assert.deepEqual(
    { hitRate: metrics.hitRate, recall: metrics.recall, precision: metrics.precision, mrr: metrics.mrr },
    { hitRate: 1, recall: 0.75, precision: 0.5, mrr: 0.75 },
  );
  assert.deepEqual(metrics.latencyMs, { mean: 20, p50: 20, p95: 30 });
  assert.equal(metrics.noResultAccuracy, 1);
});

test("answer replay separates invalid citations, required coverage, completion and known cost", () => {
  const rows = parseAskEvalJsonl([
    JSON.stringify({
      ...caseRow("a", {
        status: "completed", answer: "结论 [1]，误引 [9]。", evidenceIds: [1, 2],
        latencyMs: 1000, cost: 0.01, currency: "CNY",
      }),
      gold: { relevantArticleIds: ["article-a"], requiredCitationIds: [1, 2], claims: [{ contains: "结论", evidenceAnyOf: [1] }] },
    }),
    JSON.stringify({
      ...caseRow("b", {
        status: "failed", answer: "另一结论 [2]。", evidenceIds: [2],
        latencyMs: 3000, cost: 0.02, currency: "CNY",
      }),
      gold: { relevantArticleIds: ["article-b"], requiredCitationIds: [2], claims: [{ contains: "另一结论", evidenceAnyOf: [1] }] },
    }),
  ].join("\n"));
  const cases = rows.map((row) => citationCaseResult(row)).filter((row) => row !== null);
  const metrics = answerMetrics(cases);
  assert.equal(metrics.completionRate, 0.5);
  assert.equal(metrics.healthyCompletionRate, 0.5);
  assert.equal(metrics.citationPrecision, 0.6667);
  assert.equal(metrics.citationCoverage, 0.6667);
  assert.equal(metrics.claimSupportRate, 0.5);
  assert.equal(metrics.invalidCitations, 1);
  assert.deepEqual(metrics.cost, { knownCases: 2, totals: { CNY: 0.03 }, mean: 0.015 });
});
