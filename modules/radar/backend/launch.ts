import { sql } from "@aihot/backend/db";
import { detectLaunch, dayOf, previousDay, LAUNCH_RULE_VERSION, lifecycle } from "./detect.ts";
import { beijingMidnight } from "@aihot/contracts/time";

/** No network/model work. Official chart membership or >20k official current players qualifies. */
export async function evaluateLaunch(appid: number) {
  const [game] = await sql`SELECT app_type, release_day FROM radar_games WHERE appid = ${appid}`;
  if (!game || game.app_type !== "game" || !game.release_day) return { handled: false, added: 0 };
  const releaseDay = new Date(game.release_day).toISOString().slice(0, 10);
  const lastDay = previousDay(releaseDay, -13);
  const start = beijingMidnight(releaseDay), end = new Date(beijingMidnight(lastDay).getTime() + 86400000);
  return sql.begin(async db => {
    await db`SELECT pg_advisory_xact_lock(hashtextextended(${`radar:${appid}`}, 0))`;
    const rows = await db`SELECT observed_at, source, count, rank FROM radar_samples WHERE appid = ${appid}
      AND source IN ('steam-chart', 'steam-current') AND observed_at >= ${start} AND observed_at <= now() ORDER BY observed_at`;
    const points = rows.map(r => ({ at: new Date(r.observed_at).toISOString(), count: r.count, rank: r.rank as number | null, source: r.source as string }));
    const launchPoints = points.filter(p => Date.parse(p.at) < end.getTime());
    const signal = detectLaunch(launchPoints, releaseDay, game.app_type);
    const [existing] = await db`SELECT id, event_day, status, peak, points, proof FROM radar_events WHERE appid = ${appid} AND kind = 'launch' ORDER BY event_day LIMIT 1`;
    const inLaunchWindow = dayOf(new Date()) >= releaseDay && dayOf(new Date()) <= lastDay;
    if (!signal && !existing) return { handled: inLaunchWindow, added: 0 };
    const date = existing ? new Date(existing.event_day).toISOString().slice(0, 10) : signal!.date;
    const id = existing?.id ?? `${appid}-${date}`;
    if (!existing) {
      const prior = await db`SELECT id FROM radar_events WHERE appid = ${appid} AND event_day BETWEEN ${releaseDay}::date AND ${lastDay}::date LIMIT 1`;
      if (prior.length) return { handled: inLaunchWindow, added: 0 };
    }
    // Keep the complete discovery trace after raw sample retention, merging new observations only.
    const observedDay = new Map<string, number>((existing?.points ?? []).map((p: { at: string; count: number }) => [p.at, p.count]));
    for (const p of launchPoints) if (dayOf(p.at) === date) observedDay.set(p.at, Math.max(observedDay.get(p.at) ?? 0, p.count));
    const dayPoints = [...observedDay].map(([at, count]) => ({ at, count })).sort((a, b) => a.at.localeCompare(b.at));
    const priorLaunch = existing?.proof.launch;
    const highest = launchPoints.reduce<typeof launchPoints[number] | null>((best, p) => !best || p.count > best.count ? p : best, null);
    if (!dayPoints.length || (!highest && !priorLaunch)) return { handled: inLaunchWindow, added: 0 };
    const peak = Math.max(highest?.count ?? 0, Number(priorLaunch?.peak ?? 0));
    const launch = { ...(priorLaunch ?? { releaseDay, qualifiedAt: signal!.qualifiedAt, qualification: signal!.qualification,
      basis: signal!.basis, firstObservedAt: signal!.qualification[0].at }), peak,
      peakDay: highest && highest.count >= Number(priorLaunch?.peak ?? 0) ? dayOf(highest.at) : priorLaunch.peakDay,
      peakObservation: highest && highest.count >= Number(priorLaunch?.peak ?? 0) ? highest : priorLaunch.peakObservation };
    const lifecyclePeak = Math.max(peak, Number(existing?.proof.lifecycle?.peak ?? 0), ...points.map(p => p.count));
    const status = lifecycle(points, { status: existing?.status ?? "suspected", baseline: null, peak: lifecyclePeak, launch: true, qualifiedAt: launch.firstObservedAt });
    const proof = { ...(existing?.proof ?? { rule: LAUNCH_RULE_VERSION,
      source: signal!.basis === "top100" ? "https://api.steampowered.com/ISteamChartsService/GetGamesByConcurrentPlayers/v1/" : `https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid=${appid}`,
      timezone: "Asia/Shanghai", evaluatedAt: new Date().toISOString(), initialThresholdsUncalibrated: true }), launch,
      lifecycle: { status, evaluatedAt: new Date().toISOString(), latestAt: points.at(-1)?.at ?? null, peak: lifecyclePeak } };
    const inserted = await db`INSERT INTO radar_events (id, appid, event_day, origin, status, kind, peak, baseline, baseline_days, points, rule_version, proof)
      VALUES (${id}, ${appid}, ${date}, 'live', ${status}, 'launch', ${Math.max(...dayPoints.map(p => p.count))}, NULL, 0,
        ${sql.json(dayPoints)}, ${LAUNCH_RULE_VERSION}, ${sql.json(proof)})
      ON CONFLICT (appid, event_day) DO NOTHING RETURNING id`;
    await db`UPDATE radar_events SET status = ${status}, peak = greatest(peak, ${Math.max(...dayPoints.map(p => p.count))}), points = ${sql.json(dayPoints)}, proof = ${sql.json(proof)}
      WHERE id = ${id} AND kind = 'launch'`;
    return { handled: inLaunchWindow, added: inserted.length };
  }) as Promise<{ handled: boolean; added: number }>;
}
