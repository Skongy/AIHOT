// Claim verdicts are deterministic. These cases do not call a model or a database.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { answerMetrics, citationCaseResult, parseAskEvalJsonl } from "../src/evals/core.ts";
import { nextResearchAction, runResearchDriver, taskCheckpoint, type LoadedResearch, type ResearchRun, type StepState } from "../src/agent/research.ts";
import { assessClaims, buildReport, parseClaims, supplementQuery, type VerifiableEvidence } from "../src/agent/verify.ts";
import { applyAskEvent, reportFromPayload, snapshotReport } from "../web/types.ts";
import type { ChatToolsStreamOptions, ChatToolsStreamResult } from "@aihot/backend/providers/llm";
import type { AskToolName, ToolExecResult } from "../src/tools/whitelist.ts";

const official: VerifiableEvidence = {
  id: 1, title: "无畏契约更新公告", sourceName: "拳头游戏", sourceType: "官方来源",
  excerpt: "官方确认测试服将于 5 月 20 日开启。", publishedAt: "2026-05-01T02:00:00.000Z", siteUrl: "/items/official",
};
const media: VerifiableEvidence = {
  id: 2, title: "媒体猜测冠军皮肤", sourceName: "游戏媒体", sourceType: "媒体报道",
  excerpt: "有报道猜测冠军皮肤可能在下月推出。", publishedAt: "2026-05-03T08:00:00.000Z", siteUrl: "/items/media",
};
const heat: VerifiableEvidence = {
  id: 3, title: "无畏契约热榜", sourceName: null, sourceType: "未知",
  excerpt: "当前热榜第 4 名。近 48h 参与方：12；近 6h 新增参与方：3；近 24h 报道：5；报道篇数：9",
  publishedAt: null, siteUrl: "/story/valorant",
};

function claim(text: string, evidenceIds: number[], quote: string, extra: Partial<{ kind: "fact" | "inference"; conflictsWith: number[] }> = {}) {
  return { text, kind: extra.kind ?? "fact" as const, evidenceIds, quote, conflictsWith: extra.conflictsWith ?? [] };
}

test("a citation number does not make an unsupported sentence true", () => {
  const [row] = assessClaims([claim("游戏将在下月停服", [2], "游戏将在下月停服")], [media]);
  assert.equal(row!.status, "insufficient");
  assert.equal(row!.evidenceIds[0], 2);
});

test("matching quotes can still be contradicted, official, or only a guess", () => {
  const rows = assessClaims([
    claim("官方确认测试服将于 5 月 20 日开启", [1], "官方确认测试服将于 5 月 20 日开启"),
    claim("官方确认冠军皮肤将在下月推出", [2], "有报道猜测冠军皮肤可能在下月推出"),
    claim("测试服日期已经公布", [1], "5 月 20 日", { conflictsWith: [3] }),
    claim("测试服日期尚未公布", [2], "可能在下月推出", { conflictsWith: [2] }),
    claim("热度上升导致停服", [3], "当前热榜第 4 名"),
    claim("参与讨论的人变多", [3], "近 48h 参与方：12", { kind: "inference" }),
  ], [official, media, heat]);
  assert.equal(rows[0]!.status, "supported");
  assert.equal(rows[1]!.status, "disputed");
  assert.equal(rows[2]!.status, "contradicted");
  assert.equal(rows[3]!.status, "contradicted");
  assert.equal(rows[4]!.status, "withdrawn");
  assert.equal(rows[4]!.kind, "inference");
  assert.equal(rows[5]!.status, "withdrawn");
});

test("a quote found in exactly one evidence item is bound to that item", () => {
  const [row] = assessClaims([
    claim("巴西战队LOUD夺得冠军", [], "巴西战队LOUD夺得冠军"),
  ], [official, { ...media, excerpt: "巴西战队LOUD夺得冠军，独得100万美元奖金。" }]);
  assert.equal(row!.status, "supported");
  assert.deepEqual(row!.evidenceIds, [2]);
});

