// Deep research decisions, in-memory Plan & Execute, and the frontend event contract.
// No database, no paid model, and no Gold dataset.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { ReceiptBusyError, ReceiptUnknownError } from "@aihot/backend/providers/receipts";
import type { ChatToolCall, ChatToolsStreamOptions, ChatToolsStreamResult } from "@aihot/backend/providers/llm";
import { decideAskPost } from "../src/http/decide.ts";
import {
  DEEP_LIMITS, directToolArgs, fallbackResearchPlan, inferWindow, nextResearchAction, parseReplan, parseResearchPlan,
  groundHistoryFollowup, researchClock, runResearchDriver, searchQueryFromQuestion, taskCheckpoint,
  type HistoryReference,
  type LoadedResearch, type ResearchRun, type ResearchState, type StepState,
} from "../src/agent/research.ts";
import { ASK_TOOL_NAMES, type AskToolName, type ToolExecResult } from "../src/tools/whitelist.ts";
import { DEEP_STARTERS, STARTERS } from "../web/starters.ts";
import { applyAskEvent, snapshotResearch, snapshotSteps, type Message } from "../web/types.ts";

const QUESTION = "梳理《无畏契约》最近一个月的重要事件和发展时间线。";
const UUID = "11111111-1111-4111-8111-111111111111";
const HISTORY_ITEM: HistoryReference = {
  previousCitation: 1,
  kind: "item",
  objectId: "valorant-champion",
  title: "无畏契约全球冠军赛结果",
  siteUrl: "/items/valorant-champion",
  source: "测试媒体",
  publishedAt: "2026-10-20T00:00:00.000Z",
};

function step(partial: Partial<StepState> & Pick<StepState, "index" | "goal" | "status">): StepState {
  return {
    tool: partial.tool ?? null,
    dependsOn: partial.dependsOn ?? [],
    attempt: partial.attempt ?? 0,
    summary: partial.summary ?? null,
    checkpoint: partial.checkpoint ?? null,
    ...partial,
  };
}

function state(partial: Partial<ResearchState> = {}): ResearchState {
  return {
    question: QUESTION,
    cancelRequested: false,
    modelCalls: 0,
    toolCalls: 0,
    planVersion: 1,
    startedMs: 1_000,
    nowMs: 2_000,
    evidenceCount: 0,
    steps: [],
    checkpoint: taskCheckpoint({}),
    receiptStatus: {},
    ...partial,
  };
}

function answer(content: string, toolCalls: ChatToolCall[] = []): ChatToolsStreamResult {
  return { content, toolCalls, finishReason: "stop", receiptId: 0, reused: false, model: "fake", usage: null, jsonModeForced: false };
}

function toolCall(name: string, args: Record<string, unknown>): ChatToolCall {
  return { id: `call-${name}`, type: "function", function: { name, arguments: JSON.stringify(args) } };
}

function loaded(partial: Partial<LoadedResearch> = {}): LoadedResearch {
  return {
    status: "queued",
    draft: "",
    cancelRequested: false,
    modelCalls: 0,
    toolCalls: 0,
    planVersion: 0,
    startedMs: 1_000,
    evidence: [],
    claims: [],
    steps: [],
    checkpoint: taskCheckpoint({}),
    receiptStatus: {},
    ...partial,
  };
}

