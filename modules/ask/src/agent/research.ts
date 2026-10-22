// Deep research: one planner, persisted steps, then a bounded executor.
// Normal ask never enters this file. Paid model calls reuse the receipt identity of the same round.
import { beijingDate, beijingTime } from "@aihot/contracts/time";
import { completeReceipt, BudgetExceededError, ReceiptBusyError, ReceiptUnknownError } from "@aihot/backend/providers/receipts";
import { chatToolsStream, type ChatToolsStreamOptions, type ChatToolsStreamResult } from "@aihot/backend/providers/llm";
import { sql } from "@aihot/backend/db";
import { checkCitations, extractXmlToolCalls, stripAskModelText } from "./citations.ts";
import {
  appendEvent, bumpCounters, claimTask, finishTask, getTask, insertAssistantMessage, insertEvidence, listClaims, listEvidence,
  listMessages, listPlanSteps, renewLease, replaceClaims, replacePendingPlanSteps, savePlanStep, saveResearchCheckpoint,
  setActiveReceipt, updateDraft, type PlanStepStatus, type TaskStatus,
} from "../db/store.ts";
import { askContentQuery } from "../tools/search-query.ts";
import {
  ASK_TOOL_LABELS_ZH, ASK_TOOL_NAMES, askToolSpecs, executeAskTool, friendlyStepSummary,
  type AskToolName, type EvidenceCandidate, type ToolExecResult,
} from "../tools/whitelist.ts";
import {
  assessClaims, buildReport, parseClaims, sourceTypeOf, supplementQuery,
  type VerifiableEvidence, type VerifiedClaim,
} from "./verify.ts";
import { currentEvidence, historySources } from "./evidence.ts";

export const DEEP_LIMITS = {
  MAX_MODEL: 8,
  MAX_VERIFY: 2,
  MAX_TOOL: 6,
  MAX_WALL_MS: 180_000,
  MAX_STEPS: 4,
  MAX_REPLANS: 1,
} as const;

/** A gap longer than the task lease is time the worker was gone, not research time. */
export const RESEARCH_CONTINUITY_MS = 60_000;

const PROMPT_VERSION = "ask-research-v2";
const TERMINAL = new Set<TaskStatus>(["completed", "completed_degraded", "failed", "cancelled", "limit_reached"]);
const ID_TOOLS = new Set<AskToolName>(["get_story", "get_article", "explain_hot", "explain_selection"]);

export type ReceiptLookup = "received" | "completed" | "unknown" | "pending" | "failed" | "missing";

export interface PlanStepDraft {
  index: number;
  goal: string;
  tool: AskToolName | null;
  dependsOn: number[];
}

export interface StepCheckpoint {
  phase: "model_started" | "model_done" | "tool_started" | "tool_done";
  roundIndex: number;
  receiptId?: number;
  resumedOnce?: boolean;
  toolName?: string;
  toolArgs?: string;
  fallbackUsed?: boolean;
  evidenceBefore?: number;
  toolError?: string;
}

export interface StepState {
  index: number;
  goal: string;
  tool: AskToolName | null;
  dependsOn: number[];
  status: PlanStepStatus;
  attempt: number;
  summary: string | null;
  checkpoint: StepCheckpoint | null;
}

export interface TaskResearchCheckpoint {
  replans: number;
  replanPending?: boolean;
  planRound?: number;
  planReceiptId?: number;
  planResumedOnce?: boolean;
  replanRound?: number;
  replanReceiptId?: number;
  replanResumedOnce?: boolean;
  synthesisRound?: number;
  synthesisReceiptId?: number;
  synthesisResumedOnce?: boolean;
  draftReady?: boolean;
  verifyPasses?: number;
  verifyRound?: number;
  verifyReceiptId?: number;
  verifyResumedOnce?: boolean;
  /** One extra verify call after the model returned no parseable claims. */
  verifyRepairUsed?: boolean;
  /** The last verify pass produced no claims. The report must say so. */
  verifyUnparsed?: boolean;
  supplements?: number;
  supplementPhase?: "started" | "done";
  needsSupplement?: boolean;
  /** Time the worker actually held the task. Queue downtime is not included. */
  activeMs?: number;
  activeMarkMs?: number;
}

export interface ResearchState {
  question: string;
  cancelRequested: boolean;
  modelCalls: number;
  toolCalls: number;
  planVersion: number;
  startedMs: number;
  nowMs: number;
  evidenceCount: number;
  steps: StepState[];
  checkpoint: TaskResearchCheckpoint;
  receiptStatus: Record<number, ReceiptLookup>;
}

export type ResearchAction =
  | { type: "stop"; status: "cancelled" | "limit_reached" | "failed"; reason: "cancelled" | "time" | "model" | "tool" | "receipt_unknown" }
  | { type: "call_plan"; resume: boolean }
  | { type: "use_fallback_plan" }
  | { type: "call_replan"; resume: boolean }
  | { type: "abandon_replan" }
  | { type: "call_step_model"; index: number; resume: boolean }
  | { type: "call_tool"; index: number; resume: boolean }
  | { type: "complete_step"; index: number }
  | { type: "fail_step"; index: number; reason: string }
  | { type: "skip_step"; index: number; reason: string }
  | { type: "call_synthesis"; resume: boolean }
  | { type: "call_verify"; resume: boolean }
  | { type: "call_supplement" }
  | { type: "finish_report" }
  | { type: "finish_empty" }
  | { type: "finish_degraded"; reason: "model" };

export interface LoadedResearch {
  status: TaskStatus;
  draft: string;
  cancelRequested: boolean;
  modelCalls: number;
  toolCalls: number;
  planVersion: number;
  startedMs: number;
  evidence: VerifiableEvidence[];
  claims: VerifiedClaim[];
  steps: StepState[];
  checkpoint: TaskResearchCheckpoint;
  receiptStatus: Record<number, ReceiptLookup>;
}

export interface ResearchRun {
  taskId: string;
  question: string;
  background: string;
  historyReferences: HistoryReference[];
  now: () => number;
  chat: (opts: ChatToolsStreamOptions) => Promise<ChatToolsStreamResult>;
  executeTool: (name: string, argsJson: string) => Promise<ToolExecResult>;
  load: () => Promise<LoadedResearch>;
  claim: () => Promise<boolean>;
  renew: () => Promise<void>;
  bumpModel: () => Promise<number>;
  bumpTool: () => Promise<number>;
  noteReceipt: (id: number | null) => Promise<void>;
  commitReceipt: (id: number) => Promise<void>;
  saveCheckpoint: (checkpoint: TaskResearchCheckpoint) => Promise<void>;
  setPlan: (version: number, steps: StepState[], checkpoint: TaskResearchCheckpoint) => Promise<void>;
  saveStep: (step: StepState) => Promise<void>;
  recordEvidence: (items: EvidenceCandidate[]) => Promise<number[]>;
  saveClaims: (claims: VerifiedClaim[]) => Promise<void>;
  emit: (type: string, payload: Record<string, unknown>) => Promise<void>;
  saveDraft: (text: string) => Promise<void>;
  finish: (status: TaskStatus, text: string, error?: { code: string; message: string }) => Promise<void>;
}

export interface HistoryReference {
  previousCitation: number;
  kind: string;
  objectId: string | null;
  title: string | null;
  siteUrl: string | null;
  source: string | null;
  publishedAt: string | null;
}

export function taskCheckpoint(value: unknown): TaskResearchCheckpoint {
  const row = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const num = (key: string) => typeof row[key] === "number" ? row[key] as number : undefined;
  return {
    replans: typeof row.replans === "number" ? row.replans : 0,
    replanPending: row.replanPending === true,
    planRound: num("planRound"),
    planReceiptId: num("planReceiptId"),
    planResumedOnce: row.planResumedOnce === true,
    replanRound: num("replanRound"),
    replanReceiptId: num("replanReceiptId"),
    replanResumedOnce: row.replanResumedOnce === true,
    synthesisRound: num("synthesisRound"),
    synthesisReceiptId: num("synthesisReceiptId"),
    synthesisResumedOnce: row.synthesisResumedOnce === true,
    draftReady: row.draftReady === true,
    verifyPasses: typeof row.verifyPasses === "number" ? row.verifyPasses : 0,
    verifyRound: num("verifyRound"),
    verifyReceiptId: num("verifyReceiptId"),
    verifyResumedOnce: row.verifyResumedOnce === true,
    verifyRepairUsed: row.verifyRepairUsed === true,
    verifyUnparsed: row.verifyUnparsed === true,
    supplements: typeof row.supplements === "number" ? row.supplements : 0,
    supplementPhase: row.supplementPhase === "started" || row.supplementPhase === "done" ? row.supplementPhase : undefined,
    needsSupplement: row.needsSupplement === true,
    activeMs: typeof row.activeMs === "number" && row.activeMs >= 0 ? row.activeMs : 0,
    activeMarkMs: num("activeMarkMs"),
  };
}

