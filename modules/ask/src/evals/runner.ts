import { performance } from "node:perf_hooks";
import { sql } from "@aihot/backend/db";
import { askItems, type AskSearchEngine } from "@aihot/backend/publication/ask";
import { getTask, listEvidence } from "../db/store.ts";
import { askAliases, askRange } from "../tools/search-query.ts";
import {
  answerMetrics,
  citationCaseResult,
  retrievalMetrics,
  type AskEvalCase,
  type AskEvalReplay,
  type RetrievalCaseResult,
} from "./core.ts";

export interface AskEvalReport {
  meta: {
    createdAt: string;
    engine: AskSearchEngine;
    dataset: string;
    datasetSha256: string;
    split: string;
    cases: number;
    note: string;
  };
  summary: {
    retrieval: ReturnType<typeof retrievalMetrics>;
    answers: ReturnType<typeof answerMetrics> | null;
  };
  cases: Array<RetrievalCaseResult & { replay: ReturnType<typeof citationCaseResult> }>;
}

async function persistedReplay(taskId: string): Promise<AskEvalReplay> {
  const task = await getTask(taskId);
  if (!task) throw new Error(`Ask task does not exist: ${taskId}`);
  const evidence = await listEvidence(taskId);
  const receipts = await sql<{ cost: number | null; currency: string | null }[]>`
    SELECT cost, currency FROM receipts
    WHERE purpose = 'ask.tools_stream' AND subject LIKE ${`ask:${taskId}:%`}`;
  const known = receipts.filter((receipt): receipt is { cost: number; currency: string | null } => receipt.cost !== null);
  const currencies = [...new Set(known.map((receipt) => receipt.currency).filter((value): value is string => !!value))];
  const start = task.started_at ?? task.created_at;
  const end = task.finished_at ?? new Date();
  return {
    status: task.status,
    answer: task.final_answer ?? task.draft_answer ?? "",
    evidenceIds: evidence.filter((item) => item.public_ok).map((item) => item.id),
    latencyMs: Math.max(0, end.getTime() - start.getTime()),
    cost: known.length && currencies.length <= 1 ? known.reduce((sum, receipt) => sum + receipt.cost, 0) : null,
    currency: currencies.length === 1 ? currencies[0]! : currencies.length ? "mixed" : null,
  };
}

export async function evaluateAskCase(row: AskEvalCase, engine: AskSearchEngine = "keyword-v1"): Promise<RetrievalCaseResult> {
  const started = performance.now();
  try {
    const range = askRange(row.search, "7d");
    const result = await askItems({
      queries: askAliases(row.search.q), mode: row.search.mode, category: row.search.category,
      limit: row.search.limit, ...range, engine,
      rangeKey: JSON.stringify([row.search.window, row.search.from ?? null, row.search.until ?? null]),
    });
    const receipt = result.retrieval.embeddingReceiptId
      ? (await sql<{ cost: number | null; currency: string | null }[]>`
          SELECT cost, currency FROM receipts WHERE id = ${result.retrieval.embeddingReceiptId}`)[0]
      : null;
    return {
      caseId: row.caseId,
      question: row.question,
      returnedArticleIds: result.items.map((item) => item.id),
      relevantArticleIds: row.gold.relevantArticleIds,
      latencyMs: Math.round(performance.now() - started),
      retrievalMode: result.retrieval.used,
      fallbackReason: result.retrieval.fallbackReason,
      embeddingCalls: result.retrieval.embeddingReceiptId && !result.retrieval.embeddingReused ? 1 : 0,
      embeddingCost: result.retrieval.embeddingReused ? null : receipt?.cost ?? null,
      embeddingCurrency: result.retrieval.embeddingReused ? null : receipt?.currency ?? null,
      error: null,
    };
  } catch (error) {
    return {
      caseId: row.caseId,
      question: row.question,
      returnedArticleIds: [],
      relevantArticleIds: row.gold.relevantArticleIds,
      latencyMs: Math.round(performance.now() - started),
      retrievalMode: engine,
      fallbackReason: null,
      embeddingCalls: 0,
      embeddingCost: null,
      embeddingCurrency: null,
      error: String(error).slice(0, 500),
    };
  }
}