function harness(options: {
  question?: string;
  seed?: Partial<LoadedResearch>;
  nowMs?: number;
  script?: (opts: ChatToolsStreamOptions) => ChatToolsStreamResult | "unknown" | Error;
  evidenceFor?: (name: string) => boolean;
  cancelAfterPlan?: boolean;
  historyReferences?: HistoryReference[];
}) {
  const box = { current: loaded({ ...options.seed }) };
  const chats: ChatToolsStreamOptions[] = [];
  const executed: Array<{ name: string; args: string }> = [];
  const events: Array<{ type: string; payload: Record<string, unknown> }> = [];
  const bumps = { model: 0, tool: 0 };
  let receipt = 100;
  let evidenceId = box.current.evidence.reduce((max, item) => Math.max(max, item.id), 0);
  const run: ResearchRun = {
    taskId: "task-1",
    question: options.question ?? QUESTION,
    background: "",
    historyReferences: options.historyReferences ?? [],
    now: () => options.nowMs ?? box.current.startedMs + 1_000,
    chat: async (opts) => {
      chats.push(opts);
      const made = options.script?.(opts) ?? answer("根据 [1]，近期有公开报道。");
      if (made === "unknown") throw new ReceiptUnknownError(42, "unknown");
      if (made instanceof Error) throw made;
      const receiptId = ++receipt;
      box.current.receiptStatus[receiptId] = "completed";
      return { ...made, receiptId };
    },
    executeTool: async (name, args) => {
      executed.push({ name, args });
      const allowed = (ASK_TOOL_NAMES as readonly string[]).includes(name);
      if (!allowed || options.evidenceFor?.(name) === false) {
        const fail: ToolExecResult = allowed
          ? { ok: true, name: name as AskToolName, text: "none", structured: { count: 0 }, evidence: [] }
          : { ok: false, name, errorCode: "not_whitelisted", message: "工具不在白名单" };
        return fail;
      }
      return {
        ok: true,
        name: name as AskToolName,
        text: "hit",
        structured: { count: 1 },
        evidence: [{ kind: "item", objectId: `${name}-1`, title: `${name} 资料`, sourceName: "媒体", publishedAt: null, siteUrl: `/items/${name}`, originalUrl: null, toolName: name, rawRef: {} }],
      };
    },
    load: async () => structuredClone(box.current),
    claim: async () => true,
    renew: async () => {},
    bumpModel: async () => { box.current.modelCalls += 1; bumps.model += 1; return box.current.modelCalls; },
    bumpTool: async () => { box.current.toolCalls += 1; bumps.tool += 1; return box.current.toolCalls; },
    noteReceipt: async (id) => { if (id) box.current.receiptStatus[id] ??= "unknown"; },
    commitReceipt: async () => {},
    saveCheckpoint: async (checkpoint) => { box.current.checkpoint = structuredClone(checkpoint); },
    setPlan: async (version, steps, checkpoint) => {
      const incoming = structuredClone(steps);
      const kept = box.current.steps.filter((item) => item.status !== "pending" && !incoming.some((next) => next.index === item.index));
      box.current.steps = [...kept, ...incoming].sort((a, b) => a.index - b.index);
      box.current.planVersion = version;
      box.current.checkpoint = structuredClone(checkpoint);
      if (options.cancelAfterPlan) box.current.cancelRequested = true;
    },
    saveStep: async (item) => {
      const next = structuredClone(item);
      const index = box.current.steps.findIndex((row) => row.index === next.index);
      if (index >= 0) box.current.steps[index] = next;
      else box.current.steps.push(next);
      box.current.steps.sort((a, b) => a.index - b.index);
    },
    recordEvidence: async (items) => items.map((item) => {
      evidenceId += 1;
      const raw = item.rawRef ?? {};
      box.current.evidence.push({
        id: evidenceId,
        title: item.title,
        kind: item.kind,
        sourceName: item.sourceName,
        sourceType: typeof raw.sourceType === "string" ? raw.sourceType : undefined,
        excerpt: typeof raw.excerpt === "string" ? raw.excerpt : undefined,
        publishedAt: item.publishedAt,
        siteUrl: item.siteUrl,
      });
      return evidenceId;
    }),
    saveClaims: async (claims) => { box.current.claims = structuredClone(claims); },
    emit: async (type, payload) => { events.push({ type, payload: structuredClone(payload) }); },
    saveDraft: async (text) => { box.current.draft = text; },
    finish: async (status, text) => { box.current.status = status; box.current.draft = text; },
  };
  return { run, box, chats, executed, events, bumps };
}

test("deep limits stay separate from the normal ask loop", () => {
  assert.deepEqual(DEEP_LIMITS, { MAX_MODEL: 8, MAX_VERIFY: 2, MAX_TOOL: 6, MAX_WALL_MS: 180_000, MAX_STEPS: 4, MAX_REPLANS: 1 });
  const loop = readFileSync(new URL("../src/agent/loop.ts", import.meta.url), "utf8");
  assert.match(loop, /const MAX_MODEL = 6/);
  assert.match(loop, /const MAX_TOOL = 8/);
  assert.match(loop, /const MAX_WALL_MS = 180_000/);
  assert.match(loop, /if \(existing\.mode === "deep"\)/);
  const queue = readFileSync(new URL("../server-queue.ts", import.meta.url), "utf8");
  assert.match(queue, /retryDelay: 90/);
  assert.match(queue, /expireInSeconds: 600/);
  assert.match(queue, /heartbeatSeconds: 30/);
});