/** Active research time. The first sample counts from the task start; a later gap past the lease does not. */
export function researchClock(startedMs: number, nowMs: number, checkpoint: { activeMs?: number; activeMarkMs?: number }): { activeMs: number; activeMarkMs: number } {
  const hasMark = typeof checkpoint.activeMarkMs === "number";
  const mark = hasMark ? checkpoint.activeMarkMs! : startedMs;
  const gap = Math.max(0, nowMs - mark);
  const count = !hasMark || gap <= RESEARCH_CONTINUITY_MS;
  return { activeMs: (checkpoint.activeMs ?? 0) + (count ? gap : 0), activeMarkMs: nowMs };
}

export function quotedNames(text: string): string[] {
  return [...new Set([...text.matchAll(/《([^》]{1,40})》/g)].map((match) => match[1]!.trim()).filter(Boolean))];
}

export function inferWindow(text: string): "1h" | "24h" | "7d" | "30d" | "all" {
  if (/一小时|1小时/.test(text)) return "1h";
  if (/今天|24小时|一天|昨日|昨天/.test(text)) return "24h";
  if (/一周|7天|近七天|最近七天/.test(text)) return "7d";
  if (/一个月|30天|近三十|最近三十/.test(text)) return "30d";
  if (/历史|长期|关注度变化/.test(text)) return "all";
  return "7d";
}

export function searchQueryFromQuestion(question: string, goal = ""): string {
  const fromGoal = quotedNames(goal);
  if (fromGoal.length) return fromGoal.join(" ").slice(0, 200);
  const fromQuestion = quotedNames(question);
  if (fromQuestion.length === 1) return fromQuestion[0]!.slice(0, 200);
  return askContentQuery(goal ? `${question} ${goal}` : question);
}

/** Args for tools whose parameters come from the question. ID tools stay null so we never invent an id. */
export function directToolArgs(tool: AskToolName, question: string, goal: string): string | null {
  const window = inferWindow(`${question}\n${goal}`);
  if (tool === "search") return JSON.stringify({ q: searchQueryFromQuestion(question, goal), window, mode: "all", limit: 8 });
  if (tool === "get_latest") return JSON.stringify({ window: window === "all" ? "30d" : window, mode: "all", limit: 8 });
  if (tool === "get_hot_topics") return JSON.stringify({ limit: 8 });
  if (tool === "get_daily") return JSON.stringify({});
  return null;
}

function historyCitation(text: string): number | null {
  const match = /(?:先前|上一轮|上轮|历史)?(?:标注为)?\s*\[(\d+)\]/.exec(text);
  return match ? Number(match[1]) : null;
}

function contextualFollowup(question: string): boolean {
  const text = question.trim();
  return text.length <= 30 && /什么意思|这(?:篇|条|个|则)|上面|上一轮|上轮|刚才|\[\d+\]/.test(text);
}

function referencedHistory(question: string, goal: string, references: HistoryReference[]): HistoryReference | null {
  const citation = historyCitation(`${goal}\n${question}`);
  if (citation !== null) return references.find((item) => item.previousCitation === citation) ?? null;
  return contextualFollowup(question) ? references[0] ?? null : null;
}

function historyReadCall(
  question: string,
  goal: string,
  references: HistoryReference[],
): { name: AskToolName; args: string; reference: HistoryReference } | null {
  const reference = referencedHistory(question, goal, references);
  if (!reference?.objectId) return null;
  if (reference.kind === "item" || reference.kind === "selection_explain") {
    return { name: "get_article", args: JSON.stringify({ article_id: reference.objectId }), reference };
  }
  if (reference.kind === "story" || reference.kind === "hot_explain") {
    return { name: "get_story", args: JSON.stringify({ public_id: reference.objectId, limit: 20 }), reference };
  }
  return null;
}

/** A short follow-up such as “什么意思” must stay on the immediately preceding cited object. */
export function groundHistoryFollowup(
  question: string,
  drafts: PlanStepDraft[],
  references: HistoryReference[],
): PlanStepDraft[] {
  if (!references.length || !contextualFollowup(question)) return drafts;
  const requested = drafts.find((step) => historyCitation(step.goal) !== null) ?? drafts[0];
  const call = historyReadCall(question, requested?.goal ?? "", references);
  if (!call) {
    const title = references[0]?.title?.trim();
    return title
      ? [{ index: 0, goal: `按上一轮来源的精确标题检索：《${title}》`, tool: "search", dependsOn: [] }]
      : drafts;
  }
  return [{
    index: 0,
    goal: `读取上一轮[${call.reference.previousCitation}]${call.reference.title ? `《${call.reference.title}》` : "对应资料"}并解释追问`,
    tool: call.name,
    dependsOn: [],
  }];
}

function extractJsonObject(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = (fenced?.[1] ?? text).trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(raw.slice(start, end + 1)); }
  catch { return null; }
}

function asTool(value: unknown): AskToolName | null {
  return typeof value === "string" && (ASK_TOOL_NAMES as readonly string[]).includes(value) ? value as AskToolName : null;
}

function rawSteps(text: string): Array<{ goal: string; tool: AskToolName | null; dependsOn: number[] }> | null {
  const json = extractJsonObject(text);
  if (!json || typeof json !== "object" || !Array.isArray((json as { steps?: unknown }).steps)) return null;
  const out: Array<{ goal: string; tool: AskToolName | null; dependsOn: number[] }> = [];
  for (const row of ((json as { steps: unknown[] }).steps).slice(0, DEEP_LIMITS.MAX_STEPS)) {
    if (!row || typeof row !== "object") continue;
    const goal = typeof (row as { goal?: unknown }).goal === "string" ? (row as { goal: string }).goal.trim().slice(0, 180) : "";
    if (!goal) continue;
    const dependsRaw = (row as { dependsOn?: unknown; depends_on?: unknown }).dependsOn ?? (row as { depends_on?: unknown }).depends_on;
    const dependsOn = Array.isArray(dependsRaw) ? dependsRaw.filter((item): item is number => Number.isInteger(item) && item >= 0 && item < 32) : [];
    out.push({ goal, tool: asTool((row as { tool?: unknown }).tool), dependsOn });
  }
  return out.length ? out : null;
}

export function parseResearchPlan(text: string): PlanStepDraft[] | null {
  const rows = rawSteps(text);
  if (!rows) return null;
  return rows.map((row, index) => ({
    index,
    goal: row.goal,
    tool: row.tool,
    dependsOn: [...new Set(row.dependsOn.filter((dep) => dep < index))].sort((a, b) => a - b),
  }));
}

export function parseReplan(text: string, doneIndexes: number[], nextIndex: number): PlanStepDraft[] | null {
  const rows = rawSteps(text);
  if (!rows) return null;
  return rows.map((row, offset) => ({
    index: nextIndex + offset,
    goal: row.goal,
    tool: row.tool,
    dependsOn: [...new Set(row.dependsOn.flatMap((dep) => {
      if (doneIndexes.includes(dep)) return [dep];
      if (dep < offset) return [nextIndex + dep];
      return [];
    }))].sort((a, b) => a - b),
  }));
}

