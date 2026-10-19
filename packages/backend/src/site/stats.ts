// Figures for the about page: how much the site covers, counted from the public read layer and kept for
// five minutes per process (the page uses the same cache window); an older copy is served while the
// counts are read again, so no reader waits for the full-table counts.
import type { SiteStats } from "@aihot/contracts/site";
import { sql } from "../db.ts";
import { cached } from "../lib/cache.ts";
import { publicSourceName } from "../publication/rules.ts";
import { listedCondition, selectedCondition } from "../publication/scope.ts";

export type { SiteStats };

const stats = cached(() => querySiteStats(new Date()), { freshMs: 5 * 60_000, maxStaleMs: 60 * 60_000 });

export function loadSiteStats(): Promise<SiteStats> {
  return stats.get();
}

async function querySiteStats(now: Date): Promise<SiteStats> {
  const dayAgo = new Date(now.getTime() - 24 * 3600_000);
  const [[row], kinds, latest] = await Promise.all([
    sql<Array<Omit<SiteStats, "sourceKinds" | "day" | "latest"> & { collected: number; selectedDay: number }>>`
      SELECT (SELECT count(*) FROM sources WHERE enabled)::int AS sources,
             (SELECT count(*) FROM publications p WHERE p.visibility <> 'withdrawn')::int AS items,
             (SELECT count(*) FROM publications p WHERE ${selectedCondition(now)})::int AS selected,
             (SELECT count(*) FROM reports WHERE kind = 'daily')::int AS dailies,
             (SELECT count(*) FROM publications p WHERE p.visibility <> 'withdrawn' AND p.discovered_at > ${dayAgo})::int AS collected,
             (SELECT count(*) FROM publications p WHERE ${selectedCondition(now)} AND p.timeline_at > ${dayAgo})::int AS "selectedDay",
             (SELECT count(*) FROM stories st WHERE st.merged_into IS NULL AND st.latest_at > ${dayAgo}
                AND EXISTS (SELECT 1 FROM publications p WHERE p.story_id = st.id AND ${listedCondition(now)}))::int AS "formingEvents"`,
    sql<{ kind: string; n: number }[]>`SELECT kind, count(*)::int AS n FROM sources WHERE enabled GROUP BY kind ORDER BY kind`,
    sql<{ id: string; title: string; source: string; originalUrl: string }[]>`
      SELECT p.article_id AS id, p.title, s.name AS source, p.url AS "originalUrl"
      FROM publications p JOIN sources s ON s.id = p.source_id
      WHERE ${selectedCondition(now)} ORDER BY p.timeline_at DESC, p.article_id DESC LIMIT 8`,
  ]);
  const { collected, selectedDay, ...totals } = row!;
  const value: SiteStats = {
    ...totals,
    sourceKinds: Object.fromEntries(kinds.map((kind) => [kind.kind, kind.n])),
    day: { collected, selected: selectedDay },
    latest: latest.map((item) => ({ ...item, source: publicSourceName(item.source) })),
  };
  return value;
}
