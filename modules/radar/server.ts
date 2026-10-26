import { defineQueue, defineServerModule } from "@aihot/backend/modules";
import { enqueueOn, recordRun } from "@aihot/backend/jobs/queue";
import { sql } from "@aihot/backend/db";
import { loadRadarMonth } from "@aihot/backend/publication/radar";
import { catalog, history, live, explainPending, newsCandidates } from "./backend/collect.ts";
const enabled = () => process.env.COLLECT_ENABLED === "true";
interface Job { action: "live" | "catalog" | "history" | "explain"; appid?: number }
export const radarQueue = defineQueue<Job>({ name: "radar.collect", options: { policy: "short", retryLimit: 2, retryDelay: 300, expireInSeconds: 900 },
  worker: { batchSize: 1, pollingIntervalSeconds: 5 },
  run: async jobs => {
    if (!enabled()) return { disabled: true };
    for (const job of jobs) await recordRun(`radar.execute.${job.action}`, async () => {
      if (job.action === "live") await live();
      else if (job.action === "catalog") { await catalog(); await newsCandidates(); }
      else if (job.action === "history" && job.appid) await history(job.appid);
      else if (job.action === "explain") await explainPending();
    });
    return { done: jobs.length };
  } });
export default defineServerModule({ name: "radar",
  http: app => { app.get<{ Querystring: { month?: string } }>("/api/radar/month", async (req, reply) => {
    const month = req.query.month ?? new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 7);
    if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)) return reply.code(400).send({ error: "invalid_month" });
    return reply.header("Cache-Control", "public, max-age=60").send(await loadRadarMonth(month));
  }); },
  queues: [radarQueue],
  schedules: [
    { name: "radar.live", cron: "*/15 * * * *", when: enabled, run: () => enqueueOn(radarQueue, { action: "live" }, { singletonKey: "live" }) },
    { name: "radar.catalog", cron: "5 3 * * *", when: enabled, run: () => enqueueOn(radarQueue, { action: "catalog" }, { singletonKey: "catalog" }) },
    { name: "radar.warmup", cron: "8,38 * * * *", when: enabled, run: async () => {
      const games = await sql`SELECT appid FROM radar_games WHERE history_loaded_at IS NULL ORDER BY (origin = 'news-link') DESC, first_seen_at DESC, appid DESC LIMIT 12`;
      for (const g of games) await enqueueOn(radarQueue, { action: "history", appid: g.appid }, { singletonKey: `history-${g.appid}` });
      return { queued: games.length };
    } },
    { name: "radar.explain", cron: "12,42 * * * *", when: enabled, run: () => enqueueOn(radarQueue, { action: "explain" }, { singletonKey: "explain" }) },
  ],
  retention: async now => {
    const samples = await sql`DELETE FROM radar_samples WHERE observed_at < ${new Date(now.getTime() - 35 * 86400000)} RETURNING appid`;
    const requests = await sql`DELETE FROM radar_requests WHERE at < ${new Date(now.getTime() - 14 * 86400000)} RETURNING id`;
    return { samples: samples.length, requests: requests.length };
  },
  alerts: async now => {
    if (!enabled()) return [];
    const [r] = await sql`SELECT max(finished_at) AS latest FROM job_runs WHERE job = 'radar.execute.live' AND status = 'ok'`;
    if (r.latest && now - new Date(r.latest).getTime() <= 3600000) return [];
    return [{ key: "radar.collect", level: "later", title: "游戏异动在线记录未更新", impact: "新的游戏增长可能延迟发现，历史档案仍可浏览。", heals: "任务会重试，恢复后继续采集。", action: "检查 radar 队列和出网请求记录。", detail: `last successful collection: ${r.latest ?? 'none'}` }];
  },
});