test("queue downtime does not spend the research clock", () => {
  const started = 1_000;
  const fresh = researchClock(started, started + 1_000, {});
  assert.equal(fresh.activeMs, 1_000);
  const now = started + 12 * 60_000;
  const crashed = researchClock(started, now, { activeMs: 8_000, activeMarkMs: started + 8_000 });
  assert.equal(crashed.activeMs, 8_000);
  const action = nextResearchAction(state({
    startedMs: now - crashed.activeMs,
    nowMs: now,
    evidenceCount: 1,
    steps: [step({ index: 0, goal: "检索", status: "pending", tool: "search" })],
  }));
  assert.equal(action.type, "call_tool");
  const marked = taskCheckpoint({ activeMs: 8_000, activeMarkMs: started + 8_000 });
  assert.equal(marked.activeMs, 8_000);
  assert.equal(marked.activeMarkMs, started + 8_000);
});

test("plan parser keeps only known tools, earlier dependencies, and four steps", () => {
  const parsed = parseResearchPlan("```json\n{\"steps\":["
    + "{\"goal\":\"检索报道\",\"tool\":\"search\",\"dependsOn\":[]},"
    + "{\"goal\":\"非法工具\",\"tool\":\"web_search\",\"dependsOn\":[0,1,9]},"
    + "{\"goal\":\"读取时间线\",\"tool\":\"get_story\",\"dependsOn\":[0]},"
    + "{\"goal\":\"看热点\",\"tool\":\"get_hot_topics\",\"dependsOn\":[]},"
    + "{\"goal\":\"超出的第五步\",\"tool\":\"search\",\"dependsOn\":[]}"
    + "]}\n```");
  assert.deepEqual(parsed?.map((item) => [item.index, item.tool, item.dependsOn]), [
    [0, "search", []],
    [1, null, [0]],
    [2, "get_story", [0]],
    [3, "get_hot_topics", []],
  ]);
  assert.equal(parseResearchPlan("不是 JSON"), null);
});

test("replan keeps finished absolute indexes and shifts new relative indexes", () => {
  const parsed = parseReplan("{\"steps\":[{\"goal\":\"改查热点\",\"tool\":\"get_hot_topics\",\"dependsOn\":[0,1]}]}", [0], 2);
  assert.deepEqual(parsed, [{ index: 2, goal: "改查热点", tool: "get_hot_topics", dependsOn: [0] }]);
});

test("a short follow-up is grounded to the previous citation instead of generic feeds", () => {
  const grounded = groundHistoryFollowup("什么意思", [
    { index: 0, goal: "读取先前标注为[1]的报道正文", tool: "get_story", dependsOn: [] },
    { index: 1, goal: "补充最新资讯", tool: "get_latest", dependsOn: [0] },
  ], [HISTORY_ITEM]);
  assert.deepEqual(grounded, [{
    index: 0,
    goal: "读取上一轮[1]《无畏契约全球冠军赛结果》并解释追问",
    tool: "get_article",
    dependsOn: [],
  }]);
});

test("a history reference without an id falls back to its exact title search", () => {
  const missingId = { ...HISTORY_ITEM, objectId: null };
  const grounded = groundHistoryFollowup("这篇讲了什么", [
    { index: 0, goal: "读取上一轮报道", tool: "get_article", dependsOn: [] },
    { index: 1, goal: "补充最新资讯", tool: "get_latest", dependsOn: [0] },
  ], [missingId]);
  assert.equal(grounded.length, 1);
  assert.equal(grounded[0]?.tool, "search");
  assert.equal(JSON.parse(directToolArgs("search", "这篇讲了什么", grounded[0]!.goal)!).q, HISTORY_ITEM.title);
});

test("fallback plans match the deep examples and never invent an id tool first", () => {
  const timeline = fallbackResearchPlan(DEEP_STARTERS[0]!.question);
  assert.deepEqual(timeline.map((item) => item.tool), ["search", "get_story"]);
  assert.deepEqual(timeline[1]!.dependsOn, [0]);
  assert.equal(inferWindow(DEEP_STARTERS[0]!.question), "30d");

  const compare = fallbackResearchPlan(DEEP_STARTERS[1]!.question);
  assert.deepEqual(compare.map((item) => item.tool), ["search", "search"]);
  assert.deepEqual(compare.map((item) => item.dependsOn), [[], []]);
  assert.equal(inferWindow(DEEP_STARTERS[1]!.question), "7d");

  const coverage = fallbackResearchPlan(DEEP_STARTERS[2]!.question);
  assert.deepEqual(coverage.map((item) => item.tool), ["search", "get_story"]);
  assert.equal(coverage[0]!.tool, "search");

  const heat = fallbackResearchPlan(DEEP_STARTERS[3]!.question);
  assert.deepEqual(heat.map((item) => item.tool), ["get_hot_topics", "search"]);
  assert.equal(inferWindow(DEEP_STARTERS[3]!.question), "all");
  assert.equal(searchQueryFromQuestion(DEEP_STARTERS[3]!.question), "原神");
  assert.equal(searchQueryFromQuestion("2026 无畏契约全球冠军赛谁夺冠？"), "无畏契约 2026 全球冠军赛 夺冠");
  assert.equal(searchQueryFromQuestion("不存在的游戏 Nebula Orchard 9 有更新吗？"), "nebula orchard");
});

