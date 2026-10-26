import assert from "node:assert/strict";
import { test } from "node:test";
import { articlePassages, attentionSeries, validateResearchRange } from "@aihot/backend/publication/research";
import { directToolArgs } from "../src/agent/research.ts";
import { researchAbilities } from "../src/tools/public-research.ts";
import { executeAskTool } from "../src/tools/whitelist.ts";

test("paragraph retrieval reaches a late matching paragraph and marks clipped text", () => {
  const html = `<script>secret-instruction</script>${'<p>无关内容</p>'.repeat(20)}<p>${'背景'.repeat(2000)}匹配词：反作弊改动，正式公告。</p>`;
  const passages = articlePassages(html, "反作弊", 300);
  const match = passages.find(p => p.paragraph === 21)!;
  assert.match(match.text, /反作弊改动/);
  assert.equal(match.truncated, true);
  assert.ok(match.startOffset > 0);
  assert.ok(passages.reduce((n,p)=>n+p.text.length,0)<=300);
  assert.ok(!JSON.stringify(passages).includes("secret-instruction"));
  assert.deepEqual(articlePassages(""), []);
});

test("attention gaps stay null; a single observation cannot justify a trend", () => {
  const from = new Date('2026-10-20T00:00:00Z'), until = new Date('2026-10-20T04:00:00Z');
  const one = attentionSeries([{ hour: from, heat: 10 }], from, until);
  assert.equal(one.observationSufficient, false);
  assert.deepEqual(one.points.map(p => p.index), [100, null, null, null]);
  const two = attentionSeries([{ hour: from, heat: 10 }, { hour: new Date(from.getTime() + 7200000), heat: 0 }], from, until);
  assert.deepEqual(two.points.map(p => p.index), [100, null, 0, null]);
  assert.equal(two.observationSufficient, true);
  assert.equal(attentionSeries([], from, until).availablePoints, 0);
});

test("quantitative research rejects unbounded ranges and invalid tool arguments before reads", async () => {
  assert.throws(() => validateResearchRange({ queries: [], mode: 'all', from: null, until: new Date() }));
  for (const tool of ['search_events', 'get_news_stats']) {
    const result = await executeAskTool(tool, JSON.stringify({ q: 'CS2', window: 'all' }));
    assert.equal(result.ok, false);
  }
  assert.equal((await executeAskTool('get_attention_trend', '{"public_id":"invented"}')).ok, false);
  assert.equal((await executeAskTool('search', '{"q":"CS2","firstParty":"true"}')).ok, false);
});

test("comparison steps share one anchored clock and honor explicit dates and official scope", () => {
  const clock = Date.parse('2026-10-26T03:00:00Z');
  const question = '只看官方，对比《CS2》和《原神》最近一周报道量';
  const a = JSON.parse(directToolArgs('get_news_stats', question, '统计《CS2》', clock)!);
  const b = JSON.parse(directToolArgs('get_news_stats', question, '统计《原神》', clock)!);
  assert.equal(a.from, b.from); assert.equal(a.until, b.until); assert.equal(a.firstParty, true);
  assert.match(a.q, /CS2/i); assert.ok(!a.q.includes('原神'));
  const dates = JSON.parse(directToolArgs('get_news_stats', '《CS2》2026-10-01 到 2026-10-05 的报道', '统计《CS2》', clock)!);
  assert.equal(dates.from, '2026-09-30T16:00:00.000Z');
  assert.equal(dates.until, '2026-10-05T16:00:00.000Z');
});

test("external research tools expose strict real schemas and reject invalid REST booleans", async () => {
  const tools = researchAbilities();
  assert.deepEqual(tools.map(t => t.mcp.tool), ['get_article', 'search_news', 'search_events', 'get_news_stats', 'get_attention_trend']);
  const search = tools.find(t => t.mcp.tool === 'search_news')!;
  await assert.rejects(search.answer({ q: 'CS2', firstParty: 'maybe' }));
  const bad = await search.mcp.run({ q: 'CS2', write: true });
  assert.ok('error' in bad.structured);
});
