import "../../../tests/setup.ts";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { publishArticle } from "@aihot/backend/publication/publish";
import { askItems } from "@aihot/backend/publication/ask";
import { executeAskTool } from "../src/tools/whitelist.ts";
import { askAliases } from "../src/tools/search-query.ts";
import { createSession, createTask, finishTask, getTask, insertAssistantMessage, insertEvidence, listMessages } from "../src/db/store.ts";
import { currentEvidence, historySources } from "../src/agent/evidence.ts";
import { newUuid } from "@aihot/backend/lib/ids";
import { runAskTask } from "../src/agent/loop.ts";
import Fastify from "fastify";
import { config } from "@aihot/backend/config";
import { registerAskRoutes } from "../src/http/routes.ts";

const source = `ask-search-${newUuid()}`;
const clock = new Date();
const ids: string[] = [];
before(async () => {
  await sql`INSERT INTO sources (id, name, kind, tier, participation_mode) VALUES (${source}, 'Ask fixture', 'rss', 'T1', 'editorial')`;
  for (let i = 0; i < 4; i++) {
    const at = new Date(clock.getTime() - (i === 3 ? 20 * 86400000 : i * 2 * 3600000));
    const { articleId } = await upsertMaterial({ sourceId: source, url: `https://example.org/${source}/${i}`, title: `博德之门3 测试更新 ${i}`, bodyText: '测试资料', bodyStatus: 'ok', via: 'fetch', publishedAt: at });
    await sql`INSERT INTO analyses (article_id, input_revision, origin, relevance, category, title_zh, summary_zh, score, selected) VALUES (${articleId}, 1, 'rule', 'pass', 'updates', ${`博德之门3 测试更新 ${i}`}, '固定摘要，不是真实报道', 90, true)`;
    await publishArticle(articleId, { releasedAt: at });
    await sql`UPDATE publications SET timeline_at = ${at}, sort_at = ${at}, visible_after = ${at} WHERE article_id = ${articleId}`;
    ids.push(articleId);
  }
});
after(closeDb);
const query = (extra = {}) => ({ queries: askAliases('BG3'), mode: 'all' as const, from: null, until: new Date(clock.getTime() + 1000), limit: 2, rangeKey: 'history', ...extra });

