// Import a public API snapshot into an isolated *_test / *_ci database for retrieval evaluation.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { z } from "zod";
import { closeDb, sql } from "@aihot/backend/db";
import { sha256 } from "@aihot/backend/lib/ids";

const ItemSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
  title: z.string().min(1),
  originalTitle: z.string().nullable().optional(),
  summary: z.string().nullable(),
  source: z.object({ name: z.string().min(1) }),
  links: z.object({ original: z.string().url() }),
  publishedAt: z.string().datetime().nullable(),
  discoveredAt: z.string().datetime(),
  timelineAt: z.string().datetime(),
  category: z.string().nullable(),
  score: z.number().nullable(),
  selected: z.boolean(),
  reason: z.string().nullable(),
});

const SnapshotSchema = z.object({
  fetchedAt: z.string(),
  source: z.string(),
  items: z.array(ItemSchema).min(1),
});

const file = process.argv[2];
if (!file) throw new Error("Usage: node scripts/import-ask-eval-snapshot.ts <snapshot.json>");
const database = decodeURIComponent(new URL(process.env.DATABASE_URL ?? "postgres://127.0.0.1:5432/aihot").pathname.slice(1));
if (!/(?:_test|_ci)$/.test(database)) throw new Error(`Refusing to import evaluation data into non-test database: ${database}`);

const raw = await readFile(path.resolve(file));
const text = file.endsWith(".gz") ? gunzipSync(raw).toString("utf8") : raw.toString("utf8");
const snapshot = SnapshotSchema.parse(JSON.parse(text));
try {
  await sql.begin(async (tx) => {
    for (const item of snapshot.items) {
      const sourceId = `eval-${sha256(item.source.name).slice(0, 20)}`;
      await tx`
        INSERT INTO sources (id, name, kind, tier, participation_mode, site_fulltext, syndicate_fulltext)
        VALUES (${sourceId}, ${item.source.name}, 'external', 'T2', 'editorial', false, false)
        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`;
      const publishedAt = item.publishedAt ? new Date(item.publishedAt) : null;
      const discoveredAt = new Date(item.discoveredAt);
      const timelineAt = new Date(item.timelineAt);
      await tx`
        INSERT INTO articles (id, source_id, identity_key, url, title, published_at, published_at_claim,
          discovered_at, timeline_at, body_text, body_status, raw)
        VALUES (${item.id}, ${sourceId}, ${`eval:${item.id}`}, ${item.links.original}, ${item.originalTitle ?? item.title},
          ${publishedAt}, ${publishedAt}, ${discoveredAt}, ${timelineAt}, ${item.summary}, 'ok',
          ${tx.json({ evalSnapshot: snapshot.source, fetchedAt: snapshot.fetchedAt } as never)})
        ON CONFLICT (id) DO NOTHING`;
      const searchText = `${item.title} ${item.originalTitle ?? ""} ${item.summary ?? ""}`.normalize("NFKC").toLowerCase();
      await tx`
        INSERT INTO publications (article_id, revision, visibility, eligible, selected, title, original_title,
          summary, reason, category, score, source_id, channel, first_party, url, published_at, discovered_at,
          timeline_at, sort_at, visible_after, body_mode, indexable, search_text, seat)
        VALUES (${item.id}, 1, 'public', true, ${item.selected}, ${item.title}, ${item.originalTitle ?? null},
          ${item.summary}, ${item.reason}, ${item.category}, ${item.score}, ${sourceId}, 'news', false,
          ${item.links.original}, ${publishedAt}, ${discoveredAt}, ${timelineAt}, ${timelineAt}, ${timelineAt},
          'summary', false, ${searchText}, true)
        ON CONFLICT (article_id) DO UPDATE SET
          selected = EXCLUDED.selected, title = EXCLUDED.title, original_title = EXCLUDED.original_title,
          summary = EXCLUDED.summary, reason = EXCLUDED.reason, category = EXCLUDED.category,
          score = EXCLUDED.score, timeline_at = EXCLUDED.timeline_at, sort_at = EXCLUDED.sort_at,
          visible_after = EXCLUDED.visible_after, search_text = EXCLUDED.search_text`;
      await tx`
        INSERT INTO pool_search (article_id, direct, body)
        VALUES (${item.id}, ${searchText}, ${item.summary ?? ""})
        ON CONFLICT (article_id) DO UPDATE SET direct = EXCLUDED.direct, body = EXCLUDED.body`;
    }
  });
  console.log(`Imported ${snapshot.items.length} public evaluation items into ${database}.`);
} finally {
  await closeDb();
}