export function fallbackResearchPlan(question: string): PlanStepDraft[] {
  const names = quotedNames(question);
  const window = inferWindow(question);
  const span = window === "30d" ? "最近一个月" : window === "24h" ? "最近一天" : window === "1h" ? "最近一小时" : window === "all" ? "可查时间范围内" : "最近一周";
  if (/对比|比较/.test(question) && names.length >= 2) {
    return [
      { index: 0, goal: `检索《${names[0]}》${span}的公开报道`, tool: "search", dependsOn: [] },
      { index: 1, goal: `检索《${names[1]}》${span}的公开报道`, tool: "search", dependsOn: [] },
    ];
  }
  if (/热度|关注度|上榜|热点数据/.test(question)) {
    const game = names[0] ? `《${names[0]}》` : "问题里的游戏";
    return [
      { index: 0, goal: "查看当前热点榜，找出与问题相关的事件", tool: "get_hot_topics", dependsOn: [] },
      { index: 1, goal: `检索${game}的公开报道，用来对照关注度`, tool: "search", dependsOn: [] },
    ];
  }
  if (/官方|媒体/.test(question)) {
    return [
      { index: 0, goal: "检索该热点的公开报道，并保留来源名称", tool: "search", dependsOn: [] },
      { index: 1, goal: "若上一步出现事件 ID，读取报道时间线；没有真实 ID 就不要猜测", tool: "get_story", dependsOn: [0] },
    ];
  }
  if (/时间线|重要事件|一个月|发展/.test(question)) {
    const game = names[0] ? `《${names[0]}》` : "问题里的游戏";
    return [
      { index: 0, goal: `检索${game}${span}的重要报道`, tool: "search", dependsOn: [] },
      { index: 1, goal: "若检索结果包含事件 ID，读取该事件的报道时间线", tool: "get_story", dependsOn: [0] },
    ];
  }
  return [
    { index: 0, goal: "检索与问题直接相关的站内公开报道", tool: "search", dependsOn: [] },
    { index: 1, goal: "补充当前热点，核对是否还有直接相关的事件", tool: "get_hot_topics", dependsOn: [0] },
  ];
}

function draftsToSteps(drafts: PlanStepDraft[]): StepState[] {
  return drafts.map((draft) => ({
    index: draft.index,
    goal: draft.goal,
    tool: draft.tool,
    dependsOn: draft.dependsOn,
    status: "pending",
    attempt: 0,
    summary: null,
    checkpoint: null,
  }));
}

function receiptOf(state: ResearchState, id?: number): ReceiptLookup | null {
  if (!id) return null;
  return state.receiptStatus[id] ?? "missing";
}

function paidDone(status: ReceiptLookup | null): boolean {
  return status === "received" || status === "completed";
}

function blockedReceipt(state: ResearchState): boolean {
  const ids = [
    state.checkpoint.planReceiptId,
    state.checkpoint.replanReceiptId,
    state.checkpoint.synthesisReceiptId,
    state.checkpoint.verifyReceiptId,
    ...state.steps.map((step) => step.checkpoint?.receiptId),
  ];
  return ids.some((id) => {
    const status = receiptOf(state, id);
    return status === "unknown" || status === "pending";
  });
}

function depOf(steps: StepState[], index: number): PlanStepStatus | "missing" {
  return steps.find((step) => step.index === index)?.status ?? "missing";
}

function depsClear(step: StepState, steps: StepState[]): boolean {
  return step.dependsOn.every((dep) => {
    const status = depOf(steps, dep);
    return status === "done" || status === "skipped";
  });
}

function depsBroken(step: StepState, steps: StepState[]): boolean {
  if (!step.dependsOn.length) return false;
  const settled = step.dependsOn.every((dep) => {
    const status = depOf(steps, dep);
    return status === "done" || status === "skipped" || status === "failed" || status === "missing";
  });
  const broken = step.dependsOn.some((dep) => {
    const status = depOf(steps, dep);
    return status === "failed" || status === "missing";
  });
  return settled && broken;
}

function stepsSettled(steps: StepState[]): boolean {
  return steps.length > 0 && steps.every((step) => step.status === "done" || step.status === "skipped" || step.status === "failed");
}

function runningStep(steps: StepState[]): StepState | undefined {
  return steps.filter((step) => step.status === "running").sort((a, b) => a.index - b.index)[0];
}

function toolReady(step: StepState, question: string): boolean {
  const checkpoint = step.checkpoint;
  if (!checkpoint || checkpoint.phase === "tool_started") return !!checkpoint;
  if (checkpoint.phase !== "model_done") return false;
  if (checkpoint.toolName && checkpoint.toolArgs) return true;
  if (checkpoint.fallbackUsed || !step.tool) return false;
  return directToolArgs(step.tool, question, step.goal) !== null;
}

/** The only place that chooses the next research action. Recovery of a paid round never allocates a new one. */
export function nextResearchAction(state: ResearchState): ResearchAction {
  if (blockedReceipt(state)) return { type: "stop", status: "failed", reason: "receipt_unknown" };

  const running = runningStep(state.steps);
  if (running?.checkpoint?.phase === "tool_done") return { type: "complete_step", index: running.index };
  if (running?.checkpoint?.phase === "model_started" && paidDone(receiptOf(state, running.checkpoint.receiptId))) {
    return { type: "call_step_model", index: running.index, resume: true };
  }
  if (state.steps.length === 0 && paidDone(receiptOf(state, state.checkpoint.planReceiptId))) return { type: "call_plan", resume: true };
  if (state.checkpoint.replanPending && paidDone(receiptOf(state, state.checkpoint.replanReceiptId))) return { type: "call_replan", resume: true };
  if (stepsSettled(state.steps) && state.evidenceCount > 0 && paidDone(receiptOf(state, state.checkpoint.synthesisReceiptId)) && !state.checkpoint.draftReady) {
    return { type: "call_synthesis", resume: true };
  }
  if (state.checkpoint.draftReady && paidDone(receiptOf(state, state.checkpoint.verifyReceiptId))) {
    return { type: "call_verify", resume: true };
  }

  if (state.cancelRequested) return { type: "stop", status: "cancelled", reason: "cancelled" };
  const overtime = state.nowMs - state.startedMs > DEEP_LIMITS.MAX_WALL_MS;
  const toolStillOpen = running?.checkpoint?.phase === "tool_started" || (running?.checkpoint?.phase === "model_done" && toolReady(running, state.question));
  if (overtime && !toolStillOpen) return { type: "stop", status: "limit_reached", reason: "time" };

  if (running?.checkpoint?.phase === "tool_started") return { type: "call_tool", index: running.index, resume: true };
  if (running?.checkpoint?.phase === "model_done") {
    if (toolReady(running, state.question)) {
      if (state.toolCalls >= DEEP_LIMITS.MAX_TOOL) return { type: "stop", status: "limit_reached", reason: "tool" };
      return { type: "call_tool", index: running.index, resume: false };
    }
    return { type: "complete_step", index: running.index };
  }
  if (running?.checkpoint?.phase === "model_started") {
    if (running.checkpoint.resumedOnce) return { type: "fail_step", index: running.index, reason: "模型调用未完成，已停止重试" };
    return { type: "call_step_model", index: running.index, resume: true };
  }

  if (state.steps.length === 0) {
    const checkpoint = state.checkpoint;
    if (checkpoint.planRound && !checkpoint.planReceiptId && checkpoint.planResumedOnce) return { type: "use_fallback_plan" };
    if (checkpoint.planRound && !checkpoint.planReceiptId) return { type: "call_plan", resume: true };
    if (state.modelCalls >= DEEP_LIMITS.MAX_MODEL) return { type: "stop", status: "limit_reached", reason: "model" };
    return { type: "call_plan", resume: false };
  }

  if (state.checkpoint.replanPending) {
    if (state.checkpoint.replans >= DEEP_LIMITS.MAX_REPLANS) return { type: "abandon_replan" };
    if (state.checkpoint.replanRound && !state.checkpoint.replanReceiptId && state.checkpoint.replanResumedOnce) return { type: "abandon_replan" };
    if (state.checkpoint.replanRound && !state.checkpoint.replanReceiptId) return { type: "call_replan", resume: true };
    if (state.modelCalls >= DEEP_LIMITS.MAX_MODEL) return { type: "abandon_replan" };
    return { type: "call_replan", resume: false };
  }

  const broken = state.steps.find((step) => step.status === "pending" && depsBroken(step, state.steps));
  if (broken) return { type: "skip_step", index: broken.index, reason: "依赖步骤没有完成" };

  const next = state.steps.filter((step) => step.status === "pending" && depsClear(step, state.steps)).sort((a, b) => a.index - b.index)[0];
  if (next) {
    if (next.tool && directToolArgs(next.tool, state.question, next.goal)) {
      if (state.toolCalls >= DEEP_LIMITS.MAX_TOOL) return { type: "stop", status: "limit_reached", reason: "tool" };
      return { type: "call_tool", index: next.index, resume: false };
    }
    if (state.modelCalls >= DEEP_LIMITS.MAX_MODEL) return { type: "stop", status: "limit_reached", reason: "model" };
    return { type: "call_step_model", index: next.index, resume: false };
  }

  if (!stepsSettled(state.steps)) {
    const stuck = state.steps.find((step) => step.status === "pending");
    if (stuck) return { type: "skip_step", index: stuck.index, reason: "步骤依赖无法继续" };
  }
  if (state.evidenceCount === 0) return { type: "finish_empty" };
  if (!state.checkpoint.draftReady) {
    if (state.checkpoint.synthesisRound && !state.checkpoint.synthesisReceiptId && state.checkpoint.synthesisResumedOnce) {
      return { type: "finish_degraded", reason: "model" };
    }
    if (state.checkpoint.synthesisRound && !state.checkpoint.synthesisReceiptId) return { type: "call_synthesis", resume: true };
    if (state.modelCalls >= DEEP_LIMITS.MAX_MODEL || overtime) return { type: "finish_degraded", reason: "model" };
    return { type: "call_synthesis", resume: false };
  }
  if (state.checkpoint.supplementPhase === "started") return { type: "call_supplement" };
  if (overtime && !(state.checkpoint.verifyRound && !state.checkpoint.verifyReceiptId)) {
    return state.checkpoint.verifyPasses ? { type: "finish_report" } : { type: "finish_degraded", reason: "model" };
  }
  if (state.checkpoint.verifyRound && !state.checkpoint.verifyReceiptId) {
    if (state.checkpoint.verifyResumedOnce) return { type: "finish_degraded", reason: "model" };
    return { type: "call_verify", resume: true };
  }
  const verifyRoom = state.modelCalls < DEEP_LIMITS.MAX_MODEL + DEEP_LIMITS.MAX_VERIFY;
  if ((state.checkpoint.verifyPasses ?? 0) === 0) {
    return verifyRoom ? { type: "call_verify", resume: false } : { type: "finish_degraded", reason: "model" };
  }
  if (state.checkpoint.needsSupplement && (state.checkpoint.supplements ?? 0) === 0 && state.checkpoint.supplementPhase !== "done") {
    if (state.toolCalls >= DEEP_LIMITS.MAX_TOOL) return { type: "finish_report" };
    return { type: "call_supplement" };
  }
  if (state.checkpoint.supplementPhase === "done" && (state.checkpoint.verifyPasses ?? 0) === 1) {
    return verifyRoom ? { type: "call_verify", resume: false } : { type: "finish_report" };
  }
  return { type: "finish_report" };
}

