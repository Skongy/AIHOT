import '../../../tests/setup.ts';
import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { sql, closeDb } from '@aihot/backend/db';
import { upsertMaterial } from '@aihot/backend/content/materials';
import { publishArticle } from '@aihot/backend/publication/publish';
import { newUuid } from '@aihot/backend/lib/ids';
import { newsStats, searchEvents, attentionTrend, readResearchArticle, researchSnapshotAvailable } from '@aihot/backend/publication/research';
import { askItems } from '@aihot/backend/publication/ask';
import { executeAskTool } from '../src/tools/whitelist.ts';
import { currentEvidence } from '../src/agent/evidence.ts';
import { createSession, createTask, getTask, insertEvidence } from '../src/db/store.ts';
import { buildApp } from '../../../apps/api/src/app.ts';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { mcpToolName } from '@aihot/contracts/mcp';
import { installModules } from '@aihot/backend/modules';
import { SERVER_MODULES } from '@aihot/site/modules/server';
import { listEvidence } from '../src/db/store.ts';

const tag = newUuid(), source = `research-${tag}`, media = `media-${tag}`, publicId = newUuid();
const ids: string[] = [];
const now = new Date(), until = new Date(now.getTime() - 1000), from = new Date(now.getTime() - 86400000);
let storyId: number;
const query = { queries: ['CS2'], mode: 'all' as const, from, until };
before(async () => {
  await sql`INSERT INTO sources (id,name,kind,tier,first_party,participation_mode,site_fulltext) VALUES
    (${source},'Research official','rss','T1',true,'editorial',true), (${media},'Research media','rss','T2',false,'editorial',true)`;
  const [story] = await sql`INSERT INTO stories (public_id,title) VALUES (${publicId},'CS2 公告研究测试') RETURNING id`;
  storyId = Number(story!.id);
  const [fact] = await sql`INSERT INTO facts (public_id,title,story_id) VALUES (${tag},'CS2 公告研究测试',${storyId}) RETURNING id`;
  for (let i = 0; i < 5; i++) {
    const at = new Date(now.getTime() - (i === 4 ? 3 * 86400000 : 7200000));
    const { articleId } = await upsertMaterial({ sourceId: i === 0 ? source : media, url: `https://example.org/${tag}/${i}`,
      title: `CS2 公告研究测试 ${i}`, bodyText: '公告原文：反作弊更新已公布。', bodyHtml: '<p>公告原文：反作弊更新已公布。</p>', bodyStatus: 'ok', via: 'fetch', publishedAt: at });
    await sql`INSERT INTO analyses (article_id,input_revision,origin,relevance,category,title_zh,summary_zh,score,selected)
      VALUES (${articleId},1,'rule','pass','updates',${`CS2 公告研究测试 ${i}`},'公告的固定摘要',90,true)`;
    await sql`INSERT INTO fact_articles (fact_id,article_id,role) VALUES (${fact!.id},${articleId},'report')`;
    await publishArticle(articleId,{releasedAt:at});
    await sql`UPDATE publications SET timeline_at=${at},sort_at=${at},visible_after=${at} WHERE article_id=${articleId}`;
    await sql`UPDATE articles SET wire_fingerprint=${'a'.repeat(64)} WHERE id=${articleId}`;
    ids.push(articleId);
  }
  await sql`UPDATE publications SET visibility='withdrawn' WHERE article_id=${ids[3]!}`;
});
after(closeDb);

test('stats count the entire public set, dedupe facts and wire copies, and enforce source/time filters', async () => {
  const stats = await newsStats(query);
  assert.equal(stats.reports,3); assert.equal(stats.facts,1); assert.equal(stats.sources,2); assert.equal(stats.independentSources,1); assert.equal(stats.officialReports,1);
  assert.equal((await newsStats({...query,firstParty:true})).reports,1);
  assert.equal((await newsStats({...query,firstParty:false})).reports,2);
  assert.equal((await newsStats({...query,source:'Research media'})).reports,2);
  assert.equal((await newsStats({...query,queries:['不存在的游戏']})).reports,0);
  assert.equal((await newsStats({...query,until:new Date(now.getTime()-10800000)})).reports,0);
  const page = await askItems({...query,firstParty:true,limit:1,rangeKey:'fixture',engine:'hybrid-v1'});
  assert.deepEqual(page.items.map(i=>i.id),[ids[0]]);
  const mediaPage = await askItems({...query,firstParty:false,limit:1,rangeKey:'fixture'});
  assert.ok(mediaPage.nextCursor);
  await assert.rejects(askItems({...query,firstParty:true,limit:1,rangeKey:'fixture',cursor:mediaPage.nextCursor!}));
});

