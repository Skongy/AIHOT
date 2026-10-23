// Fake-model executor guards (≥15 cases). No paid API. No DATABASE required for pure helpers;
// DB-backed cases use the test database when available via sibling file.
import assert from "node:assert/strict";
import { test } from "node:test";
import { checkCitations, sanitizeAskMarkdown, isAllowedAskHref, stripThinkTags, stripThinkTagsStreaming, stripToolCallMarkup, stripAskModelText, extractXmlToolCalls } from "../src/agent/citations.ts";
import { ASK_TOOL_NAMES, ASK_TOOL_LABELS_ZH, friendlyStepSummary } from "../src/tools/whitelist.ts";
import { logicalKeyFor } from "@aihot/backend/providers/receipts";
import { sha256, stableJson } from "@aihot/backend/lib/ids";

test("whitelist includes article context and keeps the existing tools", () => {
  assert.deepEqual([...ASK_TOOL_NAMES], ["get_latest", "search", "get_hot_topics", "get_story", "explain_selection", "explain_hot", "get_daily", "get_article"]);
  assert.ok(ASK_TOOL_NAMES.includes("get_daily"));
  assert.equal(Object.keys(ASK_TOOL_LABELS_ZH).length, 8);
});

test("citation check fails on forged numbers", () => {
  const r = checkCitations("参见 [1] 与 [99]", [1, 2]);
  assert.equal(r.ok, false);
  assert.ok(r.issues.some((i) => i.includes("99")));
});

test("citation check fails on raw URLs", () => {
  const r = checkCitations("见 https://evil.example/x", [1]);
  assert.equal(r.ok, false);
});

test("citation check passes registered only", () => {
  assert.equal(checkCitations("根据 [1] 和 [2]", [1, 2]).ok, true);
});

test("normal answers require a registered citation on every factual sentence", () => {
  const options = { requireSentenceCitations: true, evidence: [{ id: 1, text: "第一条事实。" }, { id: 2, text: "第二条事实。" }] };
  assert.deepEqual(checkCitations("第一条事实 [1]。第二条事实没有引用。", [1], options), { ok: false, issues: ["uncited_sentence"] });
  assert.equal(checkCitations("# 结论\n第一条事实 [1]。\n- 第二条事实 [2]。", [1, 2], options).ok, true);
  assert.deepEqual(checkCitations("第一条事实 [2]。", [1, 2], options), { ok: false, issues: ["citation_text_mismatch"] });
  assert.equal(checkCitations("一般说明，没有引用。", [], { requireSentenceCitations: true }).ok, true);
});

test("sanitize strips images and iframes", () => {
  const out = sanitizeAskMarkdown("你好 ![x](https://evil/x.png) <iframe src='https://e'></iframe> [ok](/items/a)", new Set(["/items/a"]));
  assert.ok(!out.includes("iframe"));
  assert.ok(!out.includes("evil/x.png"));
  assert.ok(out.includes("[ok](/items/a)"));
});

test("sanitize unlinks unregistered markdown links", () => {
  const out = sanitizeAskMarkdown("[坏链](https://evil.example) 与 [好](/items/1)", new Set(["/items/1"]));
  assert.ok(!out.includes("](https://evil.example)"));
  assert.ok(out.includes("[好](/items/1)"));
});

test("stripThinkTags removes closed and unclosed reasoning blocks", () => {
  assert.equal(stripThinkTags("前<think>秘密</think>后"), "前后");
  assert.equal(stripThinkTags("可见<think>未闭合仍在想"), "可见");
  assert.equal(stripThinkTags("a</think>b"), "ab");
  assert.equal(stripThinkTags("无标签"), "无标签");
});

test("sanitizeAskMarkdown also strips think tags", () => {
  const out = sanitizeAskMarkdown("答<think>推理</think>案 [好](/items/1)", new Set(["/items/1"]));
  assert.ok(!out.includes("think"));
  assert.ok(!out.includes("推理"));
  assert.ok(out.includes("答案"));
  assert.ok(out.includes("[好](/items/1)"));
});

test("stripThinkTagsStreaming withholds incomplete open-tag prefixes", () => {
  assert.equal(stripThinkTagsStreaming("你好 <thi"), "你好 ");
  assert.equal(stripThinkTagsStreaming("你好 <think>藏"), "你好 ");
  assert.equal(stripThinkTagsStreaming("你好 <think>藏</think>世界"), "你好 世界");
});

test("isAllowedAskHref blocks javascript and data", () => {
  assert.equal(isAllowedAskHref("javascript:alert(1)", new Set()), false);
  assert.equal(isAllowedAskHref("data:text/html,x", new Set()), false);
  assert.equal(isAllowedAskHref("/items/1", new Set(["/items/1"])), true);
});

test("receipt identity binds taskId and roundIndex not subject alone", () => {
  const base = {
    service: "llm",
    purpose: "ask.tools_stream",
    model: "m",
    identity: { taskId: "t1", roundIndex: 1, messagesHash: "a", toolsHash: "b", stream: true },
  };
  const k1 = logicalKeyFor(base);
  const k2 = logicalKeyFor({ ...base, subject: "different-subject" });
  assert.equal(k1, k2, "subject must not change logical key");
  const k3 = logicalKeyFor({ ...base, identity: { ...base.identity, roundIndex: 2 } });
  assert.notEqual(k1, k3);
  const k4 = logicalKeyFor({ ...base, identity: { ...base.identity, taskId: "t2" } });
  assert.notEqual(k1, k4);
  const k5 = logicalKeyFor({ ...base, attemptTag: "retry:1" });
  assert.notEqual(k1, k5);
});

