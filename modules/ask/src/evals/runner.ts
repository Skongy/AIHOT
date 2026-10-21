import { performance } from "node:perf_hooks";
import { sql } from "@aihot/backend/db";
import { getTask, listEvidence } from "../db/store.ts";
import { executeAskTool } from "../tools/whitelist.ts";
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
    engine: "keyword-v1";
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

export async function evaluateAskCase(row: AskEvalCase): Promise<RetrievalCaseResult> {
  const started = performance.now();
  try {
    const result = await executeAskTool("search", JSON.stringify(row.search));
    if (!result.ok) throw new Error(`${result.errorCode}: ${result.message}`);
    return {
      caseId: row.caseId,
      question: row.question,
      returnedArticleIds: result.evidence.flatMap((item) => item.objectId ? [item.objectId] : []),
      relevantArticleIds: row.gold.relevantArticleIds,
      latencyMs: Math.round(performance.now() - started),
      error: null,
    };
  } catch (error) {
    return {
      caseId: row.caseId,
      question: row.question,
      returnedArticleIds: [],
      relevantArticleIds: row.gold.relevantArticleIds,
      latencyMs: Math.round(performance.now() - started),
      error: String(error).slice(0, 500),
    };
  }
}

export async function evaluateAskDataset(input: {
  rows: AskEvalCase[];
  dataset: string;
  datasetSha256: string;
  split?: string;
}): Promise<AskEvalReport> {
  const split = input.split ?? "all";
  const selected = split === "all" ? input.rows : input.rows.filter((row) => row.samplingContext?.split === split);
  if (!selected.length) throw new Error(`evaluation split has no cases: ${split}`);
  // Keep production search capacity predictable and latency measurements readable.
  const retrieval: RetrievalCaseResult[] = [];
  for (const row of selected) retrieval.push(await evaluateAskCase(row));
  const replayByCase = new Map<string, ReturnType<typeof citationCaseResult>>();
  for (const row of selected) {
    const replay = row.taskId ? await persistedReplay(row.taskId) : row.replay;
    replayByCase.set(row.caseId, citationCaseResult(row, replay));
  }
  const replay = [...replayByCase.values()].filter((row) => row !== null);
  return {
    meta: {
      createdAt: new Date().toISOString(),
      engine: "keyword-v1",
      dataset: input.dataset,
      datasetSha256: input.datasetSha256,
      split,
      cases: selected.length,
      note: "This evaluation performs read-only in-site search. It does not call an LLM or embedding provider.",
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
    "- 外部调用：无模型调用、无 Embedding 调用",
    "",
    "## 检索基线",
    "",
    `- Hit Rate：${percent(retrieval.hitRate)}`,
    `- Recall：${percent(retrieval.recall)}`,
    `- Precision：${percent(retrieval.precision)}`,
    `- MRR：${retrieval.mrr.toFixed(4)}`,
    `- 延迟：P50 ${retrieval.latencyMs.p50} ms / P95 ${retrieval.latencyMs.p95} ms`,
    `- 执行覆盖：${retrieval.evaluated}/${retrieval.cases}，错误 ${retrieval.errors}`,
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
      "",
    );
  }
  return `${lines.join("\n")}\n`;
}