test("the same quote in two items is not assigned to either", () => {
  const shared = "巴西战队LOUD夺得冠军";
  const [row] = assessClaims([
    claim(shared, [], shared),
  ], [{ ...official, excerpt: shared }, { ...media, excerpt: shared }]);
  assert.equal(row!.status, "insufficient");
  assert.deepEqual(row!.evidenceIds, []);
});

test("missing evidence, empty retrieval text, and a changed number stay insufficient", () => {
  const rows = assessClaims([
    claim("有公开报道", [9], "有公开报道"),
    claim("有公开报道", [2], ""),
    claim("热榜第 9 名", [3], "当前热榜第 4 名"),
  ], [official, media, heat]);
  assert.deepEqual(rows.map((row) => row.status), ["insufficient", "insufficient", "insufficient"]);
  assert.equal(supplementQuery(rows, "《无畏契约》最近怎么样？"), "无畏契约 有公开报道");
  assert.equal(parseClaims("不是 JSON"), null);
});

test("the report keeps supported facts, real dates, and real heat numbers", () => {
  const claims = assessClaims([
    claim("官方确认测试服将于 5 月 20 日开启", [1], "官方确认测试服将于 5 月 20 日开启"),
    claim("热度上升导致停服", [3], "当前热榜第 4 名"),
    claim("官方确认冠军皮肤将在下月推出", [2], "有报道猜测冠军皮肤可能在下月推出"),
  ], [official, media, heat]);
  const { markdown, report } = buildReport("《无畏契约》最近发生了什么？", claims, [official, media, heat]);
  assert.equal(report.summary.length, 1);
  assert.match(report.summary[0]!, /5 月 20 日/);
  assert.equal(markdown.includes("热度上升导致停服"), true);
  assert.match(markdown, /不能写成因果关系|已从结论中移除/);
  assert.equal(report.summary.some((line) => line.includes("导致")), false);
  assert.deepEqual(report.timeline.map((item) => item.evidenceId), [1, 2]);
  assert.deepEqual(report.coverage, { official: 1, media: 1, unknown: 1 });
  assert.equal(report.heat.find((item) => item.label === "热榜名次")?.value, "4");
  assert.equal(report.chart, null);
  assert.match(markdown, /不能据此断言热度变化的原因/);
});

test("two observations of the same heat label can be charted, one snapshot cannot", () => {
  const later: VerifiableEvidence = { ...heat, id: 4, excerpt: "当前热榜第 2 名", publishedAt: "2026-05-04T00:00:00.000Z" };
  const { report } = buildReport("热度", [], [heat, later]);
  assert.equal(report.chart?.length, 2);
  assert.deepEqual(report.chart?.map((point) => point.value), [4, 2]);
});

function step(partial: Partial<StepState> & Pick<StepState, "index" | "goal" | "status">): StepState {
  return { tool: partial.tool ?? "search", dependsOn: [], attempt: 1, summary: "完成", checkpoint: { phase: "tool_done", roundIndex: 1 }, ...partial };
}

