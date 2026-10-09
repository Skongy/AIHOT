// How widely a fact was reported: independent editorial evidence keys (wire copies collapse) by a
// cutoff, as the daily's "另有 N 家信源报道" counts it.
import { sql } from "../db.ts";
import { evidenceCondition, listedCondition } from "./scope.ts";

/** The editorial sources that reported each fact by the cutoff. */
export async function factSources(factIds: number[], end: Date): Promise<Map<number, string[]>> {
  if (factIds.length === 0) return new Map();
  const rows = await sql<{ fact_id: number; sources: string[] }[]>`
    SELECT fa.fact_id, array_agg(DISTINCT CASE
        WHEN a.wire_fingerprint IS NOT NULL THEN 'wire:' || a.wire_fingerprint
        ELSE 'source:' || p.source_id
      END) AS sources
    FROM fact_articles fa JOIN publications p ON p.article_id = fa.article_id JOIN sources s ON s.id = p.source_id
    JOIN articles a ON a.id = p.article_id
    WHERE fa.fact_id = ANY(${factIds}::bigint[]) AND ${evidenceCondition()} AND ${listedCondition(end)}
      AND s.participation_mode = 'editorial' AND p.timeline_at < ${end}
    GROUP BY fa.fact_id`;
  return new Map(rows.map((r) => [r.fact_id, r.sources]));
}