test("direct tool args come from the question, and id tools stay empty", () => {
  const search = JSON.parse(directToolArgs("search", QUESTION, "检索报道")!);
  assert.equal(search.q, "无畏契约");
  assert.equal(search.window, "30d");
  assert.equal(directToolArgs("get_story", QUESTION, "读取时间线"), null);
  assert.equal(directToolArgs("get_article", QUESTION, "读文章"), null);
  assert.equal(directToolArgs("explain_hot", QUESTION, "解释热点"), null);
  assert.equal(directToolArgs("explain_selection", QUESTION, "解释精选"), null);
});

test("the scheduler resumes a paid round before cancel, budget, or a new call", () => {
  const running = step({
    index: 0, goal: "读取事件", status: "running", tool: "get_story",
    checkpoint: { phase: "model_started", roundIndex: 1, receiptId: 7 },
  });
  assert.deepEqual(nextResearchAction(state({
    cancelRequested: true,
    modelCalls: 8,
    toolCalls: 6,
    nowMs: 1_000 + DEEP_LIMITS.MAX_WALL_MS + 1,
    steps: [running],
    receiptStatus: { 7: "completed" },
  })), { type: "call_step_model", index: 0, resume: true });
  assert.equal(nextResearchAction(state({
    steps: [step({ index: 0, goal: "读取事件", status: "running", checkpoint: { phase: "tool_done", roundIndex: 1 } })],
  })).type, "complete_step");
  assert.deepEqual(nextResearchAction(state({
    steps: [step({
      index: 0, goal: "检索", status: "running", tool: "search",
      checkpoint: { phase: "model_done", roundIndex: 1, toolName: "search", toolArgs: "{\"q\":\"无畏契约\"}" },
    })],
  })), { type: "call_tool", index: 0, resume: false });
});

test("unknown or pending receipts stop without allocating another model call", () => {
  for (const receipt of ["unknown", "pending"] as const) {
    assert.deepEqual(nextResearchAction(state({
      checkpoint: taskCheckpoint({ planReceiptId: 4 }),
      receiptStatus: { 4: receipt },
    })), { type: "stop", status: "failed", reason: "receipt_unknown" });
  }
});

test("budgets, time, dependencies, and replans choose a stop or the next real step", () => {
  const search = step({ index: 0, goal: "检索", status: "pending", tool: "search" });
  const story = step({ index: 1, goal: "时间线", status: "pending", tool: "get_story", dependsOn: [0] });
  const overModel = nextResearchAction(state({ modelCalls: 8 }));
  assert.equal(overModel.type, "stop");
  if (overModel.type === "stop") assert.equal(overModel.reason, "model");
  const overTool = nextResearchAction(state({ steps: [search], toolCalls: 6 }));
  if (overTool.type === "stop") assert.equal(overTool.reason, "tool");
  const overtime = nextResearchAction(state({ steps: [search], nowMs: 1_000 + DEEP_LIMITS.MAX_WALL_MS + 1 }));
  if (overtime.type === "stop") assert.equal(overtime.reason, "time");
  assert.deepEqual(nextResearchAction(state({
    steps: [step({ index: 0, goal: "检索", status: "running", tool: "search", checkpoint: { phase: "tool_started", roundIndex: 0, toolName: "search", toolArgs: "{}" } })],
    nowMs: 1_000 + DEEP_LIMITS.MAX_WALL_MS + 1,
  })), { type: "call_tool", index: 0, resume: true });
  assert.deepEqual(nextResearchAction(state({ steps: [search, story] })), { type: "call_tool", index: 0, resume: false });
  assert.equal(nextResearchAction(state({
    steps: [step({ index: 0, goal: "检索", status: "failed", tool: "search" }), story],
  })).type, "skip_step");
  assert.equal(nextResearchAction(state({
    evidenceCount: 0,
    steps: [step({ index: 0, goal: "检索", status: "done", tool: "search" })],
    checkpoint: taskCheckpoint({ replanPending: true }),
  })).type, "call_replan");
  assert.equal(nextResearchAction(state({
    steps: [step({ index: 0, goal: "检索", status: "done", tool: "search" })],
    checkpoint: taskCheckpoint({ replans: 1, replanPending: true }),
  })).type, "abandon_replan");
  assert.equal(nextResearchAction(state({
    evidenceCount: 2,
    steps: [step({ index: 0, goal: "检索", status: "done", tool: "search" })],
  })).type, "call_synthesis");
  assert.equal(nextResearchAction(state({
    steps: [step({ index: 0, goal: "检索", status: "done", tool: "search" })],
  })).type, "finish_empty");
  assert.equal(nextResearchAction(state({
    modelCalls: 8,
    evidenceCount: 1,
    steps: [step({ index: 0, goal: "检索", status: "done", tool: "search" })],
  })).type, "finish_degraded");
  assert.equal(nextResearchAction(state({
    steps: [step({ index: 0, goal: "读取", status: "running", checkpoint: { phase: "model_started", roundIndex: 1, resumedOnce: true } })],
  })).type, "fail_step");
});

