// Topic pages: which articles a topic takes, and their counts.
// Written before the code, from the ways it can go wrong:
// - a company topic takes an article about another company that only mentions it (several subjects,
//   its name nowhere in the title), or drops one about it whose title names it in English, in another
//   case, next to Chinese text, or only by a product (it is the article's only subject);
// - a Latin name matches inside another word ("Metadata" is not Meta); a headline naming a company
//   that is not a subject of the article gets in;
// - a technical-direction topic stops taking its tags;
// - withdrawn or not yet released articles appear in a list or a count;
// - an article or story page names a topic its reports do not belong to;
// - a topic without content has no page, or an unknown slug or a page past the end has one.
import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { publishArticle } from "@aihot/backend/publication/publish";
import { TOPICS, loadTopicPage, listTopicSummaries, topicsOfStory } from "@aihot/backend/publication/topics";
import { buildApp } from "../apps/api/src/app.ts";

const T = tag();
const OFFICIAL = `test-topics-official-${T}`;
const MEDIA = `test-topics-media-${T}`;
const app = await buildApp();

before(async () => {
  await sql`INSERT INTO sources (id, name, kind, tier, participation_mode, first_party, next_fetch_at) VALUES
    (${OFFICIAL}, 'Official', 'rss', 'T1', 'editorial', true, '2100-01-01'),
    (${MEDIA}, 'Media', 'rss', 'T2', 'editorial', false, '2100-01-01')`;
});
after(async () => {
  await app.close();
  await stopBoss();
  await closeDb();
});

let n = 0;
interface Report {
  source?: string;
  at: Date;
  title: string;
  originalTitle?: string;
  subjects?: string[];
  tags?: string[];
  score?: number;
  selected?: boolean;
  fact?: number;
  category?: string;
}

/** A published report; `fact` links it to a fact before publishing, as grouping would. */
async function report(r: Report): Promise<string> {
  n += 1;
  const { articleId } = await upsertMaterial({
    sourceId: r.source ?? MEDIA, url: `https://example.com/topics-${T}-${n}`, title: r.originalTitle ?? r.title, bodyText: "body", bodyHtml: "<p>body</p>", bodyStatus: "ok", via: "fetch", publishedAt: r.at,
  });
  await sql`UPDATE articles SET discovered_at = ${r.at}, timeline_at = ${r.at}, grouped_at = now() WHERE id = ${articleId}`;
  await sql`INSERT INTO analyses (article_id, input_revision, origin, relevance, category, title_zh, summary_zh, score, selected, subjects, tags)
            VALUES (${articleId}, 1, 'rule', 'pass', ${r.category ?? "new-games"}, ${r.title}, ${`摘要 ${n}`}, ${r.score ?? 80}, ${r.selected ?? true}, ${r.subjects ?? []}, ${[r.category === "esports" ? "电竞赛事" : r.category === "industry" ? "厂商动态" : "定档/上线", ...(r.tags ?? [])]})`;
  if (r.fact) await sql`INSERT INTO fact_articles (fact_id, article_id, role) VALUES (${r.fact}, ${articleId}, 'report')`;
  await publishArticle(articleId, { releasedAt: new Date(r.at.getTime() + 60_000) });
  return articleId;
}

async function story(title: string): Promise<{ id: number; publicId: string }> {
  const publicId = randomUUID();
  const [s] = await sql<{ id: number }[]>`INSERT INTO stories (public_id, title, first_report_at, latest_at) VALUES (${publicId}, ${title}, now(), now()) RETURNING id`;
  return { id: s!.id, publicId };
}

async function fact(storyId: number | null, title: string): Promise<number> {
  const [f] = await sql<{ id: number }[]>`INSERT INTO facts (public_id, story_id, title) VALUES (${`f-${T}-${randomUUID()}`}, ${storyId}, ${title}) RETURNING id`;
  return f!.id;
}

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000);
const ids = (items: Array<{ id: string }>) => items.map((i) => i.id);
const page = async (slug: string, p = 1) => {
  const data = await loadTopicPage(slug, p, new Date());
  assert.ok(data, `${slug} page ${p}`);
  return data;
};
/** Every article of a topic, over all its pages. */
async function members(slug: string): Promise<string[]> {
  const first = await page(slug);
  const out = ids(first.items);
  for (let p = 2; p <= first.pageCount; p++) out.push(...ids((await page(slug, p)).items));
  return out;
}