function clockLine(ms: number): string {
  return `现在是北京时间 ${beijingDate(ms)} ${beijingTime(ms)}。相对时间以此为准。`;
}

function evidenceLines(evidence: LoadedResearch["evidence"]): string {
  if (!evidence.length) return "（还没有可引用资料）";
  const at = (label: string, value: string | null | undefined) => value ? ` · ${label} ${beijingDate(value)} ${beijingTime(value)}` : "";
  return evidence.map((item) => {
    const source = item.sourceName ? ` · ${item.sourceName}` : "";
    const type = item.sourceType ? ` · ${sourceTypeOf(item.sourceType)}` : "";
    const excerpt = item.excerpt ? `\n    摘要：${item.excerpt.slice(0, 400)}` : "";
    const body = item.bodyExcerpt ? `\n    公开正文：${item.bodyExcerpt.slice(0, 800)}` : "";
    return `[${item.id}] ${item.title ?? item.kind ?? "资料"}${source}${type}${at("报道发布", item.publishedAt)}${at("站内时间", item.timelineAt)}${excerpt}${body}`;
  }).join("\n");
}

function citedFallback(evidence: LoadedResearch["evidence"], lead: string): string {
  if (!evidence.length) return lead;
  return [lead, ...evidence.slice(0, 8).map((item) => `- [${item.id}] ${item.title ?? item.kind}`)].join("\n");
}

function planView(version: number, steps: StepState[]) {
  return {
    version,
    steps: steps.map((step) => ({
      index: step.index,
      goal: step.goal,
      tool: step.tool,
      toolLabel: step.tool ? ASK_TOOL_LABELS_ZH[step.tool] : null,
      status: step.status,
      dependsOn: step.dependsOn,
      summary: step.summary,
    })),
  };
}

function firstAllowedTool(result: ChatToolsStreamResult): { name: AskToolName; args: string } | null {
  const calls = result.toolCalls?.length ? result.toolCalls : extractXmlToolCalls(result.content || "").toolCalls;
  for (const call of calls) {
    if ((ASK_TOOL_NAMES as readonly string[]).includes(call.function.name)) {
      return { name: call.function.name as AskToolName, args: call.function.arguments || "{}" };
    }
  }
  return null;
}

async function conclude(run: ResearchRun, status: TaskStatus, text: string, extra?: { code?: string; message?: string; limit?: "model" | "tool" | "time" }): Promise<void> {
  const loaded = await run.load();
  if (extra?.limit) await run.emit("limit", { kind: extra.limit, counts: { model: loaded.modelCalls, tool: loaded.toolCalls } });
  if (extra?.code) await run.emit("error", { code: extra.code, message: extra.message ?? "研究没有完成" });
  await run.emit("answer_done", { text, finishReason: extra?.limit ?? extra?.code ?? status });
  await run.emit("task_status", { status, reason: extra?.code ?? extra?.limit });
  await run.saveDraft(text);
  await run.finish(status, text, extra?.code ? { code: extra.code, message: extra.message ?? "" } : undefined);
}

async function ensureRound(run: ResearchRun, round: number): Promise<void> {
  if ((await run.load()).modelCalls < round) await run.bumpModel();
}

type Paid = ChatToolsStreamResult | "stopped" | "fallback" | "unpaid";

async function pay(run: ResearchRun, opts: ChatToolsStreamOptions, other: "fallback" | "fail-step"): Promise<Paid> {
  try {
    const result = await run.chat(opts);
    await run.commitReceipt(result.receiptId);
    await run.noteReceipt(result.receiptId);
    return result;
  } catch (error) {
    if (error instanceof BudgetExceededError) {
      const loaded = await run.load();
      await conclude(run, "failed", citedFallback(loaded.evidence, "服务预算不足，以下只保留已经检索到的资料。"), { code: "budget_exhausted", message: "服务预算不足" });
      return "stopped";
    }
    if (error instanceof ReceiptUnknownError) {
      await run.noteReceipt(error.receiptId);
      const loaded = await run.load();
      await conclude(run, "failed", citedFallback(loaded.evidence, "付费回执结果不明，未自动重试。"), { code: "receipt_unknown", message: "付费回执结果不明，未自动重试。" });
      return "stopped";
    }
    // Pending means the provider call was not started again. The caller skips this round.
    if (error instanceof ReceiptBusyError) return "unpaid";
    if (other === "fallback") return "fallback";
    throw error;
  }
}

async function emitPlan(run: ResearchRun): Promise<void> {
  const loaded = await run.load();
  await run.emit("research_plan", planView(loaded.planVersion, loaded.steps));
}

async function emitStep(run: ResearchRun, step: StepState): Promise<void> {
  await run.emit("research_step", {
    index: step.index,
    goal: step.goal,
    tool: step.tool,
    toolLabel: step.tool ? ASK_TOOL_LABELS_ZH[step.tool] : null,
    status: step.status,
    dependsOn: step.dependsOn,
    summary: step.summary,
    attempt: step.attempt,
  });
}

function findStep(loaded: LoadedResearch, index: number): StepState {
  const step = loaded.steps.find((item) => item.index === index);
  if (!step) throw new Error(`missing research step ${index}`);
  return step;
}

async function rememberReplan(run: ResearchRun, step: StepState): Promise<void> {
  const fresh = await run.load();
  const before = step.checkpoint?.evidenceBefore ?? fresh.evidence.length;
  const added = fresh.evidence.length - before;
  const busy = fresh.steps.some((item) => item.index !== step.index && (item.status === "pending" || item.status === "running"));
  if (added > 0 || busy || fresh.checkpoint.replans >= DEEP_LIMITS.MAX_REPLANS || fresh.checkpoint.replanPending) return;
  await run.saveCheckpoint({ ...fresh.checkpoint, replanPending: true });
}