test("a planned search runs directly, an id step asks once, and synthesis cites the evidence", async () => {
  const world = harness({
    script: (opts) => {
      if (opts.purpose === "ask.research_plan") return answer(JSON.stringify({ steps: [
        { goal: "检索《无畏契约》最近一个月的报道", tool: "search", dependsOn: [] },
        { goal: "读取事件时间线", tool: "get_story", dependsOn: [0] },
      ] }));
      if (opts.purpose === "ask.research_step") return answer("", [toolCall("get_story", { storyId: "story-1" })]);
      if (opts.purpose === "ask.research_verify") return answer(JSON.stringify({ claims: [{ text: "检索到公开资料", kind: "fact", evidenceIds: [1], quote: "search 资料", conflictsWith: [] }] }));
      return answer("根据 [1]，近期有公开报道。");
    },
  });
  await runResearchDriver(world.run);
  assert.deepEqual(world.chats.map((item) => item.purpose), ["ask.research_plan", "ask.research_step", "ask.research_final", "ask.research_verify"]);
  assert.deepEqual(world.executed.map((item) => item.name), ["search", "get_story"]);
  assert.equal(JSON.parse(world.executed[0]!.args).window, "30d");
  assert.equal(world.executed[1]!.args.includes("story-1"), true);
  assert.equal(world.bumps.model, 4);
  assert.equal(world.bumps.tool, 2);
  assert.equal(world.box.current.status, "completed");
  assert.equal(world.box.current.claims[0]?.status, "supported");
  assert.equal(world.events.some((event) => event.type === "research_plan"), true);
  assert.equal(world.events.some((event) => event.type === "research_step"), true);
  assert.equal(world.events.some((event) => event.type === "research_report"), true);
  assert.equal(world.box.current.draft.includes("[1]"), true);
  assert.equal(world.box.current.draft.includes("导致"), false);
});

test("the follow-up '什么意思' reopens the cited article and never falls back to hot or latest", async () => {
  const world = harness({
    question: "什么意思",
    historyReferences: [HISTORY_ITEM],
    script: (opts) => {
      if (opts.purpose === "ask.research_plan") return answer(JSON.stringify({ steps: [
        { goal: "读取先前标注为[1]的报道正文", tool: "get_story", dependsOn: [] },
        { goal: "查看近期热点", tool: "get_hot_topics", dependsOn: [0] },
      ] }));
      if (opts.purpose === "ask.research_verify") return answer(JSON.stringify({ claims: [{ text: "赛事结果已有报道", kind: "fact", evidenceIds: [1], quote: "get_article 资料", conflictsWith: [] }] }));
      return answer("这条报道说明赛事已经结束 [1]。");
    },
  });
  world.run.background = `助手：上一轮回答\n历史出处映射：${JSON.stringify([HISTORY_ITEM])}`;
  await runResearchDriver(world.run);
  assert.deepEqual(world.chats.map((item) => item.purpose), ["ask.research_plan", "ask.research_final", "ask.research_verify"]);
  assert.deepEqual(world.executed.map((item) => item.name), ["get_article"]);
  assert.deepEqual(JSON.parse(world.executed[0]!.args), { article_id: "valorant-champion" });
  assert.equal(world.executed.some((item) => item.name === "get_hot_topics" || item.name === "get_latest"), false);
  assert.equal(world.chats.find((item) => item.purpose === "ask.research_plan")?.json, true);
  const verify = world.chats.find((item) => item.purpose === "ask.research_verify");
  assert.equal(verify?.json, true);
  assert.equal(verify?.maxTokens, 2800);
});

