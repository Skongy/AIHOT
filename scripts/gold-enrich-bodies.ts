// Fill gold JSONL bodies from article URLs (Readability fetch, then optional Jina via extractFromUrl).
// Does not change industry/selection.ts. .data/ outputs stay local (not committed).
//
// Usage:
//   node --env-file=.env scripts/gold-enrich-bodies.ts --in .data/gold.jsonl --out .data/gold.jsonl
//   node --env-file=.env scripts/gold-enrich-bodies.ts --from-sample /path/to/calibration-sample.json --out .data/gold.jsonl
//
// Optional: --min-chars 80 (skip enrich when body already long enough), --force (re-fetch anyway),
// --no-jina (Readability only; no DB/Jina).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { REPO_ROOT } from "@aihot/backend/config";
import { closeDb } from "@aihot/backend/db";
import { extractFromUrl, readable } from "@aihot/backend/content/extract";
import { guardedFetch } from "@aihot/backend/lib/http-fetch";

const { values } = parseArgs({
  options: {
    in: { type: "string" },
    out: { type: "string", default: ".data/gold.jsonl" },
    "from-sample": { type: "string" },
    "min-chars": { type: "string", default: "80" },
    force: { type: "boolean", default: false },
    "no-jina": { type: "boolean", default: false },
  },
});

if (!values.in && !values["from-sample"]) {
  throw new Error("pass --in .data/gold.jsonl and/or --from-sample calibration-sample.json");
}

const minChars = Number(values["min-chars"]);
if (!Number.isFinite(minChars) || minChars < 0) throw new Error("--min-chars must be a non-negative number");

interface GoldRow {
  caseId: string;
  material: {
    title: string;
    originalTitle: string | null;
    publishedAt: string | null;
    sourceName: string;
    bodyZh: string | null;
    bodyOriginal: string | null;
    sourceUrl?: string | null;
  };
  sourceFacts: { sourceKind: string; sourceTier?: string; firstParty?: boolean; language?: string | null };
  samplingContext?: { benchmarkSplit?: string; samplingStratum?: string };
  gold: { decision: "select" | "reject" | "either"; note?: string };
}

function bodyLen(r: GoldRow): number {
  return (r.material.bodyOriginal || r.material.bodyZh || "").trim().length;
}

function fromSample(file: string): GoldRow[] {
  const raw = JSON.parse(readFileSync(file, "utf8")) as {
    items: Array<{
      caseId: string;
      title: string;
      source: string;
      url: string;
      publishedAt?: string | null;
      draftLabel?: { decision?: string; category?: string | null; why?: string };
      sourceTier?: string;
    }>;
  };
  return (raw.items ?? []).map((it) => {
    const decision = (it.draftLabel?.decision === "select" || it.draftLabel?.decision === "reject" || it.draftLabel?.decision === "either")
      ? it.draftLabel.decision
      : "either";
    return {
      caseId: it.caseId,
      material: {
        title: it.title,
        originalTitle: null,
        publishedAt: it.publishedAt ?? null,
        sourceName: it.source,
        bodyZh: null,
        bodyOriginal: null,
        sourceUrl: it.url,
      },
      sourceFacts: {
        sourceKind: "rss",
        sourceTier: it.sourceTier ?? "T2",
        firstParty: false,
        language: "zh",
      },
      samplingContext: {
        benchmarkSplit: "development",
        samplingStratum: it.draftLabel?.category ?? "unknown",
      },
      gold: { decision, note: it.draftLabel?.why },
    } satisfies GoldRow;
  });
}

function readGold(file: string): GoldRow[] {
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.trim() && !l.trim().startsWith("//"))
    .map((l) => JSON.parse(l) as GoldRow);
}

async function fetchBody(url: string, caseId: string): Promise<{ text: string; via: string } | null> {
  try {
    const res = await guardedFetch(url, { timeoutMs: 20_000, maxBytes: 6 * 1024 * 1024 });
    const type = res.headers.get("content-type") ?? "";
    if (res.status === 200 && /html/.test(type)) {
      const got = readable(res.text(), res.url);
      if (got?.text?.trim()) return { text: got.text.trim(), via: "readability" };
    }
  } catch (error) {
    console.warn(`readability failed ${caseId}: ${String(error).slice(0, 120)}`);
  }
  if (values["no-jina"]) return null;
  try {
    const got = await extractFromUrl(url, `gold:${caseId}`);
    if (got?.text?.trim()) return { text: got.text.trim(), via: got.via };
  } catch (error) {
    console.warn(`jina/extract failed ${caseId}: ${String(error).slice(0, 120)}`);
  }
  return null;
}

const rows: GoldRow[] = [];
if (values["from-sample"]) rows.push(...fromSample(path.resolve(values["from-sample"])));
if (values.in) {
  const existing = readGold(path.resolve(REPO_ROOT, values.in));
  if (values["from-sample"]) {
    const byId = new Map(rows.map((r) => [r.caseId, r]));
    for (const r of existing) byId.set(r.caseId, { ...byId.get(r.caseId), ...r, material: { ...byId.get(r.caseId)?.material, ...r.material } });
    rows.length = 0;
    rows.push(...byId.values());
  } else {
    rows.push(...existing);
  }
}

let enriched = 0, skipped = 0, failed = 0;
for (const r of rows) {
  const url = r.material.sourceUrl?.trim();
  if (!url) { skipped++; continue; }
  if (!values.force && bodyLen(r) >= minChars) { skipped++; continue; }
  const got = await fetchBody(url, r.caseId);
  if (!got) { failed++; console.warn(`no body for ${r.caseId} ${url}`); continue; }
  const lang = r.sourceFacts.language ?? "zh";
  if (lang === "zh" || /[\u4e00-\u9fff]/.test(got.text)) r.material.bodyZh = got.text;
  else r.material.bodyOriginal = got.text;
  enriched++;
  console.log(`ok ${r.caseId} via=${got.via} chars=${got.text.length}`);
}

const outPath = path.resolve(REPO_ROOT, values.out!);
mkdirSync(path.dirname(outPath), { recursive: true });
writeFileSync(outPath, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
console.log(JSON.stringify({ out: outPath, n: rows.length, enriched, skipped, failed }));
await closeDb();