export async function runResearchDriver(run: ResearchRun): Promise<void> {
  const first = await run.load();
  if (TERMINAL.has(first.status)) return;
  if (!(await run.claim())) return;
  await run.emit("task_status", { status: "running" });
  try {
    for (let guard = 0; guard < 48; guard++) {
      await run.renew();
      const loaded = await run.load();
      if (TERMINAL.has(loaded.status)) return;
      const nowMs = run.now();
      const clock = researchClock(loaded.startedMs, nowMs, loaded.checkpoint);
      const markMoved = clock.activeMs !== loaded.checkpoint.activeMs || clock.activeMarkMs !== loaded.checkpoint.activeMarkMs;
      loaded.checkpoint = { ...loaded.checkpoint, activeMs: clock.activeMs, activeMarkMs: clock.activeMarkMs };
      if (markMoved) await run.saveCheckpoint(loaded.checkpoint);
      const action = nextResearchAction({
        question: run.question,
        cancelRequested: loaded.cancelRequested,
        modelCalls: loaded.modelCalls,
        toolCalls: loaded.toolCalls,
        planVersion: loaded.planVersion,
        startedMs: nowMs - clock.activeMs,
        nowMs,
        evidenceCount: loaded.evidence.length,
        steps: loaded.steps,
        checkpoint: loaded.checkpoint,
        receiptStatus: loaded.receiptStatus,
      });
      if (await applyAction(run, loaded, action)) return;
    }
    const loaded = await run.load();
    await conclude(run, "failed", citedFallback(loaded.evidence, "研究步骤超出安全次数，已停止。"), { code: "research_guard", message: "研究步骤超出安全次数" });
  } catch (error) {
    const loaded = await run.load().catch(() => null);
    await conclude(run, "failed", citedFallback(loaded?.evidence ?? [], "这次未能完成研究，请稍后再试。"), { code: "internal_error", message: String(error).slice(0, 300) });
  }
}

async function applyAction(run: ResearchRun, loaded: LoadedResearch, action: ResearchAction): Promise<boolean> {
  if (action.type === "stop") {
    const unverified = loaded.checkpoint.draftReady && !(loaded.checkpoint.verifyPasses);
    const lead = action.reason === "cancelled"
      ? (unverified || !loaded.draft.trim()
        ? (loaded.evidence.length ? "已停止深度研究。已检索到的资料如下：" : "已停止深度研究，尚未检索到可引用资料。")
        : loaded.draft.trim())
      : action.reason === "time" ? "研究时间已到。以下只列出已经检索到的资料："
      : action.reason === "tool" ? "工具调用已达上限。以下只列出已经检索到的资料："
      : action.reason === "model" ? "模型调用已达上限。以下只列出已经检索到的资料："
      : "付费回执结果不明，未自动重试。";
    const status = action.status;
    await conclude(run, status, action.reason === "cancelled" && loaded.draft.trim() && !unverified ? loaded.draft : citedFallback(loaded.evidence, lead), {
      code: action.reason === "receipt_unknown" ? "receipt_unknown" : undefined,
      message: action.reason === "receipt_unknown" ? "回执结果不明" : undefined,
      limit: action.reason === "time" || action.reason === "model" || action.reason === "tool" ? action.reason : undefined,
    });
    return true;
  }
  if (action.type === "finish_empty") {
    await conclude(run, "completed", "站内公开资料里没有检索到可以引用的报道，所以这次不能给出具体结论。可以换一个游戏名，或缩短时间范围后再试。");
    return true;
  }
  if (action.type === "finish_degraded") {
    await conclude(run, "limit_reached", citedFallback(loaded.evidence, "已达本次深度研究的调用上限。以下只列出已经检索到的资料，没有再生成新的结论："), { limit: "model" });
    return true;
  }
  if (action.type === "abandon_replan") {
    await run.saveCheckpoint({ ...loaded.checkpoint, replanPending: false, replans: Math.max(loaded.checkpoint.replans, 1) });
    return false;
  }
  if (action.type === "use_fallback_plan") {
    const steps = draftsToSteps(fallbackResearchPlan(run.question));
    await run.setPlan(Math.max(loaded.planVersion, 1), steps, loaded.checkpoint);
    await emitPlan(run);
    return false;
  }
  if (action.type === "call_plan") return plan(run, loaded, action.resume);
  if (action.type === "call_replan") return replan(run, loaded, action.resume);
  if (action.type === "call_step_model") return stepModel(run, loaded, action.index, action.resume);
  if (action.type === "call_tool") return tool(run, loaded, action.index, action.resume);
  if (action.type === "complete_step") return completeStep(run, loaded, action.index);
  if (action.type === "fail_step" || action.type === "skip_step") {
    const step = { ...findStep(loaded, action.index), status: action.type === "fail_step" ? "failed" as const : "skipped" as const, summary: action.reason };
    await run.saveStep(step);
    await emitStep(run, step);
    if (action.type === "fail_step") await rememberReplan(run, step);
    return false;
  }
  if (action.type === "call_synthesis") return synthesis(run, loaded, action.resume);
  if (action.type === "call_verify") return verify(run, loaded, action.resume);
  if (action.type === "call_supplement") return supplement(run, loaded);
  if (action.type === "finish_report") return finishReport(run, loaded);
  return false;
}

async function plan(run: ResearchRun, loaded: LoadedResearch, resume: boolean): Promise<boolean> {
  const checkpoint = { ...loaded.checkpoint };
  const round = resume ? checkpoint.planRound! : loaded.modelCalls + 1;
  checkpoint.planRound = round;
  checkpoint.planResumedOnce = resume ? true : false;
  await run.saveCheckpoint(checkpoint);
  await ensureRound(run, round);
  const started = (await run.load()).startedMs;
  const result = await pay(run, {
    model: "default",
    purpose: "ask.research_plan",
    subject: `ask:${run.taskId}:research:plan:r${round}`,
    promptVersion: PROMPT_VERSION,
    system: `${clockLine(started)}
你是 GAMEHOT 的研究规划器。只输出 JSON，不要解释，不要回答用户。
可用工具只有：${ASK_TOOL_NAMES.join("、")}。
把问题拆成 2 到 ${DEEP_LIMITS.MAX_STEPS} 步。每步格式：{"goal":"这一步要核对的事实","tool":"search 或上面的工具名或 null","dependsOn":[更早步骤下标]}
具名游戏、对比和时间线优先用 search。get_story、get_article、explain_hot、explain_selection 只能依赖已经能提供真实 ID 的步骤，不能作为没有任何 ID 的第一步。
历史出处中 kind=item 或 selection_explain 必须用 get_article(article_id=objectId)；kind=story 或 hot_explain 必须用 get_story(public_id=objectId)。不得用 get_latest 或 get_hot_topics 代替读取一条明确的历史出处。
不要规划联网搜索、写库或游戏攻略。输出 {"steps":[...]}`,
    messages: [{ role: "user", content: `${run.background ? `先前对话（只供理解指代，不能当作证据）：\n${run.background}\n\n` : ""}研究问题：${run.question}` }],
    tools: [],
    taskId: run.taskId,
    roundIndex: round,
    enableTools: false,
    json: true,
    maxTokens: 800,
  }, "fallback");
  if (result === "stopped") return true;
  if (result === "unpaid") {
    await run.saveCheckpoint({ ...(await run.load()).checkpoint, planResumedOnce: true });
    return false;
  }
  const current = await run.load();
  const nextCheckpoint = { ...current.checkpoint, planReceiptId: result === "fallback" ? current.checkpoint.planReceiptId : result.receiptId };
  const parsed = result === "fallback" ? null : parseResearchPlan(result.content);
  const grounded = groundHistoryFollowup(run.question, parsed ?? fallbackResearchPlan(run.question), run.historyReferences);
  const steps = draftsToSteps(grounded);
  await run.setPlan(1, steps, nextCheckpoint);
  await emitPlan(run);
  return false;
}

