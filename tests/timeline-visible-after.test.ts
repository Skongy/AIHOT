// The same report keeps one timeline clock in 精选, 全部动态 and read APIs.
import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, mock, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { publishArticle } from "@aihot/backend/publication/publish";
import { loadTimeline } from "@aihot/backend/publication/timeline";
import { loadPool } from "@aihot/backend/publication/pool";
import { askItems } from "@aihot/backend/publication/ask";
import { v1Items } from "@aihot/backend/publication/v1";
import { stopBoss } from "@aihot/backend/jobs/queue";

after(async () => { await stopBoss(); await closeDb(); });

test("精选、全部动态、Ask 和公开 API 对同一条新闻显示相同时间", async () => {
  const T = tag();
  const source = `va-${T}`;
  const discovered = new Date("2024-06-10T00:00:00Z");
  const listed = new Date("2024-06-15T12:00:00Z");
  const now = new Date("2024-06-16T00:00:00Z");
  await sql`INSERT INTO sources (id, name, kind, tier, participation_mode, next_fetch_at)
    VALUES (${source}, 'Visible after', 'rss', 'T1', 'editorial', '2100-01-01')`;

  // Pre-existing row: sort_at still mirrors discovery, but visible_after is the real listing stamp.
  const staleId = `${T}-stale`;
  await sql`INSERT INTO articles (id, source_id, identity_key, url, title, discovered_at, timeline_at, published_at)
    VALUES (${staleId}, ${source}, ${staleId}, ${`https://example.org/${staleId}`}, ${staleId}, ${discovered}, ${discovered}, ${discovered})`;
  await sql`INSERT INTO publications (article_id, title, source_id, channel, url, discovered_at, timeline_at, sort_at,
      eligible, selected, visible_after, visibility, tags, seat, search_text)
    VALUES (${staleId}, ${staleId}, ${source}, 'news', ${`https://example.org/${staleId}`}, ${discovered}, ${discovered}, ${discovered},
      true, true, ${listed}, 'public', ${[T]}, true, ${staleId.toLowerCase()})`;

  const timeline = await loadTimeline({ channel: "all", category: null, tag: T, now });
  assert.equal(timeline.cards.length, 1);
  assert.equal(timeline.cards[0]!.item.id, staleId);
  assert.equal(timeline.cards[0]!.anchorAt, discovered.toISOString(), "精选卡使用新闻时间轴时间");

  const pool = await loadPool({ channel: "all", category: null, tag: T, page: 1, now });
  assert.equal(pool.items[0]!.id, staleId);
  assert.equal(pool.items[0]!.timelineAt, discovered.toISOString(), "全部动态使用同一时间");

  const ask = await askItems({
    queries: [T], mode: "selected", from: null, until: now, limit: 10, rangeKey: `va-${T}`,
  }, now);
  assert.equal(ask.items[0]!.id, staleId);
  assert.equal(ask.items[0]!.timelineAt, discovered.toISOString(), "Ask selected 使用同一时间");

  const api = await v1Items({ mode: "selected", window: "7d", by: "timeline", category: null, q: T, limit: 10, cursor: null }, now);
  assert.equal(api.items[0]!.timelineAt, discovered.toISOString(), "公开 API selected 使用同一时间");

  // Fresh publish: selected → visible_after = now, sort_at follows.
  mock.timers.enable({ apis: ["Date"], now: listed.getTime() });
  try {
    const { articleId } = await upsertMaterial({
      sourceId: source, url: `https://example.org/${T}-fresh`, title: `${T} fresh`,
      bodyText: "A new public result with evidence.", bodyStatus: "ok", via: "fetch", publishedAt: discovered,
    });
    await sql`UPDATE articles SET discovered_at = ${discovered}, timeline_at = ${discovered}, published_at = ${discovered},
      grouping_status = 'complete', grouped_at = now(), selection_adds_value = true WHERE id = ${articleId}`;
    await sql`INSERT INTO analyses (article_id, input_revision, origin, relevance, category, title_zh, summary_zh, reason_zh, score, selected)
      VALUES (${articleId}, 1, 'rule', 'pass', 'new-games', ${`${T} fresh`}, '有证据的新结果', '理由', 90, true)`;
    await publishArticle(articleId, { now: listed });
    const [row] = await sql<{ sort_at: Date; visible_after: Date; timeline_at: Date; selected: boolean }[]>`
      SELECT sort_at, visible_after, timeline_at, selected FROM publications WHERE article_id = ${articleId}`;
    assert.equal(row!.selected, true);
    assert.equal(row!.timeline_at.toISOString(), discovered.toISOString(), "发现时钟不动");
    assert.equal(row!.visible_after.toISOString(), listed.toISOString());
    assert.equal(row!.sort_at.toISOString(), listed.toISOString(), "新精选 publish 用上架时间写入 sort_at");
  } finally {
    mock.timers.reset();
  }
});

test("fact group on 精选 takes earliest news time among selected evidence", async () => {
  const T = tag();
  const source = `va-fact-${T}`;
  const firstListed = new Date("2024-05-01T08:00:00Z");
  const laterListed = new Date("2024-05-02T08:00:00Z");
  const firstNews = new Date("2024-01-01T00:00:00Z");
  const laterNews = new Date("2024-01-02T00:00:00Z");
  const now = new Date("2024-05-03T00:00:00Z");
  await sql`INSERT INTO sources (id, name, kind, tier) VALUES (${source}, ${source}, 'rss', 'T1')`;
  const [fact] = await sql<{ id: number }[]>`INSERT INTO facts (public_id, title) VALUES (${T}, ${T}) RETURNING id`;
  const add = async (suffix: string, newsAt: Date, listed: Date) => {
    const id = `${T}-${suffix}`;
    await sql`INSERT INTO articles (id, source_id, identity_key, url, title, discovered_at, timeline_at)
      VALUES (${id}, ${source}, ${id}, ${`https://example.org/${id}`}, ${id}, ${newsAt}, ${newsAt})`;
    await sql`INSERT INTO publications (article_id, title, source_id, channel, url, discovered_at, timeline_at, sort_at,
        eligible, selected, visible_after, visibility, tags, fact_id)
      VALUES (${id}, ${id}, ${source}, 'news', ${`https://example.org/${id}`}, ${newsAt}, ${newsAt}, ${newsAt},
        true, true, ${listed}, 'public', ${[T]}, ${fact!.id})`;
    await sql`INSERT INTO fact_articles (fact_id, article_id, role) VALUES (${fact!.id}, ${id}, 'report')`;
  };
  await add("a", firstNews, laterListed);
  await add("b", laterNews, firstListed);
  const timeline = await loadTimeline({ channel: "all", category: null, tag: T, now });
  assert.equal(timeline.cards.length, 1);
  assert.equal(timeline.cards[0]!.key, `f${fact!.id}`);
  assert.equal(timeline.cards[0]!.anchorAt, firstNews.toISOString());
});
