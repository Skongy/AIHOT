// Explicit, idempotent operator command. Uses existing official chart samples; never calls a model.
import { parseArgs } from "node:util";
import { sql, closeDb } from "@aihot/backend/db";
import { metadata } from "../backend/collect.ts";
import { evaluateLaunch } from "../backend/launch.ts";
if (process.env.COLLECT_ENABLED !== "true") throw new Error("Launch reassessment requires COLLECT_ENABLED=true");
const { values } = parseArgs({ options: { appid: { type: "string" }, limit: { type: "string", default: "100" } } });
const limit = Number(values.limit), appid = values.appid === undefined ? null : Number(values.appid);
if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || (appid !== null && (!Number.isSafeInteger(appid) || appid < 1))) throw new Error("Invalid appid or limit");
const failures: Array<{ appid: number; error: string }> = [];
let processed = 0, added = 0;
try {
  const games = await sql`SELECT g.appid FROM radar_games g WHERE (${appid}::bigint IS NULL OR g.appid = ${appid})
    AND (g.app_type IS NULL OR g.release_day >= (now() AT TIME ZONE 'Asia/Shanghai')::date - 13)
    AND EXISTS (SELECT 1 FROM radar_samples s WHERE s.appid = g.appid AND s.source = 'steam-chart' AND s.observed_at > now() - interval '35 days')
    ORDER BY g.first_seen_at DESC, g.appid DESC LIMIT ${limit}`;
  for (const game of games) {
    try {
      await metadata(game.appid);
      const result = await evaluateLaunch(game.appid);
      added += result.added; processed++;
    } catch (error) { failures.push({ appid: game.appid, error: String(error).slice(0, 250) }); }
  }
  console.log(JSON.stringify({ processed, added, failures }));
  if (failures.length) process.exitCode = 1;
} finally { await closeDb(); }