test('named event discovery returns real IDs even without hot rankings; trends preserve missing hours', async () => {
  const events = await searchEvents(query);
  assert.equal(events.items[0]?.public_id,publicId); assert.equal(events.items[0]?.matchingReports,3);
  const hour = new Date(Math.floor(from.getTime()/3600000)*3600000+3600000);
  await sql`INSERT INTO story_heat_hourly (story_id,hour,heat,participants,complete) VALUES
    (${storyId},${hour},10,1,true), (${storyId},${new Date(hour.getTime()+3600000)},20,2,false)`;
  const trend = await attentionTrend(publicId,from,until);
  assert.equal(trend?.availablePoints,1); assert.equal(trend?.observationSufficient,false);
  assert.ok(trend?.points.some(p=>p.index===null)); assert.ok(!JSON.stringify(trend).includes('"heat"'));
  assert.equal(await attentionTrend(newUuid(),from,until),null);
});

test('article tool exposes real public passages and rejects withdrawn articles', async () => {
  const article = await readResearchArticle(ids[0]!,'反作弊');
  assert.match(article?.passages.map(p=>p.text).join('')??'',/反作弊/);
  assert.equal(article?.sourceType,'官方来源');
  const tool = await executeAskTool('get_article',JSON.stringify({article_id:ids[0],question:'反作弊'}));
  assert.ok(tool.ok); if(tool.ok) assert.match(tool.text,/反作弊/);
  assert.equal(await readResearchArticle(ids[3]!),null);
});

test('MCP lists and executes all research abilities; REST rejects invalid filters', async () => {
  installModules(SERVER_MODULES);
  const app = await buildApp();
  const client = new Client({name:'research-test',version:'1.0.0'});
  try {
    const origin = await app.listen({host:'127.0.0.1',port:0});
    await client.connect(new StreamableHTTPClientTransport(new URL(origin+'/api/mcp')));
    const names = (await client.listTools()).tools.map(t=>t.name);
    for(const tool of ['get_article','search_news','search_events','get_news_stats','get_attention_trend']) assert.ok(names.includes(mcpToolName(tool)),`missing ${tool}: ${names.join(',')}`);
    const result = await client.callTool({name:mcpToolName('get_news_stats'),arguments:{q:'CS2',from:from.toISOString(),until:until.toISOString()}});
    assert.ok(!result.isError); assert.equal((result.structuredContent as Record<string, unknown>)?.reports,3);
    const search = await client.callTool({name:mcpToolName('search_news'),arguments:{q:'CS2',firstParty:true}});
    assert.ok(!search.isError);
    const response = await app.inject('/api/v1/agent/news-stats?q=CS2&firstParty=invalid');
    assert.equal(response.statusCode,400);
  } finally { await client.close(); await app.close(); installModules([]); }
});

test('reading multiple excerpts keeps one citation and preserves all inspected text', async () => {
  const session=await createSession(); const task=await createTask({sessionId:session.sessionId,clientRequestId:newUuid(),message:'阅读公告'});
  const evidence={kind:'item',objectId:ids[0]!,title:'公告',sourceName:'Research official',publishedAt:null,siteUrl:`/items/${ids[0]}`,originalUrl:null,toolName:'get_article'};
  const first=await insertEvidence(task.id,[{...evidence,rawRef:{bodyExcerpt:'第一段公开原文'}}]);
  const second=await insertEvidence(task.id,[{...evidence,rawRef:{bodyExcerpt:'第二段公开原文'}}]);
  assert.deepEqual(first,second);
  const rows=await listEvidence(task.id);assert.equal(rows.length,1);
  assert.match(String(rows[0]?.raw_ref?.bodyExcerpt),/第一段公开原文\n第二段公开原文/);
});

test('withdrawal invalidates a statistics snapshot, without fabricating current counts', async () => {
  const result=await executeAskTool('get_news_stats',JSON.stringify({q:'CS2',from:from.toISOString(),until:until.toISOString()}));
  assert.ok(result.ok); if(!result.ok)return;
  const session=await createSession(); const task=await createTask({sessionId:session.sessionId,clientRequestId:newUuid(),message:'统计CS2'});
  await insertEvidence(task.id,result.evidence);
  assert.equal((await currentEvidence((await getTask(task.id))!)).invalidated,false);
  await sql`UPDATE publications SET visibility='withdrawn' WHERE article_id=${ids[0]!}`;
  assert.equal(await researchSnapshotAvailable([ids[0]!]),false);
  assert.equal((await currentEvidence((await getTask(task.id))!)).invalidated,true);
});