function world(script: (opts: ChatToolsStreamOptions) => ChatToolsStreamResult | Error, seed: Partial<LoadedResearch> = {}) {
  const box = {
    current: {
      status: "running" as const,
      draft: "草稿认为游戏将在下月停服。",
      cancelRequested: false,
      modelCalls: 2,
      toolCalls: 1,
      planVersion: 1,
      startedMs: 1_000,
      evidence: [media],
      claims: [] as LoadedResearch["claims"],
      steps: [step({ index: 0, goal: "检索", status: "done" })],
      checkpoint: taskCheckpoint({ draftReady: true, synthesisRound: 2, synthesisReceiptId: 8, replans: 1 }),
      receiptStatus: { 8: "completed" as const },
      ...seed,
    },
  };
  const chats: string[] = [];
  const executed: string[] = [];
  let evidenceId = box.current.evidence.reduce((max, item) => Math.max(max, item.id), 0);
  const run: ResearchRun = {
    taskId: "task-verify",
    question: "梳理《无畏契约》最近一个月的重要事件。",
    background: "",
    now: () => 2_000,
    chat: async (opts) => {
      chats.push(opts.purpose);
      const made = script(opts);
      if (made instanceof Error) throw made;
      return made;
    },
    executeTool: async (name) => {
      executed.push(name);
      const result: ToolExecResult = {
        ok: true, name: name as AskToolName, text: "补检", structured: { count: 1 },
        evidence: [{ kind: "item", objectId: "extra", title: "补检没有停服报道", sourceName: "媒体", publishedAt: "2026-05-04T00:00:00.000Z", siteUrl: "/items/extra", originalUrl: null, toolName: name, rawRef: { excerpt: "补检没有停服报道", sourceType: "媒体报道" } }],
      };
      return result;
    },
    load: async () => structuredClone(box.current),
    claim: async () => true,
    renew: async () => {},
    bumpModel: async () => { box.current.modelCalls += 1; return box.current.modelCalls; },
    bumpTool: async () => { box.current.toolCalls += 1; return box.current.toolCalls; },
    noteReceipt: async () => {},
    commitReceipt: async () => {},
    saveCheckpoint: async (checkpoint) => { box.current.checkpoint = structuredClone(checkpoint); },
    setPlan: async () => {},
    saveStep: async () => {},
    recordEvidence: async (items) => items.map((item) => {
      evidenceId += 1;
      const raw = item.rawRef ?? {};
      box.current.evidence.push({ id: evidenceId, title: item.title, sourceType: typeof raw.sourceType === "string" ? raw.sourceType : "未知", excerpt: typeof raw.excerpt === "string" ? raw.excerpt : item.title, publishedAt: item.publishedAt, siteUrl: item.siteUrl });
      return evidenceId;
    }),
    saveClaims: async (claims) => { box.current.claims = structuredClone(claims); },
    emit: async () => {},
    saveDraft: async (text) => { box.current.draft = text; },
    finish: async (status, text) => { box.current.status = status; box.current.draft = text; },
  };
  return { run, box, chats, executed };
}

function reply(content: string): ChatToolsStreamResult {
  return { content, toolCalls: [], finishReason: "stop", receiptId: 1, reused: false, model: "fake", usage: null, jsonModeForced: false };
}

test("an unsupported fact gets one search, then a matching quote can be kept", async () => {
  let pass = 0;
  const driver = world(() => {
    pass += 1;
    if (pass === 1) return reply(JSON.stringify({ claims: [claim("游戏将在下月停服", [2], "游戏将在下月停服")] }));
    return reply(JSON.stringify({ claims: [claim("补检没有停服报道", [3], "补检没有停服报道")] }));
  });
  await runResearchDriver(driver.run);
  assert.deepEqual(driver.chats, ["ask.research_verify", "ask.research_verify"]);
  assert.deepEqual(driver.executed, ["search"]);
  assert.equal(driver.box.current.toolCalls, 2);
  assert.equal(driver.box.current.modelCalls, 4);
  assert.equal(driver.box.current.claims.some((item) => item.text.includes("将在下月停服") && item.status === "supported"), false);
  assert.equal(driver.box.current.claims.some((item) => item.status === "supported"), true);
  assert.equal(driver.box.current.status, "completed");
  assert.match(driver.box.current.draft, /核心结论/);
});