test("an empty first pass replans once, then a new direct tool can still finish", async () => {
  const world = harness({
    evidenceFor: (name) => name === "get_hot_topics",
    script: (opts) => {
      if (opts.purpose === "ask.research_plan") return answer(JSON.stringify({ steps: [
        { goal: "检索第一款游戏", tool: "search", dependsOn: [] },
        { goal: "检索第二款游戏", tool: "search", dependsOn: [] },
      ] }));
      if (opts.purpose === "ask.research_replan") return answer(JSON.stringify({ steps: [
        { goal: "改查热点榜", tool: "get_hot_topics", dependsOn: [0] },
      ] }));
      if (opts.purpose === "ask.research_verify") return answer(JSON.stringify({ claims: [{ text: "热点榜有对应事件", kind: "fact", evidenceIds: [1], quote: "get_hot_topics 资料", conflictsWith: [] }] }));
      return answer("根据 [1]，热点榜有对应事件。");
    },
  });
  await runResearchDriver(world.run);
  assert.deepEqual(world.chats.map((item) => item.purpose), ["ask.research_plan", "ask.research_replan", "ask.research_final", "ask.research_verify"]);
  assert.deepEqual(world.executed.map((item) => item.name), ["search", "search", "get_hot_topics"]);
  assert.equal(world.box.current.planVersion, 2);
  assert.equal(world.box.current.checkpoint.replans, 1);
  assert.equal(world.box.current.steps.some((item) => item.index === 0 && item.status === "done"), true);
  assert.equal(world.box.current.status, "completed");
});

test("a non-json replan does not call synthesis or run an unknown tool", async () => {
  const world = harness({
    evidenceFor: () => false,
    script: (opts) => opts.purpose === "ask.research_plan"
      ? answer(JSON.stringify({ steps: [{ goal: "随便搜", tool: "web_search", dependsOn: [] }] }))
      : opts.purpose === "ask.research_step"
        ? answer("", [toolCall("web_search", { q: "外网" })])
        : answer("这不是 JSON"),
  });
  await runResearchDriver(world.run);
  assert.deepEqual(world.executed, []);
  assert.equal(world.chats.some((item) => item.purpose === "ask.research_final"), false);
  assert.equal(world.box.current.steps[0]?.tool, null);
  assert.equal(world.box.current.status, "completed");
  assert.match(world.box.current.draft, /没有检索到可以引用的报道/);
});

test("cancel after the plan does not start a step model", async () => {
  const world = harness({
    script: () => answer(JSON.stringify({ steps: [{ goal: "读取事件", tool: "get_story", dependsOn: [] }] })),
    cancelAfterPlan: true,
  });
  await runResearchDriver(world.run);
  assert.deepEqual(world.chats.map((item) => item.purpose), ["ask.research_plan"]);
  assert.deepEqual(world.executed, []);
  assert.equal(world.box.current.status, "cancelled");
});

test("resuming a paid step reuses its round, and cancel does not start the next unpaid call", async () => {
  const world = harness({
    seed: {
      status: "running",
      modelCalls: 1,
      cancelRequested: true,
      steps: [step({
        index: 0, goal: "读取事件", status: "running", tool: "get_story", attempt: 1,
        checkpoint: { phase: "model_started", roundIndex: 1, receiptId: 7, evidenceBefore: 0 },
      })],
      receiptStatus: { 7: "completed" },
    },
    script: () => answer("", [toolCall("get_story", { storyId: "story-1" })]),
  });
  await runResearchDriver(world.run);
  assert.equal(world.chats.length, 1);
  assert.equal(world.chats[0]!.roundIndex, 1);
  assert.equal(world.chats[0]!.purpose, "ask.research_step");
  assert.equal(world.bumps.model, 0);
  assert.deepEqual(world.executed, []);
  assert.equal(world.box.current.status, "cancelled");
});