export async function evaluateAskDataset(input: {
  rows: AskEvalCase[];
  dataset: string;
  datasetSha256: string;
  split?: string;
  engine?: AskSearchEngine;
}): Promise<AskEvalReport> {
  const split = input.split ?? "all";
  const selected = split === "all" ? input.rows : input.rows.filter((row) => row.samplingContext?.split === split);
  if (!selected.length) throw new Error(`evaluation split has no cases: ${split}`);
  // Keep production search capacity predictable and latency measurements readable.
  const retrieval: RetrievalCaseResult[] = [];
  const engine = input.engine ?? "keyword-v1";
  for (const row of selected) retrieval.push(await evaluateAskCase(row, engine));
  const replayByCase = new Map<string, ReturnType<typeof citationCaseResult>>();
  for (const row of selected) {
    const replay = row.taskId ? await persistedReplay(row.taskId) : row.replay;
    replayByCase.set(row.caseId, citationCaseResult(row, replay));
  }
  const replay = [...replayByCase.values()].filter((row) => row !== null);
  return {
    meta: {
      createdAt: new Date().toISOString(),
      engine,
      dataset: input.dataset,
      datasetSha256: input.datasetSha256,
      split,
      cases: selected.length,
      note: engine === "keyword-v1"
        ? "This evaluation performs read-only keyword search and does not call an LLM or embedding provider."
        : "Hybrid retrieval may call the configured embedding provider through receipts; it falls back to bounded lexical recall when unavailable.",
    },
    summary: {
      retrieval: retrievalMetrics(retrieval),
      answers: replay.length ? answerMetrics(replay) : null,
    },
    cases: retrieval.map((result) => ({ ...result, replay: replayByCase.get(result.caseId) ?? null })),
  };
}

const percent = (value: number) => `${(value * 100).toFixed(1)}%`;

export function askEvalMarkdown(report: AskEvalReport): string {
  const retrieval = report.summary.retrieval;
  const lines = [
    "# GameHot Ask 评测报告",
    "",
    `- 生成时间：${report.meta.createdAt}`,
    `- 数据集：${report.meta.dataset}`,
    `- 数据集指纹：\`${report.meta.datasetSha256}\``,
    `- 检索引擎：${report.meta.engine}`,
    `- 分组：${report.meta.split}（${report.meta.cases} 个案例）`,
    `- 外部调用：无 LLM 调用；Embedding 提供方实际调用 ${retrieval.cost.embeddingCalls} 次`,
    "",
    "## 检索基线",
    "",
    `- Hit Rate：${percent(retrieval.hitRate)}`,
    `- Recall：${percent(retrieval.recall)}`,
    `- Precision：${percent(retrieval.precision)}`,
    `- MRR：${retrieval.mrr.toFixed(4)}`,
    `- 延迟：P50 ${retrieval.latencyMs.p50} ms / P95 ${retrieval.latencyMs.p95} ms`,
    `- 执行覆盖：${retrieval.evaluated}/${retrieval.cases}，错误 ${retrieval.errors}`,
    `- 负例空结果准确率：${percent(retrieval.noResultAccuracy)}（${retrieval.negativeCases} 个负例）`,
    `- 检索路径：${Object.entries(retrieval.retrievalModes).map(([mode, count]) => `${mode} ${count}`).join(" / ") || "无"}；降级 ${retrieval.fallbackCases} 例`,
    `- Embedding 成本：${retrieval.cost.knownCases} 个案例有金额，${Object.entries(retrieval.cost.totals).map(([currency, total]) => `${total} ${currency}`).join(" / ") || "提供方未返回金额"}`,
  ];
  const answers = report.summary.answers;
  if (answers) {
    lines.push(
      "",
      "## 回答回放",
      "",
      `- 任务完成率：${percent(answers.completionRate)}`,
      `- 无降级完成率：${percent(answers.healthyCompletionRate)}`,
      `- 引用编号合法率：${percent(answers.citationPrecision)}`,
      `- 必要证据覆盖率：${percent(answers.citationCoverage)}`,
      `- 主张证据支持率：${percent(answers.claimSupportRate)}（${answers.supportedClaims}/${answers.claims}）`,
      `- 延迟：P50 ${answers.latencyMs.p50} ms / P95 ${answers.latencyMs.p95} ms`,
      `- 成本：${answers.cost.knownCases}/${answers.cases} 个案例有记录，${Object.entries(answers.cost.totals).map(([currency, total]) => `${total} ${currency}`).join(" / ") || "无可用金额"}`,
    );
  }
  lines.push("", "## 案例", "");
  for (const row of report.cases) {
    const relevant = new Set(row.relevantArticleIds);
    const firstRank = row.returnedArticleIds.findIndex((id) => relevant.has(id)) + 1;
    lines.push(
      `### ${row.caseId}`,
      "",
      row.question,
      "",
      `- 首个相关结果：${firstRank > 0 ? `第 ${firstRank} 位` : "未命中"}`,
      `- 返回：${row.returnedArticleIds.length ? row.returnedArticleIds.map((id) => `\`${id}\``).join("、") : "无"}`,
      `- Gold：${row.relevantArticleIds.map((id) => `\`${id}\``).join("、")}`,
      `- 延迟：${row.latencyMs} ms${row.error ? `；错误：${row.error}` : ""}`,
      `- 路径：${row.retrievalMode}${row.fallbackReason ? `；降级：${row.fallbackReason}` : ""}`,
      "",
    );
  }
  return `${lines.join("\n")}\n`;
}
