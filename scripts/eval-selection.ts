// Checks the selection against your own labelled samples (a "gold set"): each case runs the site's
// selection steps (editorial/analyze.ts) — the prefilter, then the score prompt twice with every model in
// --models, the two scores deciding against the source tier's threshold — and is compared with your
// decision. Eval uses score+tier only (selectedByScoreThreshold); it does not require writing, so
// score-only runs no longer force selected=false. A threshold sweep shows what another mean cutoff
// would have done. Never writes industry/selection.ts — suggestions are printed only.
// The gold file has one case per line as GoldRow below describes; lines starting with // are skipped.
// Usage: node --env-file=.env scripts/eval-selection.ts [--gold .data/gold.jsonl] [--models default,deepseek-flash] [--n 200] [--split all] [--label "..."]
// Receipts make re-runs free; "either" cases are excluded from decisive metrics. Each run is also
// imported into SelectBench (admin → SelectBench) with every case, unless --no-import is given.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { DEPLOYMENT } from "@aihot/site";
import { REPO_ROOT } from "@aihot/backend/config";
import { closeDb } from "@aihot/backend/db";
import {
  SELECTION_PROMPT_VERSION,
  buildScoreInput,
  normalizeAnalysis,
  runSelectionPrefilter,
  runSelectionScores,
  selectedAtMeanCutoff,
  selectedByScoreThreshold,
  tierThreshold,
  type AnalysisRun,
  type AnalyzeInputArticle,
} from "@aihot/backend/editorial/analyze";
import { importSelectBenchRun } from "@aihot/backend/admin/selectbench";
import { evalModels, pmap, positiveInt, safeReportNamePart, usageFor } from "./eval-tools.ts";

// Without options: the site's gold set (site.ts DEPLOYMENT.selectionGold), else the whole of .data/gold.jsonl
// (up to 200 cases), swept over a wide range of thresholds.
const own = DEPLOYMENT.selectionGold;
const defaults = own
  ? { gold: own.file, n: String(own.sample), split: own.split, sweep: own.sweep }
  : { gold: ".data/gold.jsonl", n: "200", split: "all", sweep: [40, 90] };

const { values } = parseArgs({
  options: {
    gold: { type: "string", default: defaults.gold },
    models: { type: "string" },
    n: { type: "string", default: defaults.n },
    split: { type: "string", default: defaults.split },
    concurrency: { type: "string", default: "6" },
    seed: { type: "string", default: "7" },
    label: { type: "string" },
    "no-import": { type: "boolean", default: false },
  },
});

interface GoldRow {
  caseId: string;
  material: {
    title: string;
    originalTitle: string | null;
    publishedAt: string | null;
    sourceName: string;
    bodyZh: string | null;
    bodyOriginal: string | null;
    sourceUrl?: string | null;
  };
  sourceFacts: { sourceKind: string; sourceTier?: string; firstParty?: boolean; language?: string | null };
  /** Optional: a split (e.g. development / holdout) and a stratum for reading the mistakes. */
  samplingContext?: { benchmarkSplit?: string; samplingStratum?: string };
  gold: { decision: "select" | "reject" | "either"; note?: string };
}

const rows: GoldRow[] = readFileSync(path.resolve(REPO_ROOT, values.gold!), "utf8")
  .split("\n").filter((l) => l.trim() && !l.trim().startsWith("//")).map((l) => JSON.parse(l));

// Deterministic stratified sample.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}
const rand = rng(Number(values.seed));
const pool = values.split === "all" ? rows : rows.filter((r) => r.samplingContext?.benchmarkSplit === values.split);
const shuffled = pool.map((r) => ({ r, k: rand() })).sort((a, b) => a.k - b.k).map((x) => x.r);
const sample = shuffled.slice(0, positiveInt(values.n!, "n"));
const concurrency = positiveInt(values.concurrency!, "concurrency");

function toInput(r: GoldRow): AnalyzeInputArticle {
  const m = r.material;
  const isX = r.sourceFacts.sourceKind === "x_search";
  const body = m.bodyOriginal || m.bodyZh || null;
  return {
    id: `gold-${r.caseId}`,
    revision: 1,
    bodyStatus: "ok",
    title: m.originalTitle || m.title,
    url: m.sourceUrl || ("https://example.invalid/" + r.caseId),
    author: null,
    publishedAt: m.publishedAt ? new Date(m.publishedAt) : null,
    bodyText: isX ? null : body,
    excerpt: null,
    xPost: isX ? { authorName: m.sourceName, handle: "", text: body ?? m.title } : null,
    media: [],
    source: { name: m.sourceName, kind: r.sourceFacts.sourceKind, tier: r.sourceFacts.sourceTier ?? "T2", firstParty: r.sourceFacts.firstParty ?? false },
  };
}

