import { z } from "zod";
import { PUBLIC_API_CATEGORY_KEYS } from "@aihot/contracts/taxonomy";

const TaskStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "completed_degraded",
  "failed",
  "cancelled",
  "limit_reached",
]);

const SearchSchema = z.strictObject({
  q: z.string().min(2).max(200),
  mode: z.enum(["selected", "all"]).default("all"),
  window: z.enum(["1h", "24h", "7d", "30d", "all"]).default("all"),
  from: z.string().max(40).optional(),
  until: z.string().max(40).optional(),
  category: z.enum(PUBLIC_API_CATEGORY_KEYS).optional(),
  limit: z.number().int().min(1).max(30).default(10),
});

const ReplaySchema = z.strictObject({
  status: TaskStatusSchema,
  answer: z.string(),
  evidenceIds: z.array(z.number().int().positive()),
  latencyMs: z.number().nonnegative(),
  cost: z.number().nonnegative().nullable().default(null),
  currency: z.string().min(1).max(12).nullable().default(null),
});

const CaseSchema = z.strictObject({
  caseId: z.string().min(1).max(160),
  question: z.string().min(1).max(2000),
  search: SearchSchema,
  gold: z.strictObject({
    relevantArticleIds: z.array(z.string().min(1).max(128)),
    /** Citation numbers are task-local and therefore belong to the replay gold. */
    requiredCitationIds: z.array(z.number().int().positive()).default([]),
    claims: z.array(z.strictObject({
      contains: z.string().min(1).max(300),
      evidenceAnyOf: z.array(z.number().int().positive()).min(1),
    })).default([]),
  }),
  /** Load an actual persisted Ask execution without issuing another model call. */
  taskId: z.uuid().optional(),
  replay: ReplaySchema.optional(),
  samplingContext: z.strictObject({
    split: z.string().min(1).max(40).optional(),
    stratum: z.string().min(1).max(80).optional(),
  }).optional(),
}).superRefine((row, context) => {
  if (row.taskId && row.replay) context.addIssue({ code: "custom", message: "use taskId or replay, not both" });
});

export type AskEvalCase = z.infer<typeof CaseSchema>;
export type AskEvalReplay = z.infer<typeof ReplaySchema>;

export interface RetrievalCaseResult {
  caseId: string;
  question: string;
  returnedArticleIds: string[];
  relevantArticleIds: string[];
  latencyMs: number;
  retrievalMode: string;
  fallbackReason: string | null;
  embeddingCalls: number;
  embeddingCost: number | null;
  embeddingCurrency: string | null;
  error: string | null;
}

export interface CitationCaseResult {
  caseId: string;
  citedIds: number[];
  evidenceIds: number[];
  requiredCitationIds: number[];
  claims: number;
  supportedClaims: number;
  validCitations: number;
  invalidCitations: number;
  coveredRequiredCitations: number;
  status: z.infer<typeof TaskStatusSchema>;
  latencyMs: number;
  cost: number | null;
  currency: string | null;
}

/** Blank lines and // comments are ignored so a gold set can carry reviewer notes. */
export function parseAskEvalJsonl(text: string): AskEvalCase[] {
  const rows: AskEvalCase[] = [];
  const ids = new Set<string>();
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    if (!raw.trim() || raw.trim().startsWith("//")) continue;
    let row: AskEvalCase;
    try {
      row = CaseSchema.parse(JSON.parse(raw));
    } catch (error) {
      throw new Error(`line ${index + 1}: ${error instanceof z.ZodError ? z.prettifyError(error) : String(error)}`);
    }
    if (ids.has(row.caseId)) throw new Error(`line ${index + 1}: duplicate caseId ${row.caseId}`);
    ids.add(row.caseId);
    rows.push(row);
  }
  if (!rows.length) throw new Error("evaluation dataset has no cases");
  return rows;
}

const round = (value: number) => +value.toFixed(4);
const ratio = (numerator: number, denominator: number, empty = 0) => denominator ? numerator / denominator : empty;
const mean = (values: number[]) => ratio(values.reduce((sum, value) => sum + value, 0), values.length);

function percentile(values: number[], percentileValue: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.ceil(percentileValue * sorted.length) - 1);
  return sorted[index]!;
}

