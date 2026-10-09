// Wire-copy identity: near-duplicate syndicated articles (通稿) share one independent participant
// for heat and multi-source evidence. Fingerprints are stored on articles.wire_fingerprint;
// events/hot.ts currentSignals prefers them over source:id (after owner / signal_group).
import { sha256 } from "../lib/ids.ts";
import { collapseWhitespace } from "../lib/text.ts";

const PREFIX_CHARS = 400;
const MIN_CORE_CHARS = 24;
/** Character-bigram Jaccard on the normalized title+body prefix; high bar for near-verbatim copies. */
export const WIRE_SIMILARITY_THRESHOLD = 0.88;

/** Strip URLs, punctuation and whitespace so lightly edited wire titles still match. */
export function normalizeWireText(text: string): string {
  return collapseWhitespace(text)
    .toLowerCase()
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/[\s\u3000]+/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function wireCore(title: string, body: string | null | undefined): string {
  const bodyPart = (body ?? "").slice(0, PREFIX_CHARS);
  return normalizeWireText(`${title}\n${bodyPart}`);
}

/** Stable fingerprint for exact (post-normalize) wire identity; null when the text is too thin. */
export function wireFingerprint(title: string, body: string | null | undefined): string | null {
  const core = wireCore(title, body);
  if (core.length < MIN_CORE_CHARS) return null;
  return sha256(core).slice(0, 32);
}

function bigrams(s: string): Set<string> {
  const out = new Set<string>();
  if (s.length < 2) {
    if (s) out.add(s);
    return out;
  }
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
  return out;
}

/** Jaccard similarity of character bigrams on the normalized wire core (0–1). */
export function wireSimilarity(
  aTitle: string, aBody: string | null | undefined,
  bTitle: string, bBody: string | null | undefined,
): number {
  const a = wireCore(aTitle, aBody);
  const b = wireCore(bTitle, bBody);
  if (a.length < MIN_CORE_CHARS || b.length < MIN_CORE_CHARS) return 0;
  if (a === b) return 1;
  const A = bigrams(a);
  const B = bigrams(b);
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}

export function areWireCopies(
  aTitle: string, aBody: string | null | undefined,
  bTitle: string, bBody: string | null | undefined,
  threshold = WIRE_SIMILARITY_THRESHOLD,
): boolean {
  return wireSimilarity(aTitle, aBody, bTitle, bBody) >= threshold;
}

/** Independent evidence key for heat / daily source counts (wire copies collapse). */
export function independentEvidenceKey(sourceId: string, fingerprint: string | null | undefined): string {
  return fingerprint ? `wire:${fingerprint}` : `source:${sourceId}`;
}