async function replan(run: ResearchRun, loaded: LoadedResearch, resume: boolean): Promise<boolean> {
  const checkpoint = { ...loaded.checkpoint };
  const round = resume ? checkpoint.replanRound! : loaded.modelCalls + 1;
  checkpoint.replanRound = round;
  checkpoint.replanResumedOnce = resume ? true : false;
  await run.saveCheckpoint(checkpoint);
  await ensureRound(run, round);
  const done = loaded.steps.filter((step) => step.status === "done" || step.status === "skipped" || step.status === "failed");
  const nextIndex = loaded.steps.reduce((max, step) => Math.max(max, step.index), -1) + 1;
  const started = (await run.load()).startedMs;
  const result = await pay(run, {
    model: "default",
    purpose: "ask.research_replan",
    subject: `ask:${run.taskId}:research:replan:r${round}`,
    promptVersion: PROMPT_VERSION,
    system: `${clockLine(started)}
上一步没有收集到新的可引用资料。请只输出仍需执行的新步骤 JSON：{"steps":[{"goal":"...","tool":"...","dependsOn":[已有步骤的绝对下标]}]}
不要重复已完成步骤。没有真实 ID 时不要使用 get_story、get_article、explain_hot、explain_selection。最多 ${DEEP_LIMITS.MAX_STEPS} 步。`,
    messages: [{ role: "user", content: `问题：${run.question}\n已有步骤：${loaded.steps.map((step) => `${step.index}. ${step.status} ${step.goal} ${step.summary ?? ""}`).join("\n")}\n资料：\n${evidenceLines(loaded.evidence)}` }],
    tools: [],
    taskId: run.taskId,
    roundIndex: round,
    enableTools: false,
    json: true,
    maxTokens: 800,
  }, "fallback");
  if (result === "stopped") return true;
  if (result === "unpaid") {
    await run.saveCheckpoint({ ...(await run.load()).checkpoint, replanPending: false, replanResumedOnce: true, replans: Math.max(loaded.checkpoint.replans, 1) });
    return false;
  }
  const current = await run.load();
  const parsed = result === "fallback" ? null : parseReplan(result.content, done.map((step) => step.index), nextIndex);
  const nextCheckpoint = {
    ...current.checkpoint,
    replans: 1,
    replanPending: false,
    replanReceiptId: result === "fallback" ? current.checkpoint.replanReceiptId : result.receiptId,
  };
  if (!parsed) {
    await run.saveCheckpoint(nextCheckpoint);
    return false;
  }
  await run.setPlan(current.planVersion + 1, draftsToSteps(parsed), nextCheckpoint);
  await emitPlan(run);
  return false;
}

async function stepModel(run: ResearchRun, loaded: LoadedResearch, index: number, resume: boolean): Promise<boolean> {
  const current = findStep(loaded, index);
  const groundedHistory = !resume && current.tool && ID_TOOLS.has(current.tool)
    ? historyReadCall(run.question, current.goal, run.historyReferences)
    : null;
  if (groundedHistory) {
    const direct: StepState = {
      ...current,
      tool: groundedHistory.name,
      status: "running",
      attempt: current.attempt + 1,
      checkpoint: {
        phase: "model_done",
        roundIndex: 0,
        evidenceBefore: loaded.evidence.length,
        toolName: groundedHistory.name,
        toolArgs: groundedHistory.args,
        fallbackUsed: false,
      },
    };
    await run.saveStep(direct);
    await emitStep(run, direct);
    return false;
  }
  const round = resume ? current.checkpoint!.roundIndex : loaded.modelCalls + 1;
  const step: StepState = {
    ...current,
    status: "running",
    attempt: resume ? current.attempt : current.attempt + 1,
    checkpoint: {
      phase: "model_started",
      roundIndex: round,
      resumedOnce: resume ? true : current.checkpoint?.resumedOnce === true,
      evidenceBefore: current.checkpoint?.evidenceBefore ?? loaded.evidence.length,
      receiptId: current.checkpoint?.receiptId,
    },
  };
  await run.saveStep(step);
  await emitStep(run, step);
  await ensureRound(run, round);
  const started = (await run.load()).startedMs;
  let result: Paid;
  try {
    result = await pay(run, {
      model: "default",
      purpose: "ask.research_step",
      subject: `ask:${run.taskId}:research:step:${index}:r${round}`,
      promptVersion: PROMPT_VERSION,
      system: `${clockLine(started)}
你正在执行研究计划的一步，目标：${step.goal}
优先工具：${step.tool ?? "由你在白名单里选择"}。只调用一个工具，不要写最终结论。
get_story、get_article、explain_hot、explain_selection 的 ID 必须出现在已有资料、历史出处映射或用户问题里，不能编造。
若目标是读取一条明确资料，不得改用 get_latest 或 get_hot_topics。`,
      messages: [{ role: "user", content: `问题：${run.question}\n先前对话：${run.background || "无"}\n历史出处映射：${JSON.stringify(run.historyReferences)}\n已完成：${loaded.steps.filter((item) => item.status === "done").map((item) => `${item.index}. ${item.summary ?? item.goal}`).join("\n") || "无"}\n资料：\n${evidenceLines(loaded.evidence)}` }],
      tools: askToolSpecs(),
      taskId: run.taskId,
      roundIndex: round,
      enableTools: true,
      maxTokens: 700,
    }, "fallback");
  } catch (error) {
    const failed = { ...step, status: "failed" as const, summary: "这一步的模型调用失败" };
    await run.saveStep(failed);
    await emitStep(run, failed);
    await rememberReplan(run, failed);
    return false;
  }
  if (result === "stopped") return true;
  if (result === "unpaid") {
    const failed = { ...step, status: "failed" as const, summary: "这一步的模型调用没有完成，未再次付费" };
    await run.saveStep(failed);
    await emitStep(run, failed);
    await rememberReplan(run, failed);
    return false;
  }
  let allowed = result === "fallback" ? null : firstAllowedTool(result);
  if (step.tool && ID_TOOLS.has(step.tool) && allowed?.name !== step.tool) allowed = null;
  const done: StepState = {
    ...step,
    checkpoint: {
      phase: "model_done",
      roundIndex: round,
      receiptId: result === "fallback" ? step.checkpoint?.receiptId : result.receiptId,
      evidenceBefore: step.checkpoint?.evidenceBefore,
      toolName: allowed?.name,
      toolArgs: allowed?.args,
      fallbackUsed: false,
    },
  };
  await run.saveStep(done);
  return false;
}

async function tool(run: ResearchRun, loaded: LoadedResearch, index: number, resume: boolean): Promise<boolean> {
  const current = findStep(loaded, index);
  let name = current.checkpoint?.toolName ? asTool(current.checkpoint.toolName) : null;
  let args = current.checkpoint?.toolArgs;
  if (!name || !args) {
    const built = current.tool ? directToolArgs(current.tool, run.question, current.goal) : null;
    if (!current.tool || !built) {
      const done: StepState = { ...current, status: "running", summary: "没有可用的真实 ID，未凭空继续查询", checkpoint: { ...(current.checkpoint ?? { phase: "model_done", roundIndex: 0 }), phase: "tool_done", toolError: "没有可用的真实 ID，未凭空继续查询" } };
      await run.saveStep(done);
      return false;
    }
    name = current.tool;
    args = built;
  }
  if (!resume) await run.bumpTool();
  const started: StepState = {
    ...current,
    status: "running",
    checkpoint: {
      phase: "tool_started",
      roundIndex: current.checkpoint?.roundIndex ?? 0,
      receiptId: current.checkpoint?.receiptId,
      evidenceBefore: current.checkpoint?.evidenceBefore ?? loaded.evidence.length,
      toolName: name,
      toolArgs: args,
      fallbackUsed: current.checkpoint?.fallbackUsed === true || !current.checkpoint?.toolName,
    },
  };
  await run.saveStep(started);
  if (!(ASK_TOOL_NAMES as readonly string[]).includes(name)) {
    await run.saveStep({ ...started, checkpoint: { ...started.checkpoint!, phase: "tool_done", toolError: "工具不在白名单" } });
    return false;
  }
  await run.emit("step_start", { stepId: `p${index}`, tool: name, labelZh: ASK_TOOL_LABELS_ZH[name], argsSummary: args.slice(0, 200) });
  let exec: ToolExecResult;
  try {
    exec = await run.executeTool(name, args);
  } catch {
    exec = { ok: false, name, errorCode: "internal_error", message: "工具执行失败。" };
  }
  let ids: number[] = [];
  if (exec.ok && exec.evidence.length) {
    ids = await run.recordEvidence(exec.evidence);
    if (ids.length) {
      await run.emit("evidence", { items: exec.evidence.map((item, i) => ({ id: ids[i], kind: item.kind, title: item.title, siteUrl: item.siteUrl, originalUrl: item.originalUrl, sourceName: item.sourceName, publishedAt: item.publishedAt })) });
    }
  }
  await run.emit("step_end", { stepId: `p${index}`, ok: exec.ok, summary: exec.ok ? friendlyStepSummary(exec) : exec.message, errorCode: exec.ok ? undefined : exec.errorCode });
  await run.saveStep({
    ...started,
    checkpoint: { ...started.checkpoint!, phase: "tool_done", toolError: exec.ok ? undefined : exec.message },
  });
  return false;
}

