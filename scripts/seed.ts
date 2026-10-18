// Seeds a fresh site from the industry pack. Existing sources stay untouched unless their definition
// explicitly raises seed_revision; that applies an intentional pack update once without undoing later
// admin edits on every deployment. Topics need no seeding: they are read from industry/topics.json.
// Re-runnable:  node --env-file=.env scripts/seed.ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "@aihot/backend/config";
import { closeDb, sql } from "@aihot/backend/db";
import { assertSupportedConfig } from "@aihot/backend/sources/config-keys";

interface SeedSource {
  id: string;
  name: string;
  kind: "rss" | "web_list" | "json_list" | "x_search" | "mp_account" | "external";
  config: Record<string, unknown>;
  tier?: string;
  owner_entity_id?: string | null;
  participation_mode?: string;
  interval_minutes?: number;
  tags?: string[];
  site_fulltext?: boolean;
  syndicate_fulltext?: boolean;
  enabled?: boolean;
  seed_revision?: number;
}

const { sources } = JSON.parse(readFileSync(path.join(REPO_ROOT, "industry/sources.json"), "utf8")) as { sources: SeedSource[] };
let applied = 0;
for (const s of sources) {
  assertSupportedConfig(s.kind, s.config);
  if (s.seed_revision !== undefined && (!Number.isInteger(s.seed_revision) || s.seed_revision < 1)) {
    throw new Error(`${s.id}: seed_revision must be a positive integer`);
  }
  const tier = s.tier ?? "T2";
  const enabled = s.enabled ?? true;
  const managedRevision = s.seed_revision === undefined ? null : `industry:${s.seed_revision}`;
  // First-party means a T1 source, as the admin sets it.
  const changed = await sql`
    INSERT INTO sources (id, name, kind, config, tier, first_party, owner_entity_id, participation_mode, interval_minutes, tags, site_fulltext, syndicate_fulltext, enabled, health, next_fetch_at, imported_from)
    VALUES (${s.id}, ${s.name}, ${s.kind}, ${sql.json(s.config as never)}, ${tier}, ${tier === "T1"}, ${s.owner_entity_id ?? null},
            ${s.participation_mode ?? "editorial"}, ${s.interval_minutes ?? 60}, ${s.tags ?? []}, ${s.site_fulltext ?? false}, ${s.syndicate_fulltext ?? false},
            ${enabled}, ${enabled ? "unknown" : "paused"}, now(), ${managedRevision})
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name, kind = EXCLUDED.kind, config = EXCLUDED.config, tier = EXCLUDED.tier,
      first_party = EXCLUDED.first_party, owner_entity_id = EXCLUDED.owner_entity_id,
      participation_mode = EXCLUDED.participation_mode, interval_minutes = EXCLUDED.interval_minutes,
      tags = EXCLUDED.tags, site_fulltext = EXCLUDED.site_fulltext,
      syndicate_fulltext = EXCLUDED.syndicate_fulltext, enabled = EXCLUDED.enabled,
      health = CASE WHEN NOT EXCLUDED.enabled THEN 'paused' WHEN NOT sources.enabled THEN 'unknown' ELSE sources.health END,
      fail_count = CASE WHEN EXCLUDED.enabled AND NOT sources.enabled THEN 0 ELSE sources.fail_count END,
      last_error = CASE WHEN EXCLUDED.enabled AND NOT sources.enabled THEN NULL ELSE sources.last_error END,
      next_fetch_at = CASE WHEN EXCLUDED.enabled THEN now() ELSE sources.next_fetch_at END,
      imported_from = EXCLUDED.imported_from, updated_at = now()
    WHERE EXCLUDED.imported_from IS NOT NULL AND (
      sources.imported_from IS NULL OR sources.imported_from !~ '^industry:[0-9]+$'
      OR split_part(sources.imported_from, ':', 2)::integer < split_part(EXCLUDED.imported_from, ':', 2)::integer
    )
    RETURNING id`;
  applied += changed.length;
}
console.log(`sources: ${applied} inserted or revision-updated, ${sources.length - applied} unchanged`);
await closeDb();
