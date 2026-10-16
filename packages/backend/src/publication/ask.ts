// Ask reads the same public projection and visibility predicates as every other outlet.
import type { PublicApiCategoryKey } from "@aihot/contracts/taxonomy";
import { sql, type Db } from "../db.ts";
import { decodeCursor, encodeCursor, InvalidCursorError, queryBinding } from "../lib/cursor.ts";
import { API_ITEM_COLUMNS, API_ITEM_FROM, publicCategoryCondition, type ApiItemRow } from "./items.ts";
import { publicMatchCondition, searchTerms, withSearchCapacity } from "./pool.ts";
import { listedCondition, seatedCondition } from "./scope.ts";
import { rowToV1 } from "./v1.ts";

export interface AskItemsQuery {
  queries: string[]; mode: "selected" | "all"; category?: PublicApiCategoryKey;
  from: Date | null; until: Date; limit: number; cursor?: string;
  /** Original range arguments, so a next page can keep the first page's clock. */
  rangeKey: string;
}

export async function askItems(query: AskItemsQuery, now = new Date()) {
  const binding = queryBinding({ queries: query.queries, mode: query.mode, category: query.category ?? null, range: query.rangeKey });
  let from = query.from;
  let until = query.until;
  let before: { at: Date; id: string } | null = null;
  if (query.cursor) {
    const c = decodeCursor<{ key: string; from: string | null; until: string; at: string; id: string }>("ask1", query.cursor);
    if (c.key !== binding || (c.from !== null && !Number.isFinite(Date.parse(c.from))) || !Number.isFinite(Date.parse(c.until))
      || !Number.isFinite(Date.parse(c.at)) || typeof c.id !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(c.id)) throw new InvalidCursorError("游标与查询不匹配。");
    from = c.from === null ? null : new Date(c.from);
    until = new Date(c.until);
    before = { at: new Date(c.at), id: c.id };
  }
  const sort = query.mode === "selected" ? sql`p.sort_at` : sql`p.timeline_at`;
  const scope = query.mode === "selected" ? seatedCondition(now) : listedCondition(now);
  const alternatives = query.queries.map((q) => sql`(TRUE ${publicMatchCondition(searchTerms(q))})`);
  const match = alternatives.length ? sql`AND (${alternatives.reduce((a, b) => sql`${a} OR ${b}`)})` : sql``;
  const run = async (db: Db) => db<(ApiItemRow & { sort_at: Date; first_party: boolean })[]>`
    SELECT ${API_ITEM_COLUMNS}, ${sort} AS sort_at, p.first_party ${API_ITEM_FROM}
    WHERE ${scope} ${publicCategoryCondition(query.category)} ${match}
      ${from ? sql`AND ${sort} >= ${from}` : sql``} AND ${sort} < ${until}
      ${before ? sql`AND (${sort}, p.article_id) < (${before.at}, ${before.id})` : sql``}
    ORDER BY ${sort} DESC, p.article_id DESC LIMIT ${query.limit + 1}`;
  const rows = query.queries.length ? await withSearchCapacity(run) : await run(sql);
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    items: page.map((row) => ({ ...rowToV1(row), timelineAt: row.sort_at.toISOString(), firstParty: row.first_party })),
    from: from?.toISOString() ?? null, until: until.toISOString(),
    nextCursor: rows.length > query.limit && last ? encodeCursor("ask1", {
      key: binding, from: from?.toISOString() ?? null, until: until.toISOString(), at: last.sort_at.toISOString(), id: last.id,
    }) : null,
  };
}
