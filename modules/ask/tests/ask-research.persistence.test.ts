// Deep-research persistence against a throwaway PostgreSQL database.
// The model is an in-process function, or a local HTTP stub for receipt reuse.
// Neither path calls a paid provider, and neither proves answer quality.
import "../../../tests/setup.ts";
import assert from "node:assert/strict";
import http from "node:http";
import { after, before, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { publishArticle } from "@aihot/backend/publication/publish";
import { chatToolsStream, type ChatToolsStreamOptions, type ChatToolsStreamResult } from "@aihot/backend/providers/llm";
import { newUuid } from "@aihot/backend/lib/ids";
import { runDeepResearch } from "../src/agent/research.ts";
import {
  claimTask, createSession, createTask, getTask, listClaims, listEventsAfter, listEvidence, listPlanSteps, requestCancel, savePlanStep,
} from "../src/db/store.ts";

const QUESTION = "梳理《无畏契约》最近一个月的重要事件。";
const PLAN = JSON.stringify({
  steps: [{ goal: "检索《无畏契约》近期公开报道", tool: "search", dependsOn: [] }],
});

function fake(content: string): ChatToolsStreamResult {
  return {
    content,
    toolCalls: [],
    finishReason: "stop",
    receiptId: 0,
    reused: false,
    model: "fake",
    usage: null,
    jsonModeForced: false,
  };
}

async function deepTask(message: string) {
  const { sessionId } = await createSession();
  return createTask({ sessionId, clientRequestId: newUuid(), message, mode: "deep" });
}

async function parked(taskId: string, fields: { startedAgo?: string; modelCalls?: number; toolCalls?: number; checkpoint?: Record<string, unknown> }) {
  await sql`
    UPDATE ask_tasks SET
      status = 'running',
      lease_owner = NULL,
      lease_expires_at = now() - interval '1 minute',
      started_at = now() - ${fields.startedAgo ?? "1 second"}::interval,
      model_calls = ${fields.modelCalls ?? 0},
      round_index = ${fields.modelCalls ?? 0},
      tool_calls = ${fields.toolCalls ?? 0},
      research_checkpoint = ${sql.json((fields.checkpoint ?? { replans: 0 }) as never)}
    WHERE id = ${taskId}::uuid`;
}

before(async () => {
  const source = `ask-research-${newUuid()}`;
  await sql`INSERT INTO sources (id, name, kind, tier, participation_mode) VALUES (${source}, 'Ask research fixture', 'rss', 'T1', 'editorial')`;
  const at = new Date();
  const { articleId } = await upsertMaterial({
    sourceId: source,
    url: `https://example.org/${source}/valorant`,
    title: "无畏契约 测试更新",
    bodyText: "官方确认测试更新。",
    bodyStatus: "ok",
    via: "fetch",
    publishedAt: at,
  });
  await sql`
    INSERT INTO analyses (article_id, input_revision, origin, relevance, category, title_zh, summary_zh, score, selected)
    VALUES (${articleId}, 1, 'rule', 'pass', 'updates', '无畏契约 测试更新', '官方确认测试更新', 90, true)`;
  await publishArticle(articleId, { releasedAt: at });
  await sql`UPDATE publications SET timeline_at = ${at}, sort_at = ${at}, visible_after = ${at} WHERE article_id = ${articleId}`;
});

after(closeDb);

test("normal mode never enters the deep runner", async () => {
  const { sessionId } = await createSession();
  const task = await createTask({ sessionId, clientRequestId: newUuid(), message: QUESTION, mode: "normal" });
  let chats = 0;
  await runDeepResearch({ taskId: task.id, workerId: "worker-normal", chat: async () => { chats += 1; return fake(PLAN); } });
  const row = await getTask(task.id);
  assert.equal(chats, 0);
  assert.equal(row!.status, "queued");
  assert.equal(row!.model_calls, 0);
});

test("a held lease blocks a second worker before any model call", async () => {
  const task = await deepTask("完全无关的问题 XYZ-phase3-lease");
  let release!: () => void;
  let entered = 0;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const chat = async () => {
    entered += 1;
    if (entered === 1) await gate;
    return fake(entered === 1 ? PLAN : "公开报道提到了测试更新。[1]");
  };
  const first = runDeepResearch({ taskId: task.id, workerId: "worker-a", chat });
  const start = Date.now();
  while (entered < 1 && Date.now() - start < 10_000) await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(entered, 1);
  await runDeepResearch({ taskId: task.id, workerId: "worker-b", chat });
  assert.equal(entered, 1);
  const mid = await getTask(task.id);
  assert.equal(mid!.status, "running");
  assert.equal(mid!.lease_owner, "worker-a");
  assert.equal(mid!.model_calls, 1);
  release();
  await first;
  const finished = await getTask(task.id);
  assert.ok(finished!.status === "completed" || finished!.status === "completed_degraded");
  const chatsAfterFinish = entered;
  await runDeepResearch({ taskId: task.id, workerId: "worker-c", chat });
  assert.equal(entered, chatsAfterFinish);
  assert.equal((await getTask(task.id))!.model_calls, finished!.model_calls);
});

test("cancel and timeout stop before a new model call", async () => {
  const cancelled = await deepTask(QUESTION);
  await requestCancel(cancelled.id);
  let cancelChats = 0;
  await runDeepResearch({ taskId: cancelled.id, workerId: "worker-cancel", chat: async () => { cancelChats += 1; return fake(PLAN); } });
  const cancelledRow = await getTask(cancelled.id);
  assert.equal(cancelChats, 0);
  assert.equal(cancelledRow!.status, "cancelled");
  assert.equal(cancelledRow!.model_calls, 0);

  const timed = await deepTask(QUESTION);
  await parked(timed.id, { startedAgo: "10 minutes" });
  let timeChats = 0;
  await runDeepResearch({ taskId: timed.id, workerId: "worker-time", chat: async () => { timeChats += 1; return fake(PLAN); } });
  const timedRow = await getTask(timed.id);
  assert.equal(timeChats, 0);
  assert.equal(timedRow!.status, "limit_reached");
  assert.equal(timedRow!.model_calls, 0);
  const events = await listEventsAfter(timed.id, 0);
  assert.equal(events.some((event) => event.type === "limit" && event.payload.kind === "time"), true);
});

test("resume of a crashed plan reuses the same model round", async () => {
  const task = await deepTask(QUESTION);
  await parked(task.id, { modelCalls: 1, checkpoint: { replans: 0, planRound: 1 } });
  const seen: Array<{ purpose: string; modelCalls: number; roundIndex: number }> = [];
  await runDeepResearch({
    taskId: task.id,
    workerId: "worker-resume",
    chat: async (opts) => {
      const row = await getTask(task.id);
      seen.push({ purpose: opts.purpose, modelCalls: row!.model_calls, roundIndex: opts.roundIndex });
      if (opts.purpose === "ask.research_plan") return fake(PLAN);
      if (opts.purpose === "ask.research_verify") {
        return fake(JSON.stringify({ claims: [{ text: "官方确认测试更新", kind: "fact", evidenceIds: [1], quote: "官方确认测试更新", conflictsWith: [] }] }));
      }
      return fake("公开报道提到了测试更新。[1]");
    },
  });
  assert.equal(seen.filter((item) => item.purpose === "ask.research_plan").length, 1);
  assert.equal(seen[0]!.modelCalls, 1);
  assert.equal(seen[0]!.roundIndex, 1);
  const evidence = await listEvidence(task.id);
  assert.ok(evidence.length >= 1, "search did not persist evidence for the resumed plan");
  const row = await getTask(task.id);
  assert.equal(row!.status, "completed");
  assert.equal(row!.model_calls, 3);
  assert.equal(row!.tool_calls, 1);
  assert.match(row!.final_answer ?? "", /核心结论/);
  assert.match(row!.final_answer ?? "", /\[1\]/);
  const claims = await listClaims(task.id);
  assert.equal(claims[0]?.status, "supported");
  assert.equal(claims[0]?.text, "官方确认测试更新");
  const steps = await listPlanSteps(task.id);
  assert.equal(steps.length, 1);
  assert.equal(steps[0]!.status, "done");
  const types = (await listEventsAfter(task.id, 0)).map((event) => event.type);
  assert.equal(types.includes("research_report"), true);
  const [paid] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM receipts WHERE subject LIKE ${`ask:${task.id}:%`}`;
  assert.equal(paid!.n, 0);
  let extra = 0;
  await runDeepResearch({ taskId: task.id, workerId: "worker-again", chat: async () => { extra += 1; return fake(PLAN); } });
  assert.equal(extra, 0);
  assert.equal((await getTask(task.id))!.model_calls, 3);
});

test("an open tool still finishes once after the wall clock, without a second tool charge", async () => {
  const task = await deepTask(QUESTION);
  await parked(task.id, { startedAgo: "10 minutes", modelCalls: 1, toolCalls: 1, checkpoint: { replans: 1 } });
  await savePlanStep(task.id, {
    stepIndex: 0,
    goal: "检索《无畏契约》近期公开报道",
    toolHint: "search",
    dependsOn: [],
    status: "running",
    attempt: 1,
    checkpoint: {
      phase: "tool_started",
      roundIndex: 0,
      toolName: "search",
      toolArgs: JSON.stringify({ q: "无畏契约", window: "30d", mode: "all", limit: 8 }),
      evidenceBefore: 0,
    },
  });
  let chats = 0;
  await runDeepResearch({ taskId: task.id, workerId: "worker-tool", chat: async () => { chats += 1; return fake(PLAN); } });
  const events = await listEventsAfter(task.id, 0);
  assert.equal(events.filter((event) => event.type === "step_end").length, 1);
  assert.equal(chats, 0);
  const row = await getTask(task.id);
  assert.equal(row!.tool_calls, 1);
  assert.equal(row!.model_calls, 1);
  assert.equal(row!.status, "limit_reached");
  assert.ok((await listEvidence(task.id)).length >= 1);
});

test("a completed plan renews the lease before synthesis", async () => {
  const task = await deepTask(QUESTION);
  let renewed = false;
  const purposes: string[] = [];
  await runDeepResearch({
    taskId: task.id,
    workerId: "worker-full",
    chat: async (opts) => {
      purposes.push(opts.purpose);
      if (opts.purpose === "ask.research_plan") {
        await sql`UPDATE ask_tasks SET lease_expires_at = now() - interval '5 seconds' WHERE id = ${task.id}::uuid AND lease_owner = 'worker-full'`;
        return fake(PLAN);
      }
      const [lease] = await sql<{ ok: boolean }[]>`SELECT lease_expires_at > now() AS ok FROM ask_tasks WHERE id = ${task.id}::uuid`;
      renewed = lease?.ok === true;
      if (opts.purpose === "ask.research_verify") {
        return fake(JSON.stringify({ claims: [{ text: "官方确认测试更新", kind: "fact", evidenceIds: [1], quote: "官方确认测试更新", conflictsWith: [] }] }));
      }
      return fake("公开报道提到了测试更新。[1]");
    },
  });
  assert.deepEqual(purposes, ["ask.research_plan", "ask.research_final", "ask.research_verify"]);
  assert.equal(renewed, true);
  const types = (await listEventsAfter(task.id, 0)).map((event) => event.type);
  for (const type of ["research_plan", "evidence", "research_claims", "research_report", "citation_check", "answer_done", "task_status"]) {
    assert.equal(types.includes(type), true, type);
  }
  const row = await getTask(task.id);
  assert.equal(row!.status, "completed");
  assert.equal(row!.lease_owner, null);
});

test("the same research round reuses one local receipt and does not call the stub twice", async () => {
  let hits = 0;
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      hits += 1;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        id: "chatcmpl-persistence",
        choices: [{ message: { role: "assistant", content: "同一回执" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 3, completion_tokens: 2 },
      }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const { port } = server.address() as { port: number };
  const previous = {
    LLM_BASE_URL: process.env.LLM_BASE_URL,
    LLM_API_KEY: process.env.LLM_API_KEY,
    LLM_MODEL: process.env.LLM_MODEL,
  };
  Object.assign(process.env, {
    LLM_BASE_URL: `http://127.0.0.1:${port}/v1`,
    LLM_API_KEY: "test-key",
    LLM_MODEL: "deepseek-flash",
  });
  const taskId = newUuid();
  const opts: ChatToolsStreamOptions = {
    model: "default",
    purpose: "ask.research_plan",
    subject: `ask:${taskId}:research:plan:r1`,
    promptVersion: "ask-research-v1",
    system: "规划器",
    messages: [{ role: "user", content: QUESTION }],
    tools: [],
    taskId,
    roundIndex: 1,
    enableTools: false,
    maxTokens: 800,
  };
  try {
    const first = await chatToolsStream(opts);
    const second = await chatToolsStream(opts);
    const third = await chatToolsStream({ ...opts, roundIndex: 2, subject: `ask:${taskId}:research:plan:r2` });
    assert.equal(hits, 2);
    assert.equal(first.reused, false);
    assert.equal(second.reused, true);
    assert.equal(second.receiptId, first.receiptId);
    assert.equal(third.reused, false);
    assert.notEqual(third.receiptId, first.receiptId);
    const [rows] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM receipts WHERE subject LIKE ${`ask:${taskId}:%`}`;
    assert.equal(rows!.n, 2);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("claim rejects a live owner and accepts the same task after the lease expires", async () => {
  const task = await deepTask(QUESTION);
  const first = await claimTask(task.id, "owner-1");
  assert.ok(first);
  assert.equal(await claimTask(task.id, "owner-2"), null);
  await sql`UPDATE ask_tasks SET lease_expires_at = now() - interval '1 minute' WHERE id = ${task.id}::uuid`;
  const second = await claimTask(task.id, "owner-2");
  assert.equal(second?.lease_owner, "owner-2");
  assert.equal(second?.model_calls, 0);
});

async function parkedVerified(taskId: string, checkpoint: Record<string, unknown>) {
  await parked(taskId, { modelCalls: 3, toolCalls: 1, checkpoint });
  await sql`UPDATE ask_tasks SET draft_answer = '草稿认为游戏将在下月停服。' WHERE id = ${taskId}::uuid`;
  await savePlanStep(taskId, {
    stepIndex: 0, goal: "检索《无畏契约》近期公开报道", toolHint: "search", dependsOn: [], status: "done", attempt: 1, resultSummary: "收集到 1 条可引用资料",
    checkpoint: { phase: "tool_done", roundIndex: 0, evidenceBefore: 0 },
  });
  await sql`
    INSERT INTO ask_evidence (id, task_id, kind, object_id, title, source_name, published_at, site_url, tool_name, raw_ref, public_ok)
    VALUES (1, ${taskId}::uuid, 'item', 'fixture', '无畏契约 测试更新', 'Ask research fixture', now(), '/items/fixture', 'search',
      ${sql.json({ excerpt: "官方确认测试更新", sourceType: "官方来源" })}, true)`;
}

test("a crashed verification resumes the same round without another model charge", async () => {
  const task = await deepTask(QUESTION);
  await parkedVerified(task.id, { replans: 0, draftReady: true, synthesisRound: 2, verifyRound: 3 });
  const rounds: number[] = [];
  await runDeepResearch({
    taskId: task.id,
    workerId: "worker-verify",
    chat: async (opts) => {
      rounds.push(opts.roundIndex);
      return fake("不是 JSON");
    },
  });
  assert.deepEqual(rounds, [3, 4]);
  const row = await getTask(task.id);
  assert.equal(row!.model_calls, 4);
  assert.equal(row!.status, "completed_degraded");
  // The resumed round is not charged twice. One repair still cannot parse claims, so the
  // retrieved row is listed as an unverified report and stays out of the verified conclusion.
  assert.match(row!.final_answer ?? "", /核验输出无法解析/);
  assert.match(row!.final_answer ?? "", /来源报道但尚未核实/);
  assert.match(row!.final_answer ?? "", /无畏契约 测试更新/);
  const conclusion = row!.final_answer?.split("## 核心结论")[1]?.split("\n## ")[0] ?? "";
  assert.doesNotMatch(conclusion, /\[1\]/);
  assert.match(row!.final_answer ?? "", /\[1\]/);
  assert.doesNotMatch(row!.final_answer ?? "", /草稿认为/);
  let extra = 0;
  await runDeepResearch({ taskId: task.id, workerId: "worker-verify-again", chat: async () => { extra += 1; return fake("不是 JSON"); } });
  assert.equal(extra, 0);
  assert.equal((await getTask(task.id))!.model_calls, 4);
});

test("a second verification resume stops before another paid call", async () => {
  const task = await deepTask(QUESTION);
  await parkedVerified(task.id, { replans: 0, draftReady: true, verifyRound: 3, verifyResumedOnce: true });
  let chats = 0;
  await runDeepResearch({ taskId: task.id, workerId: "worker-verify-stop", chat: async () => { chats += 1; return fake("不是 JSON"); } });
  const row = await getTask(task.id);
  assert.equal(chats, 0);
  assert.equal(row!.model_calls, 3);
  assert.equal(row!.status, "limit_reached");
  assert.doesNotMatch(row!.final_answer ?? "", /草稿认为/);
  assert.match(row!.final_answer ?? "", /\[1\]/);
});
