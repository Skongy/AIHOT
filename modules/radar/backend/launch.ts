import { sql } from "@aihot/backend/db";
import { detectLaunch, dayOf, previousDay, LAUNCH_RULE_VERSION } from "./detect.ts";
import { beijingMidnight } from "@aihot/contracts/time";

/** No network or model work. Only official chart/current samples can establish a launch event. */
export async function evaluateLaunch(appid: number) {
  const [game] = await sql`SELECT app_type, release_day FROM radar_games WHERE appid = ${appid}`;
  if (!game || game.app_type !== "game" || !game.release_day) return { handled: false, added: 0 };
  const releaseDay = new Date(game.release_day).toISOString().slice(0, 10);
  const lastDay = previousDay(releaseDay, -13);
  if (lastDay < previousDay(dayOf(new Date()), 35)) return { handled: false, added: 0 };
  const start = beijingMidnight(releaseDay), end = new Date(beijingMidnight(lastDay).getTime() + 86400000);
  return sql.begin(async db => {
    // Scheduled collection and explicit reassessment may evaluate the same game concurrently.
    await db`SELECT pg_advisory_xact_lock(hashtextextended(${`radar-launch:${appid}`}, 0))`;
    const rows = await db`SELECT observed_at, source, count, rank FROM radar_samples WHERE appid = ${appid}
      AND source IN ('steam-chart', 'steam-current') AND observed_at >= ${start}
      AND observed_at < ${end} AND observed_at <= now() ORDER BY observed_at`;
    const points = rows.map(r => ({ at: new Date(r.observed_at).toISOString(), count: r.count, rank: r.rank as number | null, source: r.source as string }));
    const chartPoints = points.filter(p => p.source === "steam-chart");
    const signal = detectLaunch(chartPoints, releaseDay, game.app_type);
    const [existing] = await db`SELECT id, event_day, proof FROM radar_events WHERE appid = ${appid} AND kind = 'launch' ORDER BY event_day LIMIT 1`;
    const inLaunchWindow = dayOf(new Date()) >= releaseDay && dayOf(new Date()) <= lastDay;
    const handled = inLaunchWindow && chartPoints.length > 0;
    if (existing && !inLaunchWindow) return { handled: false, added: 0 };
    if (!signal && !existing) return { handled, added: 0 };
    const date = existing ? new Date(existing.event_day).toISOString().slice(0, 10) : signal!.date;
    const id = existing?.id ?? `${appid}-${date}`;
    if (!existing) {
      // A game already recorded as a growth event is not rediscovered as a launch.
      const prior = await db`SELECT id FROM radar_events WHERE appid = ${appid} AND event_day BETWEEN ${releaseDay}::date AND ${lastDay}::date LIMIT 1`;
      if (prior.length) return { handled: inLaunchWindow, added: 0 };
    }
    const observedDay = new Map<string, number>();
    for (const p of points) if (dayOf(p.at) === date) observedDay.set(p.at, Math.max(observedDay.get(p.at) ?? 0, p.count));
    const dayPoints = [...observedDay].map(([at, count]) => ({ at, count }));
    const highest = points.reduce((best, p) => !best || p.count > best.count ? p : best, points[0]);
    if (!highest || !dayPoints.length) return { handled, added: 0 };
    const priorLaunch = existing?.proof.launch;
    const peak = Math.max(highest.count, Number(priorLaunch?.peak ?? 0));
    const launch = { ...(priorLaunch ?? { releaseDay, qualifiedAt: signal!.qualifiedAt, qualification: signal!.qualification,
      firstObservedAt: signal!.qualification[0].at }), peak, peakDay: highest.count >= Number(priorLaunch?.peak ?? 0) ? dayOf(highest.at) : priorLaunch.peakDay };
    const proof = { ...(existing?.proof ?? { rule: LAUNCH_RULE_VERSION, source: "https://api.steampowered.com/ISteamChartsService/GetGamesByConcurrentPlayers/v1/",
      timezone: "Asia/Shanghai", evaluatedAt: new Date().toISOString(), initialThresholdsUncalibrated: true }), launch };
    const inserted = await db`INSERT INTO radar_events (id, appid, event_day, origin, status, kind, peak, baseline, baseline_days, points, rule_version, proof)
      VALUES (${id}, ${appid}, ${date}, 'live', 'confirmed', 'launch', ${Math.max(...dayPoints.map(p => p.count))}, NULL, 0,
        ${sql.json(dayPoints)}, ${LAUNCH_RULE_VERSION}, ${sql.json(proof)})
      ON CONFLICT (appid, event_day) DO NOTHING RETURNING id`;
    await db`UPDATE radar_events SET peak = greatest(peak, ${Math.max(...dayPoints.map(p => p.count))}), points = ${sql.json(dayPoints)}, proof = ${sql.json(proof)}
      WHERE id = ${id} AND kind = 'launch'`;
    return { handled: inLaunchWindow || inserted.length > 0, added: inserted.length };
  }) as Promise<{ handled: boolean; added: number }>;
}