async function completeStep(run: ResearchRun, loaded: LoadedResearch, index: number): Promise<boolean> {
  const current = findStep(await run.load(), index);
  const before = current.checkpoint?.evidenceBefore ?? loaded.evidence.length;
  const added = (await run.load()).evidence.length - before;
  const summary = current.checkpoint?.toolError
    ?? (added > 0 ? `收集到 ${added} 条可引用资料` : current.tool && ID_TOOLS.has(current.tool) ? "没有可用的真实 ID，未凭空继续查询" : "这一步没有新的可引用资料");
  const step: StepState = { ...current, status: "done", summary };
  await run.saveStep(step);
  await emitStep(run, step);
  await rememberReplan(run, step);
  return false;
}

async function synthesis(run: ResearchRun, loaded: LoadedResearch, resume: boolean): Promise<boolean> {
  const checkpoint = { ...loaded.checkpoint };
  const round = resume ? checkpoint.synthesisRound! : loaded.modelCalls + 1;
  checkpoint.synthesisRound = round;
  checkpoint.synthesisResumedOnce = resume ? true : false;
  await run.saveCheckpoint(checkpoint);
  await ensureRound(run, round);
  const started = (await run.load()).startedMs;
  const result = await pay(run, {
    model: "default",
    purpose: "ask.research_final",
    subject: `ask:${run.taskId}:research:final:r${round}`,
    promptVersion: PROMPT_VERSION,
    system: `${clockLine(started)}
根据已经登记的资料回答。不得调用工具，不得编造来源、数字或事件。
只有资料里能区分官方和媒体时才写差异，否则明确说现有资料无法区分。
引用只能使用下面列出的编号。`,
    messages: [{ role: "user", content: `问题：${run.question}\n步骤：${loaded.steps.map((step) => `${step.index}. ${step.goal}（${step.summary ?? step.status}）`).join("\n")}\n可引用资料：\n${evidenceLines(loaded.evidence)}` }],
    tools: [],
    taskId: run.taskId,
    roundIndex: round,
    enableTools: false,
    maxTokens: 2048,
  }, "fallback");
  if (result === "stopped") return true;
  if (result === "unpaid") {
    await run.saveCheckpoint({ ...(await run.load()).checkpoint, synthesisResumedOnce: true });
    return false;
  }
  const fresh = await run.load();
  const answer = result === "fallback"
    ? citedFallback(fresh.evidence, "这次没能整理成完整回答。以下为已登记来源：")
    : (stripAskModelText(result.content) || citedFallback(fresh.evidence, "这次没能整理成完整回答。以下为已登记来源："));
  await run.saveDraft(answer);
  await run.saveCheckpoint({
    ...fresh.checkpoint,
    draftReady: true,
    synthesisReceiptId: result === "fallback" ? fresh.checkpoint.synthesisReceiptId : result.receiptId,
  });
  return false;
}

async function verify(run: ResearchRun, loaded: LoadedResearch, resume: boolean): Promise<boolean> {
  const checkpoint = { ...loaded.checkpoint };
  const round = resume ? checkpoint.verifyRound! : loaded.modelCalls + 1;
  checkpoint.verifyRound = round;
  checkpoint.verifyResumedOnce = resume ? true : false;
  await run.saveCheckpoint(checkpoint);
  await ensureRound(run, round);
  const started = (await run.load()).startedMs;
  const result = await pay(run, {
    model: "default",
    purpose: "ask.research_verify",
    subject: `ask:${run.taskId}:research:verify:r${round}`,
    promptVersion: PROMPT_VERSION,
    system: `${clockLine(started)}
你只核验下面的草稿。只输出 JSON，不要写报告。
格式：{"claims":[{"text":"一句可核验的事实","kind":"fact 或 inference","evidenceIds":[已有编号],"quote":"从对应证据标题、摘要或公开正文中逐字复制的原话","conflictsWith":[]}]}
quote 不能改写。结论里的每个数字都必须原样出现在 quote 里。官方表态只能引用来源类型为官方来源的材料。热度变化不能写成原因。报道发布时间和站内时间不是事件发生时间。最多 8 条。${checkpoint.verifyRepairUsed ? "\n上一次没有输出可解析的 claims。这次只输出一个 JSON 对象。" : ""}`,
    messages: [{ role: "user", content: `问题：${run.question}\n草稿：\n${loaded.draft || "（没有草稿）"}\n可引用资料：\n${evidenceLines(loaded.evidence)}` }],
    tools: [],
    taskId: run.taskId,
    roundIndex: round,
    enableTools: false,
    json: true,
    maxTokens: 2800,
  }, "fallback");
  if (result === "stopped") return true;
  if (result === "unpaid") {
    await run.saveCheckpoint({ ...(await run.load()).checkpoint, verifyResumedOnce: true });
    return false;
  }
  const fresh = await run.load();
  const proposed = result === "fallback" ? null : parseClaims(result.content);
  const unusable = !proposed || proposed.length === 0;
  if (unusable && fresh.checkpoint.verifyRepairUsed !== true && fresh.modelCalls < DEEP_LIMITS.MAX_MODEL + DEEP_LIMITS.MAX_VERIFY) {
    await run.saveCheckpoint({
      ...fresh.checkpoint,
      verifyRepairUsed: true,
      verifyRound: undefined,
      verifyReceiptId: undefined,
      verifyResumedOnce: false,
    });
    return false;
  }
  const assessed = proposed ? assessClaims(proposed, fresh.evidence, run.question) : [];
  const firstPass = (fresh.checkpoint.verifyPasses ?? 0) === 0;
  const claims = (firstPass ? assessed : [...assessed, ...fresh.claims.filter((old) => !assessed.some((next) => next.text === old.text))])
    .map((claim, index) => ({ ...claim, index }));
  await run.saveClaims(claims);
  await run.emit("research_claims", { claims });
  const query = firstPass ? supplementQuery(claims, run.question) : null;
  await run.saveCheckpoint({
    ...fresh.checkpoint,
    draftReady: true,
    verifyPasses: (fresh.checkpoint.verifyPasses ?? 0) + 1,
    verifyRound: undefined,
    verifyReceiptId: undefined,
    verifyResumedOnce: false,
    verifyUnparsed: unusable,
    needsSupplement: !!query,
  });
  return false;
}

async function supplement(run: ResearchRun, loaded: LoadedResearch): Promise<boolean> {
  const resume = loaded.checkpoint.supplementPhase === "started";
  const query = supplementQuery(loaded.claims, run.question) ?? searchQueryFromQuestion(run.question);
  const args = JSON.stringify({ q: query, window: inferWindow(run.question), mode: "all", limit: 8 });
  if (!resume) {
    await run.saveCheckpoint({ ...loaded.checkpoint, supplementPhase: "started" });
    await run.bumpTool();
  }
  await run.emit("step_start", { stepId: "supplement", tool: "search", labelZh: ASK_TOOL_LABELS_ZH.search, argsSummary: args.slice(0, 200) });
  let exec: ToolExecResult;
  try {
    exec = await run.executeTool("search", args);
  } catch {
    exec = { ok: false, name: "search", errorCode: "internal_error", message: "补检失败。" };
  }
  if (exec.ok && exec.evidence.length) {
    const ids = await run.recordEvidence(exec.evidence);
    if (ids.length) {
      await run.emit("evidence", { items: exec.evidence.map((item, i) => ({ id: ids[i], kind: item.kind, title: item.title, siteUrl: item.siteUrl, originalUrl: item.originalUrl, sourceName: item.sourceName, publishedAt: item.publishedAt })) });
    }
  }
  await run.emit("step_end", { stepId: "supplement", ok: exec.ok, summary: exec.ok ? friendlyStepSummary(exec) : exec.message, errorCode: exec.ok ? undefined : exec.errorCode });
  const fresh = await run.load();
  await run.saveCheckpoint({ ...fresh.checkpoint, supplementPhase: "done", supplements: 1, needsSupplement: false });
  return false;
}