test("a busy step receipt is not paid again", async () => {
  const world = harness({
    script: () => { throw new ReceiptBusyError("busy"); },
    seed: {
      status: "running",
      modelCalls: 1,
      planVersion: 1,
      steps: [step({
        index: 0, goal: "读取事件", status: "running", tool: "get_story",
        checkpoint: { phase: "model_started", roundIndex: 1 },
      })],
      checkpoint: taskCheckpoint({ replans: 1 }),
    },
  });
  await runResearchDriver(world.run);
  assert.equal(world.chats.filter((item) => item.purpose === "ask.research_step").length, 1);
  assert.equal(world.box.current.steps[0]?.status, "failed");
  assert.equal(world.box.current.status, "completed");
  const calls = world.chats.length;
  await runResearchDriver(world.run);
  assert.equal(world.chats.length, calls);
});

test("a second resume of an unfinished model step fails without another chat", async () => {
  const world = harness({
    seed: {
      status: "running",
      modelCalls: 1,
      steps: [step({
        index: 0, goal: "读取事件", status: "running", tool: "get_story",
        checkpoint: { phase: "model_started", roundIndex: 1, resumedOnce: true },
      })],
      checkpoint: taskCheckpoint({ replans: 1 }),
    },
  });
  await runResearchDriver(world.run);
  assert.equal(world.chats.length, 0);
  assert.equal(world.box.current.steps[0]?.status, "failed");
  assert.equal(world.box.current.status, "completed");
});

test("model budget, tool budget, and the clock stop before a new paid or tool call", async () => {
  const overModel = harness({ seed: { modelCalls: 8 } });
  await runResearchDriver(overModel.run);
  assert.equal(overModel.chats.length, 0);
  assert.equal(overModel.box.current.status, "limit_reached");

  const overTool = harness({ seed: { toolCalls: 6, planVersion: 1, steps: [step({ index: 0, goal: "检索", status: "pending", tool: "search" })] } });
  await runResearchDriver(overTool.run);
  assert.equal(overTool.chats.length, 0);
  assert.deepEqual(overTool.executed, []);
  assert.equal(overTool.box.current.status, "limit_reached");

  const overtime = harness({
    nowMs: 1_000 + DEEP_LIMITS.MAX_WALL_MS + 1,
    seed: { planVersion: 1, steps: [step({ index: 0, goal: "检索", status: "pending", tool: "search" })] },
  });
  await runResearchDriver(overtime.run);
  assert.deepEqual(overtime.executed, []);
  assert.equal(overtime.box.current.status, "limit_reached");
});

test("an open tool can finish after the clock, and a committed tool is not run again", async () => {
  const open = harness({
    nowMs: 1_000 + DEEP_LIMITS.MAX_WALL_MS + 1,
    seed: {
      status: "running",
      toolCalls: 1,
      planVersion: 1,
      steps: [step({
        index: 0, goal: "检索", status: "running", tool: "search",
        checkpoint: { phase: "tool_started", roundIndex: 0, toolName: "search", toolArgs: "{\"q\":\"无畏契约\"}", evidenceBefore: 0 },
      })],
    },
  });
  await runResearchDriver(open.run);
  assert.equal(open.chats.length, 0);
  assert.equal(open.executed.length, 1);
  assert.equal(open.bumps.tool, 0);
  assert.equal(open.box.current.status, "limit_reached");

  const done = harness({
    seed: {
      status: "running",
      modelCalls: 1,
      toolCalls: 1,
      planVersion: 1,
      evidence: [{ id: 1, title: "已保存报道", kind: "item", sourceName: "媒体" }],
      steps: [step({ index: 0, goal: "检索", status: "running", tool: "search", checkpoint: { phase: "tool_done", roundIndex: 0, evidenceBefore: 0 } })],
    },
    script: (opts) => opts.purpose === "ask.research_verify"
      ? answer(JSON.stringify({ claims: [{ text: "报道已经保存", kind: "fact", evidenceIds: [1], quote: "已保存报道", conflictsWith: [] }] }))
      : answer("根据 [1]，报道已经保存。"),
  });
  await runResearchDriver(done.run);
  assert.deepEqual(done.executed, []);
  assert.deepEqual(done.chats.map((item) => item.purpose), ["ask.research_final", "ask.research_verify"]);
  assert.equal(done.box.current.status, "completed");
  const again = done.chats.length;
  await runResearchDriver(done.run);
  assert.equal(done.chats.length, again);
});

