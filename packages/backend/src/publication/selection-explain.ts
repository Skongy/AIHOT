// Reader-facing selection / hot explainability. Curated fields only — never receipts, model ids, or prefilter dumps.
import { SELECTION } from "@aihot/industry/selection";
import type { SelectionExplain, SelectionHint, ScoreAxesView } from "@aihot/contracts/site";
import { sql } from "../db.ts";
import { independentEvidenceKey } from "../content/wire.ts";

export const SOURCE_TIER_LABELS: Record<string, string> = {
  T1: "官方一手",
  T1_5: "准官方",
  T2: "媒体与个人",
};

export const AXIS_LABELS: Record<keyof ScoreAxesView, string> = {
  sig: "实质份量",
  nov: "信息增量",
  cred: "证据强度",
  reson: "共振面",
  act: "可用性",
};

export const CONTENT_TYPE_LABELS: Record<string, string> = {
  game_reveal: "首曝 / 新作",
  game_launch: "定档 / 上线",
  version_update: "版本更新",
  esports_event: "电竞",
  industry_event: "厂商与政策",
  review_or_data: "评测与数据",
  opinion_discussion: "观点与讨论",
};

function parseAxes(raw: unknown): ScoreAxesView | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const keys = ["sig", "nov", "cred", "reson", "act"] as const;
  const out = {} as ScoreAxesView;
  for (const k of keys) {
    const n = Number(o[k]);
    if (!Number.isFinite(n) || n < 0 || n > 10) return null;
    out[k] = Math.floor(n);
  }
  return out;
}

/** Pure assemble for tests and callers that already loaded analysis output + tier + wire peers. */
export function buildSelectionExplain(input: {
  score: number | null;
  selected: boolean;
  threshold: number | null;
  sourceTier: string | null;
  axes?: unknown;
  contentType?: string | null;
  wirePeerCount?: number;
}): SelectionExplain | null {
  const threshold =
    input.threshold ??
    (input.sourceTier && input.sourceTier in SELECTION.thresholds
      ? SELECTION.thresholds[input.sourceTier]!
      : null);
  const score = input.score === null || input.score === undefined ? null : Math.round(Number(input.score));
  if (score === null && threshold === null && !input.selected) return null;

  const tier = input.sourceTier && input.sourceTier in SOURCE_TIER_LABELS ? input.sourceTier : input.sourceTier;
  const axes = parseAxes(input.axes);
  const contentType = input.contentType && input.contentType in CONTENT_TYPE_LABELS ? input.contentType : null;
  const peers = Math.max(0, Math.floor(input.wirePeerCount ?? 0));
  const metThreshold =
    score !== null && threshold !== null ? score >= threshold : input.selected ? true : null;

  return {
    score,
    threshold,
    metThreshold,
    sourceTier: tier,
    sourceTierLabel: tier ? (SOURCE_TIER_LABELS[tier] ?? tier) : null,
    axes,
    contentType,
    contentTypeLabel: contentType ? CONTENT_TYPE_LABELS[contentType]! : null,
    wireDedupe:
      peers > 0
        ? {
            peerCount: peers,
            note: `另有 ${peers} 篇近重复通稿在热点计数中合并为同一参与方`,
          }
        : null,
  };
}

export function buildSelectionHint(input: {
  score: number | null;
  selected: boolean;
  sourceTier: string | null;
  threshold?: number | null;
}): SelectionHint | null {
  if (!input.selected && input.score === null) return null;
  const threshold =
    input.threshold ??
    (input.sourceTier && input.sourceTier in SELECTION.thresholds
      ? SELECTION.thresholds[input.sourceTier]!
      : null);
  if (input.score === null && threshold === null) return null;
  const tier = input.sourceTier;
  return {
    score: input.score === null ? null : Math.round(Number(input.score)),
    threshold,
    sourceTier: tier,
    sourceTierLabel: tier ? (SOURCE_TIER_LABELS[tier] ?? tier) : null,
  };
}

/** Wire peers on the same story (or any publication if ungrouped) sharing this article's fingerprint. */
export async function countWirePeers(articleId: string, storyId: number | null, fingerprint: string | null): Promise<number> {
  if (!fingerprint) return 0;
  if (storyId) {
    const [row] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n
      FROM publications p JOIN articles a ON a.id = p.article_id
      WHERE p.story_id = ${storyId} AND a.wire_fingerprint = ${fingerprint} AND p.article_id <> ${articleId}`;
    return row?.n ?? 0;
  }
  const [row] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM articles a
    WHERE a.wire_fingerprint = ${fingerprint} AND a.id <> ${articleId}`;
  return row?.n ?? 0;
}

/** Independent editorial coverage keys for a story's listed reports (wire copies collapse). */
export function independentSourceCount(
  reports: Array<{ source_id: string; wire_fingerprint?: string | null }>,
): { sourceCount: number; reportCount: number; collapsedExtra: number } {
  const keys = new Set(reports.map((r) => independentEvidenceKey(r.source_id, r.wire_fingerprint)));
  const reportCount = reports.length;
  const sourceCount = keys.size;
  return { sourceCount, reportCount, collapsedExtra: Math.max(0, reportCount - sourceCount) };
}

export function wireDedupeNoteForStory(collapsedExtra: number, reportCount: number, independentCount: number): string | null {
  if (collapsedExtra <= 0) return null;
  return `通稿近重复已合并：${reportCount} 篇报道计为 ${independentCount} 个独立参与方`;
}