type Counts = { tp: number; fp: number; fn: number; tn: number };

function emptyCounts(): Counts {
  return { tp: 0, fp: 0, fn: 0, tn: 0 };
}

function addPred(c: Counts, predSelect: boolean, goldSelect: boolean) {
  if (predSelect && goldSelect) c.tp++;
  else if (predSelect) c.fp++;
  else if (goldSelect) c.fn++;
  else c.tn++;
}

function metricsOf(c: Counts) {
  const decisive = c.tp + c.fp + c.fn + c.tn;
  const precision = c.tp / Math.max(1, c.tp + c.fp);
  const recall = c.tp / Math.max(1, c.tp + c.fn);
  const f1 = (2 * precision * recall) / Math.max(1e-9, precision + recall);
  return {
    ...c,
    decisive,
    accuracy: +((c.tp + c.tn) / Math.max(1, decisive)).toFixed(3),
    precision: +precision.toFixed(3),
    recall: +recall.toFixed(3),
    f1: +f1.toFixed(3),
    selectedRate: +((c.tp + c.fp) / Math.max(1, decisive)).toFixed(3),
    goldSelectRate: +((c.tp + c.fn) / Math.max(1, decisive)).toFixed(3),
  };
}

/** Read-only suggestion from a uniform-t sweep; never writes industry/selection.ts. */
function suggestFromSweep(sweep: Array<Record<string, number>>) {
  if (!sweep.length) return null;
  const minP = 0.8;
  const eligible = sweep.filter((s) => (s.P ?? 0) >= minP);
  const pool = eligible.length ? eligible : sweep;
  const best = pool.reduce((a, b) => ((b.F1 ?? 0) > (a.F1 ?? 0) ? b : a));
  return {
    uniformMean: best.t,
    note: eligible.length
      ? `uniform-t 中 P≥${minP} 时 F1 最高的 t=${best.t}（仅建议；按分级门槛需人工映射到 T1/T1_5/T2，勿自动写回 selection.ts）`
      : `无 P≥${minP} 的点；退而取 F1 最高的 t=${best.t}（仅建议，勿自动写回 selection.ts）`,
    P: best.P,
    R: best.R,
    F1: best.F1,
  };
}

const models = await evalModels(values.models, "score");