export function retrievalMetrics(results: RetrievalCaseResult[]) {
  const evaluated = results.filter((result) => result.error === null);
  const positives = evaluated.filter((result) => result.relevantArticleIds.length > 0);
  const negatives = evaluated.filter((result) => result.relevantArticleIds.length === 0);
  const rows = positives.map((result) => {
    const relevant = new Set(result.relevantArticleIds);
    const hits = result.returnedArticleIds.filter((id) => relevant.has(id));
    const firstRank = result.returnedArticleIds.findIndex((id) => relevant.has(id)) + 1;
    return {
      hit: hits.length > 0,
      recall: ratio(new Set(hits).size, relevant.size),
      precision: ratio(hits.length, result.returnedArticleIds.length),
      reciprocalRank: firstRank > 0 ? 1 / firstRank : 0,
    };
  });
  const latencies = evaluated.map((result) => result.latencyMs);
  const knownCosts = evaluated.filter((result): result is RetrievalCaseResult & { embeddingCost: number } => result.embeddingCost !== null);
  const costTotals = new Map<string, number>();
  for (const result of knownCosts) {
    const currency = result.embeddingCurrency ?? "unknown";
    costTotals.set(currency, (costTotals.get(currency) ?? 0) + result.embeddingCost);
  }
  return {
    cases: results.length,
    evaluated: evaluated.length,
    errors: results.length - evaluated.length,
    coverage: round(ratio(evaluated.length, results.length)),
    positiveCases: positives.length,
    negativeCases: negatives.length,
    noResultAccuracy: round(ratio(negatives.filter((result) => result.returnedArticleIds.length === 0).length, negatives.length, 1)),
    hitRate: round(mean(rows.map((row) => Number(row.hit)))),
    recall: round(mean(rows.map((row) => row.recall))),
    precision: round(mean(rows.map((row) => row.precision))),
    mrr: round(mean(rows.map((row) => row.reciprocalRank))),
    latencyMs: {
      mean: Math.round(mean(latencies)),
      p50: Math.round(percentile(latencies, 0.5)),
      p95: Math.round(percentile(latencies, 0.95)),
    },
    retrievalModes: Object.fromEntries([...new Set(evaluated.map((result) => result.retrievalMode))].sort()
      .map((mode) => [mode, evaluated.filter((result) => result.retrievalMode === mode).length])),
    fallbackCases: evaluated.filter((result) => result.fallbackReason !== null).length,
    cost: {
      embeddingCalls: evaluated.reduce((sum, result) => sum + result.embeddingCalls, 0),
      knownCases: knownCosts.length,
      totals: Object.fromEntries([...costTotals].map(([currency, total]) => [currency, round(total)])),
    },
  };
}

export function citationCaseResult(row: AskEvalCase, replay = row.replay): CitationCaseResult | null {
  if (!replay) return null;
  const citedIds = [...new Set([...replay.answer.matchAll(/\[(\d+)\]/g)].map((match) => Number(match[1])))];
  const evidence = new Set(replay.evidenceIds);
  const required = new Set(row.gold.requiredCitationIds);
  const valid = citedIds.filter((id) => evidence.has(id));
  const supportedClaims = row.gold.claims.filter((claim) => {
    const at = replay.answer.indexOf(claim.contains);
    if (at < 0) return false;
    const start = replay.answer.lastIndexOf("\n", at) + 1;
    const next = replay.answer.indexOf("\n", at + claim.contains.length);
    const line = replay.answer.slice(start, next < 0 ? undefined : next);
    const local = new Set([...line.matchAll(/\[(\d+)\]/g)].map((match) => Number(match[1])));
    return claim.evidenceAnyOf.some((id) => evidence.has(id) && local.has(id));
  }).length;
  return {
    caseId: row.caseId,
    citedIds,
    evidenceIds: replay.evidenceIds,
    requiredCitationIds: row.gold.requiredCitationIds,
    claims: row.gold.claims.length,
    supportedClaims,
    validCitations: valid.length,
    invalidCitations: citedIds.length - valid.length,
    coveredRequiredCitations: valid.filter((id) => required.has(id)).length,
    status: replay.status,
    latencyMs: replay.latencyMs,
    cost: replay.cost,
    currency: replay.currency,
  };
}

export function answerMetrics(results: CitationCaseResult[]) {
  const totalCitations = results.reduce((sum, result) => sum + result.citedIds.length, 0);
  const validCitations = results.reduce((sum, result) => sum + result.validCitations, 0);
  const required = results.reduce((sum, result) => sum + result.requiredCitationIds.length, 0);
  const covered = results.reduce((sum, result) => sum + result.coveredRequiredCitations, 0);
  const claims = results.reduce((sum, result) => sum + result.claims, 0);
  const supportedClaims = results.reduce((sum, result) => sum + result.supportedClaims, 0);
  const completed = results.filter((result) => result.status === "completed" || result.status === "completed_degraded").length;
  const healthy = results.filter((result) => result.status === "completed").length;
  const latencies = results.map((result) => result.latencyMs);
  const knownCosts = results.filter((result): result is CitationCaseResult & { cost: number } => result.cost !== null);
  const totals = new Map<string, number>();
  for (const result of knownCosts) {
    const currency = result.currency ?? "unknown";
    totals.set(currency, (totals.get(currency) ?? 0) + result.cost);
  }
  return {
    cases: results.length,
    completionRate: round(ratio(completed, results.length)),
    healthyCompletionRate: round(ratio(healthy, results.length)),
    citationPrecision: round(ratio(validCitations, totalCitations, required === 0 ? 1 : 0)),
    citationCoverage: round(ratio(covered, required, 1)),
    claimSupportRate: round(ratio(supportedClaims, claims, 1)),
    claims,
    supportedClaims,
    invalidCitations: totalCitations - validCitations,
    latencyMs: {
      mean: Math.round(mean(latencies)),
      p50: Math.round(percentile(latencies, 0.5)),
      p95: Math.round(percentile(latencies, 0.95)),
    },
    cost: {
      knownCases: knownCosts.length,
      totals: Object.fromEntries([...totals].map(([currency, total]) => [currency, round(total)])),
      mean: totals.size === 1 ? round(mean(knownCosts.map((result) => result.cost))) : null,
    },
  };
}
