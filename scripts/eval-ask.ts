// Read-only Ask retrieval and replay evaluation. Keyword runs never call a model;
// hybrid runs may call the configured embedding provider through receipts and budget guards.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { closeDb } from "@aihot/backend/db";
import { parseAskEvalJsonl } from "../modules/ask/src/evals/core.ts";
import { askEvalMarkdown, evaluateAskDataset } from "../modules/ask/src/evals/runner.ts";

function valueOf(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

if (process.argv.includes("--help")) {
  console.log("Usage: npm run eval:ask -- --cases <gold.jsonl> [--engine keyword-v1|hybrid-v1] [--split development] [--out-dir <dir>]");
  process.exit(0);
}

const casesArg = valueOf("--cases");
if (!casesArg) throw new Error("Usage: npm run eval:ask -- --cases <gold.jsonl> [--engine keyword-v1|hybrid-v1] [--split development] [--out-dir <dir>]");
const casesFile = path.resolve(casesArg);
const split = valueOf("--split") ?? "all";
const engineArg = valueOf("--engine") ?? "keyword-v1";
if (engineArg !== "keyword-v1" && engineArg !== "hybrid-v1") throw new Error("--engine must be keyword-v1 or hybrid-v1");
const outDir = path.resolve(valueOf("--out-dir") ?? ".data/evals/ask");
const source = await readFile(casesFile, "utf8");
const rows = parseAskEvalJsonl(source);
const fingerprint = createHash("sha256").update(source).digest("hex");

try {
  const report = await evaluateAskDataset({ rows, dataset: path.relative(process.cwd(), casesFile), datasetSha256: fingerprint, split, engine: engineArg });
  const stamp = report.meta.createdAt.replace(/[:.]/g, "-");
  await mkdir(outDir, { recursive: true });
  const jsonFile = path.join(outDir, `ask-eval-${engineArg}-${stamp}.json`);
  const markdownFile = path.join(outDir, `ask-eval-${engineArg}-${stamp}.md`);
  await writeFile(jsonFile, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(markdownFile, askEvalMarkdown(report));
  console.log(askEvalMarkdown(report));
  console.log(`JSON: ${jsonFile}`);
  console.log(`Markdown: ${markdownFile}`);
} finally {
  await closeDb();
}