test("an unknown receipt stops and a later run does not call the model again", async () => {
  const blocked = harness({
    seed: { checkpoint: taskCheckpoint({ planReceiptId: 4 }), receiptStatus: { 4: "unknown" } },
  });
  await runResearchDriver(blocked.run);
  assert.equal(blocked.chats.length, 0);
  assert.equal(blocked.box.current.status, "failed");
  await runResearchDriver(blocked.run);
  assert.equal(blocked.chats.length, 0);

  const thrown = harness({ script: () => "unknown" });
  await runResearchDriver(thrown.run);
  assert.equal(thrown.box.current.status, "failed");
  const calls = thrown.chats.length;
  await runResearchDriver(thrown.run);
  assert.equal(thrown.chats.length, calls);
});

test("the same client request replays the first task even if the retry asks for the other mode", () => {
  const replay = decideAskPost({ message: "另一个模式", clientRequestId: UUID, mode: "deep", existing: { id: "task-1", status: "queued" }, active: true });
  assert.deepEqual(replay, { kind: "replay", taskId: "task-1", status: "queued" });
  const invalid = decideAskPost({ message: "问题", clientRequestId: UUID, mode: "agent", existing: null, active: false });
  assert.equal(invalid.kind, "problem");
  if (invalid.kind === "problem") assert.equal(invalid.status, 400);
  const conflict = decideAskPost({ message: "问题", clientRequestId: UUID, mode: "deep", existing: null, active: true });
  assert.equal(conflict.kind, "problem");
  if (conflict.kind === "problem") assert.equal(conflict.status, 409);
  const created = decideAskPost({ message: "问题", clientRequestId: UUID, mode: undefined, existing: null, active: false });
  assert.deepEqual(created, { kind: "create", message: "问题", clientRequestId: UUID, mode: "normal" });
  const deep = decideAskPost({ message: "深度问题", clientRequestId: UUID, mode: "deep", existing: null, active: false });
  assert.equal(deep.kind, "create");
  if (deep.kind === "create") assert.equal(deep.mode, "deep");
});

test("research progress is rebuilt only from backend events", () => {
  const events = [
    { type: "research_plan", payload: { version: 1, steps: [
      { index: 0, goal: "检索报道", tool: "search", toolLabel: "检索", status: "pending", dependsOn: [] },
      { index: 1, goal: "读取时间线", tool: "get_story", toolLabel: "事件", status: "pending", dependsOn: [0] },
    ] } },
    { type: "step_start", payload: { stepId: "p0", tool: "search", labelZh: "检索" } },
    { type: "research_step", payload: { index: 0, status: "running", summary: "正在检索" } },
    { type: "step_end", payload: { stepId: "p0", ok: true, summary: "找到 1 条" } },
    { type: "research_step", payload: { index: 0, status: "done", summary: "收集到 1 条可引用资料" } },
  ];
  const plan = snapshotResearch(events);
  assert.equal(plan?.version, 1);
  assert.equal(plan?.steps[0]?.status, "done");
  assert.equal(plan?.steps[0]?.summary, "收集到 1 条可引用资料");
  assert.equal(plan?.steps[1]?.status, "pending");
  const steps = snapshotSteps(events);
  assert.equal(steps.length, 1);
  assert.equal(steps[0]?.status, "ok");
  const message: Message = { key: "a", role: "assistant", text: "", mode: "deep" };
  const next = events.reduce((item, event) => applyAskEvent(item, event.type, event.payload), message);
  assert.equal(next.plan?.steps[0]?.status, "done");
  assert.equal(next.steps?.[0]?.status, "ok");
  assert.equal(applyAskEvent(next, "citation_check", { ok: true }).plan?.version, 1);
});

test("deep examples only differ by the questions they fill in", () => {
  assert.equal(STARTERS.length, 3);
  assert.equal(DEEP_STARTERS.length, 4);
  const deep = DEEP_STARTERS.map((item) => item.question);
  for (const starter of STARTERS) assert.equal(deep.includes(starter.question), false);
  assert.equal(deep.some((item) => item.includes("一个月")), true);
  assert.equal(deep.some((item) => item.includes("一周")), true);
  assert.equal(deep.some((item) => item.includes("官方")), true);
  assert.equal(deep.some((item) => item.includes("关注度")), true);
  const page = readFileSync(new URL("../web/ask.tsx", import.meta.url), "utf8");
  assert.match(page, /const switchMode = \(next: AskMode\) => \{ setMode\(next\); \}/);
  assert.match(page, /onClick=\{\(\) => pick\(s\.question\)\}/);
  assert.doesNotMatch(page, /setInterval|假进度|simulated/i);
});
