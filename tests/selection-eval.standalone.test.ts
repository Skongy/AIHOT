// Score-only SelectBench decision helpers: writing gate must not force selected=false in eval.
import "./setup.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SCORE_CALLS,
  selectedAtMeanCutoff,
  selectedByScoreThreshold,
} from "@aihot/backend/editorial/analyze";

test("selectedByScoreThreshold selects when sum meets 2× tier threshold without writing", () => {
  const scores = { threshold: 60, values: [70, 70] };
  assert.equal(scores.values.length, SCORE_CALLS);
  const got = selectedByScoreThreshold("PASS", scores);
  assert.equal(got.selected, true);
  assert.equal(got.score, 70);
});

test("selectedByScoreThreshold rejects BLOCK even with high scores", () => {
  const got = selectedByScoreThreshold("BLOCK", { threshold: 60, values: [99, 99] });
  assert.equal(got.selected, false);
  assert.equal(got.score, null);
});

test("selectedByScoreThreshold rejects below tier threshold", () => {
  const got = selectedByScoreThreshold("UNKNOWN", { threshold: 76, values: [70, 70] });
  assert.equal(got.selected, false);
  assert.equal(got.score, 70);
});

test("selectedByScoreThreshold rejects refused or incomplete scores", () => {
  assert.equal(selectedByScoreThreshold("PASS", null).selected, false);
  assert.equal(selectedByScoreThreshold("PASS", { threshold: 60, values: [80], refused: false }).selected, false);
  assert.equal(selectedByScoreThreshold("PASS", { threshold: 60, values: [80, 80], refused: true }).selected, false);
});

test("selectedAtMeanCutoff ignores writing and respects BLOCK", () => {
  assert.equal(selectedAtMeanCutoff("PASS", 70, 60), true);
  assert.equal(selectedAtMeanCutoff("UNKNOWN", 70, 76), false);
  assert.equal(selectedAtMeanCutoff("BLOCK", 99, 40), false);
  assert.equal(selectedAtMeanCutoff("PASS", null, 40), false);
});