test("identity hash includes messages and tools", () => {
  const h1 = sha256(stableJson({ messagesHash: "m1", toolsHash: "t1" }));
  const h2 = sha256(stableJson({ messagesHash: "m2", toolsHash: "t1" }));
  assert.notEqual(h1, h2);
});

test("get_latest step chip is 拉取近期精选/公开动态, not 相关资料", () => {
  const summary = friendlyStepSummary({
    ok: true,
    name: "get_latest",
    text: "近期列表……",
    structured: { count: 30, mode: "selected" },
    evidence: [],
  });
  assert.equal(summary, "拉取近期精选 30 条");
  assert.equal(summary.includes("相关资料"), false);
});

test("search/hot step chip still says 相关资料 when evidence present", () => {
  const summary = friendlyStepSummary({
    ok: true,
    name: "search",
    text: "hit",
    structured: { count: 1 },
    evidence: [
      { kind: "item", objectId: "a", title: "t", sourceName: null, publishedAt: null, siteUrl: "/items/a", originalUrl: null, toolName: "search", rawRef: {} },
    ],
  });
  assert.equal(summary, "找到 1 条相关资料");
});

test("stripToolCallMarkup removes MiniMax tool_call XML", () => {
  const raw = `前言
<minimax:tool_call>
<invoke name="get_latest">
<parameter name="window">24h</parameter>
</invoke>
</minimax:tool_call>
后语`;
  const out = stripToolCallMarkup(raw);
  assert.equal(out.includes("minimax"), false);
  assert.equal(out.includes("invoke"), false);
  assert.equal(out.includes("get_latest"), false);
  assert.ok(out.includes("前言"));
  assert.ok(out.includes("后语"));
});

test("stripAskModelText strips think and tool_call together", () => {
  const out = stripAskModelText('可见<think>藏</think><minimax:tool_call><invoke name="search"><parameter name="q">无畏契约</parameter></invoke></minimax:tool_call>答案');
  assert.equal(out.includes("think"), false);
  assert.equal(out.includes("minimax"), false);
  assert.equal(out.includes("藏"), false);
  assert.ok(out.includes("可见"));
  assert.ok(out.includes("答案"));
});

test("sanitizeAskMarkdown strips minimax tool_call so it never reaches UI", () => {
  const leaked = `<minimax:tool_call>
<invoke name="get_latest">
<parameter name="window">24h</parameter>
</invoke>
</minimax:tool_call>`;
  const out = sanitizeAskMarkdown(leaked, new Set());
  assert.equal(out.includes("minimax"), false);
  assert.equal(out.includes("<invoke"), false);
  assert.equal(out.trim(), "");
});

test("stripThinkTagsStreaming withholds incomplete minimax tool_call prefixes", () => {
  assert.equal(stripThinkTagsStreaming("你好 <mini"), "你好 ");
  assert.equal(stripThinkTagsStreaming("你好 <minimax:tool_call"), "你好 ");
  assert.equal(
    stripThinkTagsStreaming(`你好 <minimax:tool_call>
<invoke name="get_latest">
<parameter name="window">24h</parameter>
</invoke>
</minimax:tool_call>世界`),
    "你好 世界",
  );
});

test("extractXmlToolCalls parses MiniMax get_latest and leaves prose", () => {
  const raw = `稍等
<minimax:tool_call>
<invoke name="get_latest">
<parameter name="window">24h</parameter>
</invoke>
</minimax:tool_call>`;
  const { toolCalls, remainder } = extractXmlToolCalls(raw);
  assert.equal(toolCalls.length, 1);
  assert.equal(toolCalls[0]!.function.name, "get_latest");
  assert.equal(JSON.parse(toolCalls[0]!.function.arguments).window, "24h");
  assert.ok(remainder.includes("稍等"));
  assert.equal(remainder.includes("minimax"), false);
});

test("extractXmlToolCalls parses multiple invokes and numeric params", () => {
  const raw = `<minimax:tool_call>
<invoke name="search">
<parameter name="q">Valorant Champions</parameter>
<parameter name="limit">10</parameter>
</invoke>
<invoke name="get_hot_topics">
<parameter name="limit">5</parameter>
</invoke>
</minimax:tool_call>`;
  const { toolCalls, remainder } = extractXmlToolCalls(raw);
  assert.equal(toolCalls.length, 2);
  assert.equal(toolCalls[0]!.function.name, "search");
  assert.deepEqual(JSON.parse(toolCalls[0]!.function.arguments), { q: "Valorant Champions", limit: 10 });
  assert.equal(toolCalls[1]!.function.name, "get_hot_topics");
  assert.deepEqual(JSON.parse(toolCalls[1]!.function.arguments), { limit: 5 });
  assert.equal(remainder.trim(), "");
});

test("XML-only model output strips to empty (loop falls back via visibleAnswer)", () => {
  const leaked = `<minimax:tool_call>
<invoke name="get_latest">
<parameter name="window">24h</parameter>
</invoke>
</minimax:tool_call>`;
  assert.equal(stripAskModelText(leaked).trim(), "");
  const { toolCalls } = extractXmlToolCalls(leaked);
  assert.equal(toolCalls.length, 1);
  assert.equal(toolCalls[0]!.function.name, "get_latest");
});