test("a company topic takes the articles about it, not the ones that only mention it", async () => {
  const about = await report({ at: hoursAgo(30), title: `喵喵的结合 新版本前瞻 ${T}`, subjects: ["mewgenics"] });
  const product = await report({ at: hoursAgo(31), title: `主机版发售日公布 ${T}`, subjects: ["mewgenics"] });
  const english = await report({ at: hoursAgo(32), title: `新版本发布 ${T}`, originalTitle: `Mewgenics launches a language update ${T}`, subjects: ["mewgenics", "baldurs-gate-3"] });
  const subpoena = await report({ at: hoursAgo(33), title: `博德之门 3 收到平台政策问询 ${T}`, subjects: ["baldurs-gate-3", "mewgenics", "larian"] });
  const lowerCase = await report({ at: hoursAgo(34), title: `baldur's gate 3 公布新补丁 ${T}`, subjects: ["baldurs-gate-3", "mewgenics"] });
  const pact = await report({ at: hoursAgo(35), title: `二十余家游戏公司签署适龄提示倡议 ${T}`, subjects: ["baldurs-gate-3", "mewgenics", "valve"] });
  const metadata = await report({ at: hoursAgo(36), title: `MewgenicsDB 数据站上线，博德之门 3 参与联动 ${T}`, subjects: ["mewgenics", "baldurs-gate-3"] });
  const adjacent = await report({ at: hoursAgo(37), title: `发布Mewgenics的新活动 ${T}`, subjects: ["mewgenics", "baldurs-gate-3"] });
  const headline = await report({ at: hoursAgo(38), title: `喵喵的结合 被一篇盘点提到 ${T}`, subjects: ["valve"] });
  const agent = await report({ at: hoursAgo(39), title: `手游新作发布 ${T}`, tags: ["手游"] });

  const mew = await members("mewgenics");
  for (const id of [about, product, english, adjacent]) assert.ok(mew.includes(id), "about Mewgenics");
  for (const id of [subpoena, lowerCase, pact, headline]) assert.ok(!mew.includes(id), "only mentions Mewgenics");
  assert.ok(!mew.includes(metadata), "MewgenicsDB is not Mewgenics");
  const bg3 = await members("baldurs-gate-3");
  for (const id of [subpoena, lowerCase, metadata]) assert.ok(bg3.includes(id), "about Baldur's Gate 3");
  for (const id of [english, pact]) assert.ok(!bg3.includes(id), "only mentions Baldur's Gate 3");
  assert.ok((await members("mobile")).includes(agent), "a platform topic takes its tag");

  // The article page names the topics it belongs to.
  const topicsOf = async (id: string) => {
    const res = await app.inject({ method: "GET", url: `/api/site/items/${id}` });
    return (JSON.parse(res.body) as { topics: Array<{ slug: string }> }).topics.map((t) => t.slug);
  };
  assert.deepEqual(await topicsOf(about), ["mewgenics", "launches"]);
  assert.deepEqual(await topicsOf(subpoena), ["baldurs-gate-3", "launches"]);
  assert.deepEqual(await topicsOf(pact), ["launches"]);
  assert.deepEqual(await topicsOf(agent), ["mobile", "launches"]);
});

test("a story page names the topics of its reports", async () => {
  const launch = await story(`手游新作公测 ${T}`);
  await report({ source: OFFICIAL, at: hoursAgo(26), title: `手游新作公测 ${T}`, tags: ["手游"], fact: await fact(launch.id, "开启公测") });
  assert.deepEqual(await topicsOfStory(launch.id), [{ slug: "mobile", name: "手游" }, { slug: "launches", name: "定档与上线" }]);
});

test("withdrawn articles stay out of lists and counts", async () => {
  const kept = await report({ at: hoursAgo(5), title: `杀戮尖塔 2 新版本上线 ${T}`, subjects: ["slay-the-spire-2"] });
  const withdrawn = await report({ at: hoursAgo(4), title: `杀戮尖塔 2 撤回的消息 ${T}`, subjects: ["slay-the-spire-2"] });
  await sql`UPDATE publications SET visibility = 'withdrawn' WHERE article_id = ${withdrawn}`;

  const data = await page("slay-the-spire-2");
  assert.deepEqual(ids(data.items), [kept]);
  assert.equal(data.topic.total, 1);
  const summary = (await listTopicSummaries()).topics.find((t) => t.slug === "slay-the-spire-2")!;
  assert.equal(summary.latest?.title, `杀戮尖塔 2 新版本上线 ${T}`, "the index shows the newest public article");
});

test("every topic has a page; unknown topics and pages past the end have none", async () => {
  const empty = await page("binding-of-isaac-rebirth");
  assert.equal(empty.topic.indexable, false, "a topic without content is not indexed");
  assert.deepEqual(empty.items, []);
  assert.equal(await loadTopicPage("not-a-topic", 1, new Date()), null);
  assert.equal(await loadTopicPage("binding-of-isaac-rebirth", 2, new Date()), null);
  const index = await app.inject({ method: "GET", url: "/api/site/topics" });
  const body = JSON.parse(index.body) as { groups: Array<{ key: string }>; topics: Array<{ slug: string }> };
  assert.deepEqual(body.groups.map((g) => g.key), ["company", "field", "genre"]);
  assert.deepEqual(body.topics.map((t) => t.slug).sort(), TOPICS.map((t) => t.slug).sort(), "the index lists every topic");
});