test("verifier failure, exhausted verify budget, and cancel do not publish the draft", async () => {
  const failed = world(() => new Error("verifier down"));
  await runResearchDriver(failed.run);
  assert.equal(failed.box.current.status, "completed_degraded");
  assert.equal(failed.executed.length, 0);
  assert.doesNotMatch(failed.box.current.draft, /草稿认为/);

  const budget = world(() => reply("{}"), { modelCalls: 10 });
  await runResearchDriver(budget.run);
  assert.equal(budget.chats.length, 0);
  assert.equal(budget.box.current.status, "limit_reached");
  assert.doesNotMatch(budget.box.current.draft, /草稿认为/);

  const cancelled = world(() => reply("{}"), { cancelRequested: true });
  await runResearchDriver(cancelled.run);
  assert.equal(cancelled.chats.length, 0);
  assert.equal(cancelled.box.current.status, "cancelled");
  assert.doesNotMatch(cancelled.box.current.draft, /草稿认为/);
  assert.equal(nextResearchAction({
    question: "q", cancelRequested: false, modelCalls: 10, toolCalls: 0, planVersion: 1, startedMs: 1, nowMs: 2,
    evidenceCount: 1, steps: [step({ index: 0, goal: "检索", status: "done" })],
    checkpoint: taskCheckpoint({ draftReady: true, verifyPasses: 0 }), receiptStatus: {},
  }).type, "finish_degraded");
});

test("human claim cases stay separate from the retrieval gold set", () => {
  const gold = readFileSync(new URL("../evals/ask-gold.2026-10-21.jsonl", import.meta.url), "utf8");
  assert.match(gold, /valorant-champion-exact/);
  assert.equal(gold.includes("\"claims\""), false);
  const cases = parseAskEvalJsonl(readFileSync(new URL("../evals/ask-claims.2026-10-21.jsonl", import.meta.url), "utf8"));
  const results = cases.flatMap((row) => {
    const result = citationCaseResult(row);
    return result ? [result] : [];
  });
  const verified = answerMetrics(results.filter((row) => row.caseId.endsWith("-verified")));
  const previous = answerMetrics(results.filter((row) => row.caseId.endsWith("-previous")));
  assert.equal(verified.claimSupportRate, 1);
  assert.equal(previous.claimSupportRate, 0);
  assert.equal(verified.completionRate, 1);
  assert.ok((verified.cost.totals.CNY ?? 0) < (previous.cost.totals.CNY ?? 0));
  assert.ok(verified.latencyMs.mean > previous.latencyMs.mean);
});

test("the report view keeps real sections and drops a one-point chart", () => {
  const payload = {
    report: {
      summary: ["官方确认测试服将于 5 月 20 日开启 [1]"],
      timeline: [{ at: "2026-05-01T02:00:00.000Z", title: "无畏契约更新公告", evidenceId: 1, sourceType: "官方来源" }],
      coverage: { official: 1, media: 0, unknown: 0 },
      comparison: [],
      heat: [{ label: "热榜名次", value: "4", evidenceId: 3 }],
      chart: [{ label: "热榜名次 · [3]", value: 4, evidenceId: 3 }],
      uncertainty: [{ status: "disputed", text: "官方确认冠军皮肤将在下月推出", note: "结论写成了官方表态，但所引证据没有官方来源。", evidenceIds: [2] }],
      citations: [{ id: 1, title: "无畏契约更新公告", sourceName: "拳头游戏", sourceType: "官方来源", siteUrl: "/items/official", publishedAt: "2026-05-01T02:00:00.000Z" }],
    },
  };
  const view = reportFromPayload(payload);
  assert.equal(view?.chart, null);
  assert.equal(view?.summary.length, 1);
  assert.equal(view?.heat[0]?.value, "4");
  const message = applyAskEvent({ key: "a", role: "assistant", text: "markdown", mode: "deep" }, "research_report", payload);
  assert.equal(message.report?.timeline[0]?.evidenceId, 1);
  assert.equal(message.text, "markdown");
  assert.equal(snapshotReport([{ type: "research_report", payload }])?.uncertainty[0]?.status, "disputed");
  const page = readFileSync(new URL("../web/ask.tsx", import.meta.url), "utf8");
  assert.match(page, /copyText\(message\.text\)/);
  assert.match(page, /message\.report \? <ReportView/);
});
