// Ask reads the same public projection and visibility predicates as every other outlet.
import type { PublicApiCategoryKey } from "@aihot/contracts/taxonomy";
import { ENTITIES } from "@aihot/industry/taxonomy";
import { sql, type Db } from "../db.ts";
import { decodeCursor, encodeCursor, InvalidCursorError, queryBinding } from "../lib/cursor.ts";
import { sha256 } from "../lib/ids.ts";
import { EMBEDDING_MODEL, embedQuery, embeddingsAvailable } from "../providers/embeddings.ts";
import { API_ITEM_COLUMNS, API_ITEM_FROM, publicCategoryCondition, type ApiItemRow } from "./items.ts";
import { searchTerms, withSearchCapacity } from "./pool.ts";
import { listedCondition, seatedCondition } from "./scope.ts";
import { rowToV1 } from "./v1.ts";

export type AskSearchEngine = "keyword-v1" | "hybrid-v1";

export interface AskItemsQuery {
  queries: string[]; mode: "selected" | "all"; category?: PublicApiCategoryKey;
  from: Date | null; until: Date; limit: number; cursor?: string;
  /** Original range arguments, so a next page can keep the first page's clock. */
  rangeKey: string;
  /** Keyword remains the public-layer default; the Ask worker opts into bounded hybrid retrieval. */
  engine?: AskSearchEngine;
  firstParty?: boolean;
  source?: string;
}

export interface AskRetrievalMeta {
  requested: AskSearchEngine;
  used: "keyword-v1" | "hybrid-embedding-v1" | "hybrid-mixed-v1" | "hybrid-lexical-v1";
  keywordCandidates: number;
  semanticCandidates: number;
  vectorCandidates: number;
  embeddingReceiptId: number | null;
  embeddingReused: boolean;
  fallbackReason: string | null;
}

type AskRow = ApiItemRow & { sort_at: Date; first_party: boolean };
type HybridRow = AskRow & { embedding: number[] | null; embedding_hash: string | null };

const HYBRID_POOL_LIMIT = 300;
const HYBRID_KEYWORD_LIMIT = 60;
const HYBRID_RESULT_LIMIT = 120;
const RRF_K = 60;
const EMBEDDING_MIN = 0.3;
const LEXICAL_MIN = 0.3;

export function scopeFor(mode: AskItemsQuery["mode"], now: Date) {
  return mode === "selected" ? seatedCondition(now) : listedCondition(now);
}

// One query token and its aliases. Groups stay AND-ed, so a game name still has to match.
const ASK_TERM_ALIASES: readonly (readonly string[])[] = [
  ["联动", "联名"],
  ["宾利", "bentley"],
];

/** Whitespace terms, with a closed alias list OR-ed inside a single term. */
export function askSearchGroups(q: string): string[][] {
  return searchTerms(q).map((term) => {
    const aliases = ASK_TERM_ALIASES.find((group) => group.includes(term));
    return aliases ? [...aliases] : [term];
  });
}

function oneTerm(term: string) {
  return sql`(p.search_text LIKE ${"%" + term + "%"} OR EXISTS (
      SELECT 1 FROM pool_search ps WHERE ps.article_id = p.article_id AND ps.body LIKE ${"%" + term + "%"} OFFSET 0))`;
}

function askMatchCondition(groups: string[][]) {
  return groups.reduce((acc, group) => {
    const any = group.map(oneTerm).reduce((left, right) => sql`${left} OR ${right}`);
    return sql`${acc} AND (${any})`;
  }, sql``);
}

export function matchFor(queries: string[]) {
  const alternatives = queries.map((q) => sql`(TRUE ${askMatchCondition(askSearchGroups(q))})`);
  return alternatives.length ? sql`AND (${alternatives.reduce((a, b) => sql`${a} OR ${b}`)})` : sql``;
}

export function askSourceFilter(query: Pick<AskItemsQuery, "firstParty" | "source">) {
  return sql`${query.firstParty === undefined ? sql`` : sql`AND p.first_party = ${query.firstParty}`}
    ${query.source ? sql`AND p.source_id IN (SELECT id FROM sources WHERE name = ${query.source})` : sql``}`;
}

function reportText(title: string, summary: string | null | undefined): string {
  return `${title}。${(summary ?? "").slice(0, 300)}`;
}