async function finishReport(run: ResearchRun, loaded: LoadedResearch): Promise<boolean> {
  const fresh = await run.load();
  const { markdown, report } = buildReport(run.question, fresh.claims, fresh.evidence, { unparsed: fresh.checkpoint.verifyUnparsed === true });
  const check = checkCitations(markdown, fresh.evidence.map((item) => item.id));
  await run.emit("citation_check", { ok: check.ok, issues: check.issues });
  await run.emit("research_report", { report });
  const supported = fresh.claims.some((claim) => claim.status === "supported");
  const status = check.ok && supported ? "completed" : "completed_degraded";
  if ((await run.load()).cancelRequested) {
    await conclude(run, "cancelled", markdown);
    return true;
  }
  await conclude(run, status, markdown);
  return true;
}

function normalizeStepCheckpoint(value: unknown): StepCheckpoint | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const phase = row.phase;
  if (phase !== "model_started" && phase !== "model_done" && phase !== "tool_started" && phase !== "tool_done") return null;
  return {
    phase,
    roundIndex: typeof row.roundIndex === "number" ? row.roundIndex : 0,
    receiptId: typeof row.receiptId === "number" ? row.receiptId : undefined,
    resumedOnce: row.resumedOnce === true,
    toolName: typeof row.toolName === "string" ? row.toolName : undefined,
    toolArgs: typeof row.toolArgs === "string" ? row.toolArgs : undefined,
    fallbackUsed: row.fallbackUsed === true,
    evidenceBefore: typeof row.evidenceBefore === "number" ? row.evidenceBefore : undefined,
    toolError: typeof row.toolError === "string" ? row.toolError : undefined,
  };
}

function stepToWrite(step: StepState) {
  return {
    stepIndex: step.index,
    goal: step.goal,
    toolHint: step.tool,
    dependsOn: step.dependsOn,
    status: step.status,
    attempt: step.attempt,
    resultSummary: step.summary,
    checkpoint: step.checkpoint ? { ...step.checkpoint } : null,
  };
}

async function briefHistory(sessionId: string, taskId: string): Promise<{ text: string; references: HistoryReference[] }> {
  const messages = await listMessages(sessionId, 12);
  const lines: string[] = [];
  let references: HistoryReference[] = [];
  for (const message of messages) {
    if (message.task_id === taskId) continue;
    if (message.role === "assistant" && message.task_id) {
      const prior = await getTask(message.task_id);
      const checked = prior ? await currentEvidence(prior) : null;
      if (prior?.content_invalidated || checked?.invalidated) {
        references = [];
        lines.push("助手：上轮因来源不可用已失效");
        continue;
      }
      references = checked ? historySources(checked.evidence) : [];
      const mapping = references.length
        ? `\n历史出处映射（编号只属于这一轮，使用前必须重新读取对应工具）：${JSON.stringify(references)}`
        : "";
      lines.push(`助手：${message.content.slice(0, 800)}${mapping}`);
      continue;
    }
    lines.push(`${message.role === "user" ? "用户" : "助手"}：${message.content.slice(0, 500)}`);
  }
  return { text: lines.slice(-6).join("\n"), references };
}

async function lookupReceipts(ids: number[]): Promise<Record<number, ReceiptLookup>> {
  const out: Record<number, ReceiptLookup> = {};
  for (const id of [...new Set(ids)]) {
    const [row] = await sql<{ status: string }[]>`SELECT status FROM receipts WHERE id = ${id}`;
    const status = row?.status;
    out[id] = status === "received" || status === "completed" || status === "unknown" || status === "pending" || status === "failed" ? status : "missing";
  }
  return out;
}

export async function runDeepResearch(opts: { taskId: string; workerId: string; chat?: ResearchRun["chat"]; now?: () => number }): Promise<void> {
  const existing = await getTask(opts.taskId);
  if (!existing || existing.mode !== "deep" || TERMINAL.has(existing.status)) return;
  const history = await briefHistory(existing.session_id, opts.taskId);
  const chat = opts.chat ?? chatToolsStream;
  const now = opts.now ?? Date.now;
  const run: ResearchRun = {
    taskId: opts.taskId,
    question: existing.user_message,
    background: history.text,
    historyReferences: history.references,
    now,
    chat,
    executeTool: executeAskTool,
    load: async () => {
      const task = await getTask(opts.taskId);
      if (!task) throw new Error("research task missing");
      const steps = await listPlanSteps(opts.taskId);
      const evidence = await listEvidence(opts.taskId);
      const checkpoint = taskCheckpoint(task.research_checkpoint);
      const ids = [checkpoint.planReceiptId, checkpoint.replanReceiptId, checkpoint.synthesisReceiptId, checkpoint.verifyReceiptId, task.active_receipt_id, ...steps.map((step) => normalizeStepCheckpoint(step.checkpoint)?.receiptId)].filter((id): id is number => typeof id === "number");
      const claims = await listClaims(opts.taskId);
      return {
        status: task.status,
        draft: task.draft_answer ?? "",
        cancelRequested: task.cancel_requested,
        modelCalls: task.model_calls,
        toolCalls: task.tool_calls,
        planVersion: task.plan_version,
        startedMs: task.started_at?.getTime() ?? now(),
        evidence: evidence.map((item) => {
          const raw = item.raw_ref ?? {};
          return {
            id: item.id,
            title: item.title,
            kind: item.kind,
            sourceName: item.source_name,
            sourceType: sourceTypeOf(typeof raw.sourceType === "string" ? raw.sourceType : null, raw.firstParty),
            excerpt: typeof raw.excerpt === "string" ? raw.excerpt : "",
            bodyExcerpt: typeof raw.bodyExcerpt === "string" ? raw.bodyExcerpt : "",
            publishedAt: item.published_at?.toISOString() ?? null,
            timelineAt: typeof raw.timelineAt === "string" ? raw.timelineAt : null,
            siteUrl: item.site_url,
          };
        }),
        claims: claims.map((claim) => ({
          index: claim.claim_index,
          text: claim.text,
          kind: claim.kind,
          status: claim.status,
          evidenceIds: claim.evidence_ids,
          quote: claim.quote,
          note: claim.note,
        })),
        steps: steps.map((step) => ({
          index: step.step_index,
          goal: step.goal,
          tool: asTool(step.tool_hint),
          dependsOn: step.depends_on,
          status: step.status,
          attempt: step.attempt,
          summary: step.result_summary,
          checkpoint: normalizeStepCheckpoint(step.checkpoint),
        })),
        checkpoint,
        receiptStatus: await lookupReceipts(ids),
      };
    },
    claim: async () => !!(await claimTask(opts.taskId, opts.workerId)),
    renew: async () => { await renewLease(opts.taskId, opts.workerId); },
    bumpModel: async () => { await bumpCounters(opts.taskId, "model"); return (await getTask(opts.taskId))!.round_index; },
    bumpTool: async () => { await bumpCounters(opts.taskId, "tool"); return (await getTask(opts.taskId))!.tool_calls; },
    noteReceipt: async (id) => { await setActiveReceipt(opts.taskId, id); },
    commitReceipt: async (id) => { await completeReceipt(sql, id); },
    saveCheckpoint: async (checkpoint) => { await saveResearchCheckpoint(opts.taskId, { ...checkpoint }); },
    setPlan: async (version, steps, checkpoint) => { await replacePendingPlanSteps(opts.taskId, version, steps.map(stepToWrite), { ...checkpoint }); },
    saveStep: async (step) => { await savePlanStep(opts.taskId, stepToWrite(step)); },
    recordEvidence: async (items) => insertEvidence(opts.taskId, items.map((item) => ({
      kind: item.kind, objectId: item.objectId, title: item.title, sourceName: item.sourceName,
      publishedAt: item.publishedAt, siteUrl: item.siteUrl, originalUrl: item.originalUrl, toolName: item.toolName, rawRef: item.rawRef,
    }))),
    saveClaims: async (claims) => replaceClaims(opts.taskId, claims),
    emit: async (type, payload) => { await appendEvent(opts.taskId, type, payload); },
    saveDraft: async (text) => { await updateDraft(opts.taskId, text); },
    finish: async (status, text, error) => {
      await finishTask(opts.taskId, opts.workerId, status, {
        draftAnswer: text,
        finalAnswer: status === "cancelled" ? null : text,
        errorCode: error?.code ?? null,
        errorMessage: error?.message ?? null,
      });
      if (status !== "cancelled" && text) await insertAssistantMessage(existing.session_id, opts.taskId, text);
    },
  };
  await runResearchDriver(run);
}