const report: Record<string, unknown> = {};
for (const model of models) {
  const started = Date.now();
  // Two gold cases can have different source metadata / thresholds while rendering the same score prompt.
  // Share only that score result (including a failure); prefilter and threshold semantics remain per case.
  const scoreRequests = new Map<string, Promise<{ scores: AnalysisRun["scores"]; receiptIds: number[]; error: string | null }>>();
  const results = await pmap(sample, concurrency, async (r) => {
    const input = toInput(r);
    const receiptIds: number[] = [];
    const tier = input.source.tier;
    try {
      const prefilter = await runSelectionPrefilter(input, {}, (id) => receiptIds.push(id));
      if (prefilter.label === "BLOCK") {
        const run: AnalysisRun = { prefilter, scores: null, writing: null, structure: null };
        const out = normalizeAnalysis(run);
        const decision = selectedByScoreThreshold(prefilter.label, null);
        return { r, out, prefilterLabel: prefilter.label, tier, evalSelected: decision.selected, evalScore: decision.score, receiptIds, error: null as string | null };
      }

      const threshold = tierThreshold(tier);
      if (threshold === null) {
        const run: AnalysisRun = { prefilter, scores: null, writing: null, structure: null };
        const out = normalizeAnalysis(run);
        return { r, out, prefilterLabel: prefilter.label, tier, evalSelected: false, evalScore: null as number | null, receiptIds, error: null as string | null };
      }

      const key = buildScoreInput(input);
      let request = scoreRequests.get(key);
      if (!request) {
        const sharedReceiptIds: number[] = [];
        request = runSelectionScores(input, { scoreModel: model }, (id) => sharedReceiptIds.push(id)).then(
          (scores) => ({ scores, receiptIds: sharedReceiptIds, error: null }),
          (error: unknown) => ({ scores: null, receiptIds: sharedReceiptIds, error: String(error).slice(0, 200) }),
        );
        scoreRequests.set(key, request);
      }
      const shared = await request;
      receiptIds.push(...shared.receiptIds);
      if (shared.error) return { r, out: null, prefilterLabel: prefilter.label, tier, evalSelected: false, evalScore: null as number | null, receiptIds, error: shared.error };

      // Model output is independent of source tier; the decision threshold is not.
      const scores = shared.scores ? { ...shared.scores, threshold } : null;
      const run: AnalysisRun = { prefilter, scores, writing: null, structure: null };
      const out = normalizeAnalysis(run);
      const decision = selectedByScoreThreshold(prefilter.label, scores);
      return { r, out, prefilterLabel: prefilter.label, tier, evalSelected: decision.selected, evalScore: decision.score, receiptIds, error: null as string | null };
    } catch (error) {
      return { r, out: null, prefilterLabel: "UNKNOWN" as const, tier, evalSelected: false, evalScore: null as number | null, receiptIds, error: String(error).slice(0, 200) };
    }
  });

  const overall = emptyCounts();
  let either = 0, errors = 0;
  const byTierCounts = new Map<string, Counts>();
  const mistakes: Array<Record<string, unknown>> = [];
  for (const x of results) {
    if (!x.out) { errors++; continue; }
    const gold = x.r.gold.decision;
    if (gold === "either") { either++; continue; }
    const predSelect = x.evalSelected;
    const goldSelect = gold === "select";
    addPred(overall, predSelect, goldSelect);
    const tierKey = x.tier || "unknown";
    if (!byTierCounts.has(tierKey)) byTierCounts.set(tierKey, emptyCounts());
    addPred(byTierCounts.get(tierKey)!, predSelect, goldSelect);
    if (predSelect && !goldSelect) {
      mistakes.push({ kind: "FP", title: x.r.material.title, score: x.evalScore, reason: x.out.reasonZh, stratum: x.r.samplingContext?.samplingStratum ?? null, sourceTier: tierKey });
    } else if (!predSelect && goldSelect) {
      mistakes.push({ kind: "FN", title: x.r.material.title, score: x.evalScore, relevance: x.out.relevance, stratum: x.r.samplingContext?.samplingStratum ?? null, sourceTier: tierKey });
    }
  }
  const usage = await usageFor(results.flatMap((x) => x.receiptIds));
  const overallMetrics = metricsOf(overall);
  const byTier = Object.fromEntries([...byTierCounts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([tier, c]) => [tier, metricsOf(c)]));
  const summary = {
    model, n: sample.length, either, errors,
    ...overallMetrics,
    byTier,
    ...usage,
    wallSeconds: Math.round((Date.now() - started) / 1000),
  };
  console.log(JSON.stringify({ ...summary, byTier: undefined, note: "byTier printed below" }));
  console.log("byTier:", JSON.stringify(byTier));

  // Threshold sweep on the mean attention score (score-only; BLOCK never selects).
  const sweep: Array<Record<string, number>> = [];
  for (let t = defaults.sweep[0]; t <= defaults.sweep[1]; t += 2) {
    const c = emptyCounts();
    for (const x of results) {
      if (!x.out || x.r.gold.decision === "either") continue;
      const pred = selectedAtMeanCutoff(x.prefilterLabel, x.evalScore, t);
      addPred(c, pred, x.r.gold.decision === "select");
    }
    const m = metricsOf(c);
    sweep.push({ t, acc: m.accuracy, P: m.precision, R: m.recall, F1: m.f1, sel: m.selectedRate });
  }
  console.log(sweep.map((s) => `  t=${s.t} acc=${s.acc} P=${s.P} R=${s.R} F1=${s.F1} sel=${s.sel}`).join("\n"));
  const suggested = suggestFromSweep(sweep);
  if (suggested) console.log("suggested (read-only, does not write selection.ts):", JSON.stringify(suggested));

  const cases = results.map((x) => ({
    caseId: x.r.caseId,
    title: x.r.material.title,
    stratum: x.r.samplingContext?.samplingStratum ?? null,
    sourceTier: x.tier,
    gold: x.r.gold.decision,
    decision: x.out ? (x.evalSelected ? "select" : "reject") : null,
    score: x.evalScore,
    relevance: x.out?.relevance ?? null,
    category: x.out?.category ?? null,
    reason: x.out?.reasonZh ?? null,
    receiptId: x.receiptIds[0] ?? null,
    error: x.error,
  }));
  report[model] = { summary: { ...summary, suggested }, sweep, mistakes, cases };
}
const outDir = path.join(REPO_ROOT, ".data/eval");
mkdirSync(outDir, { recursive: true });
const splitName = safeReportNamePart(values.split!);
const file = path.join(outDir, `selection-${splitName}-${sample.length}-${Date.now()}.json`);
const meta = { split: values.split, n: sample.length, seed: Number(values.seed), promptVersion: SELECTION_PROMPT_VERSION, createdAt: new Date().toISOString() };
writeFileSync(file, JSON.stringify({ meta, models: report }, null, 2));
console.log(`report: ${file}`);
if (!values["no-import"]) {
  const run = await importSelectBenchRun({ meta, models: report }, values.label ?? `${values.split} ${sample.length} 条 · ${Object.keys(report).join(" / ")}`, "script:eval-selection");
  console.log(`SelectBench run: ${run.id}`);
}
await closeDb();