function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** Character-bigram fallback keeps retrieval useful when the paid embedding service is unavailable. */
function lexicalSimilarity(a: string, b: string): number {
  const grams = (value: string) => {
    const chars = [...value.normalize("NFKC").toLowerCase().replace(/\s+/g, "")];
    return new Set(chars.map((_char, index) => chars.slice(index, index + 2).join("")).filter((gram) => gram.length === 2));
  };
  const left = grams(a), right = grams(b);
  if (!left.size || !right.size) return 0;
  let overlap = 0;
  for (const gram of left) if (right.has(gram)) overlap += 1;
  return overlap / Math.min(left.size, right.size);
}

const normalized = (value: string) => value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();

/** Named-game queries never broaden into another game merely because generic update wording is similar. */
function semanticAnchor(query: string): (text: string) => boolean {
  const want = normalized(query);
  for (const entity of Object.values(ENTITIES)) {
    const aliases = [...new Set([entity.name, ...entity.aliases, ...(entity.otherNames ?? [])].map(normalized))];
    if (aliases.some((alias) => alias.length >= 2 && want.includes(alias))) {
      return (text) => aliases.some((alias) => normalized(text).includes(alias));
    }
  }
  const stop = new Set(["the", "who", "won", "with", "from", "game", "games", "update", "version"]);
  const latin = want.match(/[a-z][a-z0-9.-]{2,}/g)?.find((token) => !stop.has(token));
  return latin ? (text) => normalized(text).includes(latin) : () => true;
}

async function keywordRows(db: Db, query: AskItemsQuery, now: Date, from: Date | null, until: Date, limit: number, before: { at: Date; id: string } | null) {
  const sort = sql`p.timeline_at`;
  return db<AskRow[]>`
    SELECT ${API_ITEM_COLUMNS}, ${sort} AS sort_at, p.first_party ${API_ITEM_FROM}
    WHERE ${scopeFor(query.mode, now)} ${publicCategoryCondition(query.category)} ${matchFor(query.queries)} ${askSourceFilter(query)}
      ${from ? sql`AND ${sort} >= ${from}` : sql``} AND ${sort} < ${until}
      ${before ? sql`AND (${sort}, p.article_id) < (${before.at}, ${before.id})` : sql``}
    ORDER BY ${sort} DESC, p.article_id DESC LIMIT ${limit}`;
}

async function keywordPage(query: AskItemsQuery, now: Date) {
  const binding = queryBinding({ queries: query.queries, mode: query.mode, category: query.category ?? null, firstParty: query.firstParty ?? null, source: query.source ?? null, range: query.rangeKey });
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
  const run = (db: Db) => keywordRows(db, query, now, from, until, query.limit + 1, before);
  const rows = query.queries.length ? await withSearchCapacity(run) : await run(sql);
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    items: page.map((row) => ({ ...rowToV1(row), timelineAt: row.sort_at.toISOString(), firstParty: row.first_party })),
    from: from?.toISOString() ?? null, until: until.toISOString(),
    nextCursor: rows.length > query.limit && last ? encodeCursor("ask1", {
      key: binding, from: from?.toISOString() ?? null, until: until.toISOString(), at: last.sort_at.toISOString(), id: last.id,
    }) : null,
    retrieval: {
      requested: query.engine ?? "keyword-v1", used: "keyword-v1", keywordCandidates: page.length,
      semanticCandidates: 0, vectorCandidates: 0, embeddingReceiptId: null, embeddingReused: false,
      fallbackReason: query.engine === "hybrid-v1" ? "hybrid_not_applicable" : null,
    } satisfies AskRetrievalMeta,
  };
}

