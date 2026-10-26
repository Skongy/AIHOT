// Explicit operator command; no automatic import/deployment hook. Public cached responses are optional.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { sql, closeDb } from "@aihot/backend/db";
import { catalog, history, ingestHistory, remember, explainPending } from "../backend/collect.ts";
import { appSchema } from "../backend/steam.ts";
if (process.env.COLLECT_ENABLED !== "true") throw new Error("Backfill requires COLLECT_ENABLED=true");
const cache = process.argv.find(a => a.startsWith("--cache="))?.slice(8);
const limit = Math.min(500, Math.max(1, Number(process.argv.find(a => a.startsWith("--limit="))?.slice(8) ?? 500)));
if (!Number.isInteger(limit)) throw new Error("Invalid limit");
const failures: Array<{ appid: number; error: string }> = [];
try {
  if (cache) {
    for (let page = 0; page < 5; page++) {
      const capture = JSON.parse(await readFile(path.join(cache, `catalog-${page}.json`), "utf8"));
      if (capture.url !== `https://api.steamdata.dev/api/apps?per_page=100&page=${page}`) throw new Error("Unexpected catalog capture URL");
      for (const value of capture.data.apps) await remember(appSchema.parse(value), "steamdata-catalog");
    }
  } else await catalog();
  const games = await sql`SELECT appid FROM radar_games WHERE history_loaded_at IS NULL ORDER BY appid LIMIT ${limit}`;
  let processed = 0, added = 0;
  for (const game of games) {
    try {
      if (cache) {
        const capture = JSON.parse(await readFile(path.join(cache, `${game.appid}.json`), "utf8"));
        if (capture.url !== `https://api.steamdata.dev/api/apps/${game.appid}/history?range=30d` || !Number.isFinite(Date.parse(capture.at)) || Date.parse(capture.at) > Date.now() + 60000) throw new Error("Invalid historical capture provenance");
        added += await ingestHistory(game.appid, capture.data, capture.at);
      } else added += await history(game.appid);
      processed++;
      if (processed % 25 === 0) console.log(JSON.stringify({ processed, added, failed: failures.length }));
    } catch (error) { failures.push({ appid: game.appid, error: String(error).slice(0, 200) }); }
  }
  // Analysis follows persisted events; no artificial explanations if evidence is missing.
  if (process.argv.includes("--explain")) await explainPending(20);
  const totals = await sql`SELECT event_day::text, status, count(*)::int FROM radar_events GROUP BY event_day, status ORDER BY event_day`;
  console.log(JSON.stringify({ processed, added, failures, totals }));
  if (failures.length) process.exitCode = 1;
} finally { await closeDb(); }