test("history and aliases retrieve old public articles with stable keyset pages", async () => {
  const first = await askItems(query());
  assert.deepEqual(first.items.map((i) => i.id), ids.slice(0,2));
  assert.ok(first.nextCursor);
  const next = await askItems(query({ cursor: first.nextCursor, until: new Date(clock.getTime() + 90000) }));
  assert.deepEqual(next.items.map((i) => i.id), ids.slice(2));
  assert.equal(next.nextCursor, null);
  await assert.rejects(askItems(query({ cursor: first.nextCursor, queries: ['unrelated'] })));
});
test("one hour is filtered in SQL before the page limit", async () => {
  const result = await askItems(query({ from: new Date(clock.getTime() - 3600000), limit: 1 }));
  assert.deepEqual(result.items.map((i) => i.id), [ids[0]]);
  assert.equal(result.nextCursor, null);
});
test("article context reads public summaries and registers a citeable source", async () => {
  const result = await executeAskTool('get_article', JSON.stringify({article_id:ids[0]}));
  assert.equal(result.ok, true);
  if (result.ok) { assert.equal(result.evidence[0]?.objectId, ids[0]); assert.match(result.text, /固定摘要/); }
});
test("get_latest registers each public item so recent-news answers can link original sources", async () => {
  const result = await executeAskTool('get_latest', JSON.stringify({ window:'all', mode:'all', limit:1 }));
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.evidence.length, 1);
    assert.equal(result.evidence[0]?.objectId, ids[0]);
    assert.equal(result.evidence[0]?.siteUrl, `/items/${ids[0]}`);
    assert.match(result.evidence[0]?.originalUrl ?? "", /^https:\/\//);
    assert.equal(result.structured.count, 1);
  }
});
test("illegal window 90d is coerced to all and still retrieves", async () => {
  const result = await executeAskTool("search", JSON.stringify({ q: "BG3", window: "90d", mode: "all", limit: 2 }));
  assert.equal(result.ok, true);
  if (result.ok) assert.ok((result.structured.count as number) >= 1);
});
test("empty named searches return no unrelated evidence", async () => {
  const result=await executeAskTool('search',JSON.stringify({q:'no-such-game-unique-fixture',window:'all'}));
  assert.equal(result.ok,true);
  if(result.ok){assert.equal(result.evidence.length,0);assert.equal(result.structured.count,0);assert.equal(result.structured.mode,'all');}
});
test("disabled model service rejects new messages before creating a task; context remains read-only",async()=>{
  const app=Fastify();registerAskRoutes(app);const previous=config.modelCallsEnabled;
  try{
    config.modelCallsEnabled=false;
    const {sessionId}=await createSession();
    const capabilities=await app.inject({url:'/api/ask/capabilities'});assert.equal(capabilities.json().available,false);
    const context=await app.inject({url:`/api/ask/context/${ids[0]}`});assert.equal(context.statusCode,200);
    const response=await app.inject({method:'POST',url:`/api/ask/sessions/${sessionId}/messages`,payload:{message:'fixture',clientRequestId:newUuid()}});
    assert.equal(response.statusCode,503);
    const [{n}]=await sql<{n:number}[]>`SELECT count(*)::int AS n FROM ask_tasks WHERE session_id=${sessionId}::uuid`;
    assert.equal(n,0);
  }finally{config.modelCallsEnabled=previous;await app.close();}
});
test("follow-up history carries article ids and previous citation mapping, using the latest messages", async () => {
  const {sessionId}=await createSession();
  for(let i=0;i<23;i++) await sql`INSERT INTO ask_messages (id, session_id, role, content, created_at) VALUES (${newUuid()}::uuid, ${sessionId}::uuid, 'user', ${`earlier-${i}`}, now() - (${30-i} || ' seconds')::interval)`;
  const prior=await createTask({sessionId,clientRequestId:newUuid(),message:'推荐一个游戏'});
  await finishTask(prior.id,null,'completed',{finalAnswer:'第一条 [1]'});
  await insertAssistantMessage(sessionId,prior.id,'第一条 [1]');
  await insertEvidence(prior.id,[{kind:'item',objectId:ids[0]!,title:'博德之门3',sourceName:'Fixture',publishedAt:clock.toISOString(),siteUrl:`/items/${ids[0]}`,originalUrl:null,toolName:'search',rawRef:{}}]);
  const next=await createTask({sessionId,clientRequestId:newUuid(),message:'第一条有什么变化？'});
  const [receipt]=await sql<{id:number}[]>`INSERT INTO receipts (logical_key,service,model,purpose,subject,status,request,attempts) VALUES (${newUuid()},'llm','m','ask.tools_stream','fixture','received','{}'::jsonb,1) RETURNING id`;
  await runAskTask({taskId:next.id,workerId:'ask-history-test',chat:async (opts)=>{
    assert.ok(opts.messages.some(m=>m.content?.includes(ids[0]!)));
    assert.ok(!opts.messages.some(m=>m.content==='earlier-0'));
    assert.ok(opts.messages.some(m=>m.content==='第一条有什么变化？'));
    return {content:'需要查看原文。',toolCalls:[],finishReason:'stop',receiptId:receipt!.id,reused:false,model:'default',usage:null,jsonModeForced:false};
  }});
  assert.equal((await getTask(next.id))?.status,'completed');
  const recent=await listMessages(sessionId,3);
  assert.ok(recent.some(m=>m.content==='第一条有什么变化？'));
  const checked=await currentEvidence((await getTask(prior.id))!);
  assert.equal(historySources(checked.evidence)[0]?.objectId,ids[0]);
});
test("withdrawn evidence invalidates resumed answers and is absent from new searches", async () => {
  const {sessionId}=await createSession(); const task=await createTask({sessionId,clientRequestId:newUuid(),message:'fixture'});
  await insertEvidence(task.id,[{kind:'item',objectId:ids[3]!,title:'old',sourceName:'Fixture',publishedAt:null,siteUrl:`/items/${ids[3]}`,originalUrl:null,toolName:'search',rawRef:{}}]);
  await sql`UPDATE publications SET visibility='withdrawn' WHERE article_id=${ids[3]!}`;
  assert.equal((await currentEvidence((await getTask(task.id))!)).invalidated,true);
  assert.equal((await getTask(task.id))?.content_invalidated,true);
  assert.ok(!(await askItems(query({limit:30}))).items.some(i=>i.id===ids[3]));
});