async function hybridPage(query: AskItemsQuery, now: Date) {
  const binding = queryBinding({ queries: query.queries, mode: query.mode, category: query.category ?? null, firstParty: query.firstParty ?? null, source: query.source ?? null, range: query.rangeKey, engine: "hybrid-v1", pageSize: query.limit });
  let from = query.from;
  let until = query.until;
  let offset = 0;
  if (query.cursor) {
    const c = decodeCursor<{ key: string; from: string | null; until: string; offset: number }>("ask2", query.cursor);
    if (c.key !== binding || (c.from !== null && !Number.isFinite(Date.parse(c.from))) || !Number.isFinite(Date.parse(c.until))
      || !Number.isInteger(c.offset) || c.offset < 0 || c.offset > HYBRID_RESULT_LIMIT) throw new InvalidCursorError("游标与查询不匹配。");
    from = c.from === null ? null : new Date(c.from);
    until = new Date(c.until);
    offset = c.offset;
  }

  const sort = sql`p.timeline_at`;
  const [keyword, pool] = await withSearchCapacity(async (db) => Promise.all([
    keywordRows(db, query, now, from, until, HYBRID_KEYWORD_LIMIT, null),
    db<HybridRow[]>`
      SELECT ${API_ITEM_COLUMNS}, ${sort} AS sort_at, p.first_party,
        e.vector AS embedding, e.text_hash AS embedding_hash ${API_ITEM_FROM}
      LEFT JOIN embeddings e ON e.kind = 'article' AND e.ref_id = p.article_id AND e.model = ${EMBEDDING_MODEL}
      WHERE ${scopeFor(query.mode, now)} ${publicCategoryCondition(query.category)} ${askSourceFilter(query)}
        ${from ? sql`AND ${sort} >= ${from}` : sql``} AND ${sort} < ${until}
      ORDER BY ${sort} DESC, p.article_id DESC LIMIT ${HYBRID_POOL_LIMIT}`,
  ]));

  const queryText = query.queries[0] ?? "";
  const currentVectors = pool.filter((row) => {
    if (!row.embedding || !row.embedding_hash) return false;
    return row.embedding_hash === sha256(reportText(row.title, row.summary));
  });
  let queryVector: number[] | null = null;
  let embeddingReceiptId: number | null = null;
  let embeddingReused = false;
  let fallbackReason: string | null = null;
  if (!embeddingsAvailable()) fallbackReason = "embeddings_unavailable";
  else if (!currentVectors.length) fallbackReason = "no_current_article_vectors";
  else {
    try {
      const embedded = await embedQuery(queryText);
      queryVector = embedded.vector;
      embeddingReceiptId = embedded.receiptId;
      embeddingReused = embedded.reused;
    } catch (error) {
      fallbackReason = `embedding_failed:${error instanceof Error ? error.name : "unknown"}`;
    }
  }

  const vectors = new Map(currentVectors.map((row) => [row.id, row.embedding!]));
  const anchored = semanticAnchor(queryText);
  const semantic = pool.flatMap((row) => {
    if (!anchored(reportText(row.title, row.summary))) return [];
    const vector = vectors.get(row.id);
    const mode = queryVector && vector ? "embedding" as const : "lexical" as const;
    const score = mode === "embedding" ? cosine(queryVector!, vector!) : lexicalSimilarity(queryText, reportText(row.title, row.summary));
    const minimum = mode === "embedding" ? EMBEDDING_MIN : LEXICAL_MIN;
    return score >= minimum ? [{ row, score, mode }] : [];
  }).sort((a, b) => b.score - a.score || b.row.sort_at.getTime() - a.row.sort_at.getTime() || b.row.id.localeCompare(a.row.id))
    .slice(0, HYBRID_KEYWORD_LIMIT);

  const byId = new Map<string, { row: AskRow; score: number }>();
  keyword.forEach((row, index) => byId.set(row.id, { row, score: 1 / (RRF_K + index + 1) }));
  semantic.forEach(({ row }, index) => {
    const previous = byId.get(row.id);
    const score = (previous?.score ?? 0) + 0.7 / (RRF_K + index + 1);
    byId.set(row.id, { row, score });
  });
  const ranked = [...byId.values()]
    .sort((a, b) => b.score - a.score || b.row.sort_at.getTime() - a.row.sort_at.getTime() || b.row.id.localeCompare(a.row.id))
    .slice(0, HYBRID_RESULT_LIMIT);
  const page = ranked.slice(offset, offset + query.limit).map(({ row }) => row);
  const nextOffset = offset + page.length;
  const vectorCandidates = currentVectors.length;
  const used: AskRetrievalMeta["used"] = queryVector
    ? (vectorCandidates === pool.length ? "hybrid-embedding-v1" : "hybrid-mixed-v1")
    : "hybrid-lexical-v1";
  return {
    items: page.map((row) => ({ ...rowToV1(row), timelineAt: row.sort_at.toISOString(), firstParty: row.first_party })),
    from: from?.toISOString() ?? null, until: until.toISOString(),
    nextCursor: nextOffset < ranked.length ? encodeCursor("ask2", {
      key: binding, from: from?.toISOString() ?? null, until: until.toISOString(), offset: nextOffset,
    }) : null,
    retrieval: {
      requested: "hybrid-v1", used, keywordCandidates: keyword.length, semanticCandidates: semantic.length,
      vectorCandidates, embeddingReceiptId, embeddingReused, fallbackReason,
    } satisfies AskRetrievalMeta,
  };
}

export async function askItems(query: AskItemsQuery, now = new Date()) {
  if ((query.engine ?? "keyword-v1") === "hybrid-v1" && query.queries.length) return hybridPage(query, now);
  return keywordPage(query, now);
}
