import type { RadarPoint } from "../types.ts";
import { isValidDate } from "@aihot/contracts/time";
export const LAUNCH_RULE_VERSION = "radar-launch-v1";
export const RULE_VERSION = "radar-v1";
export function dayOf(at: string | Date): string {
  return new Date(new Date(at).getTime() + 8 * 3600000).toISOString().slice(0, 10);
}
export function previousDay(day: string, offset: number): string {
  return new Date(Date.parse(day + "T00:00:00Z") - offset * 86400000).toISOString().slice(0, 10);
}
export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b), mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Input is restricted to official Top 100 snapshots, including legacy snapshots with no saved rank. */
export interface LaunchPoint extends RadarPoint { rank: number | null }
export function detectLaunch(points: LaunchPoint[], releaseDay: string | null, appType: string | null) {
  if (appType !== "game" || !releaseDay || !isValidDate(releaseDay)) return null;
  const lastDay = previousDay(releaseDay, -13); // Fourteen calendar days, counting release day as day one.
  const snapshots = [...new Map(points.filter(p => Number.isSafeInteger(p.count) && p.count > 0 && Number.isFinite(Date.parse(p.at))
    && (p.rank === null || (Number.isInteger(p.rank) && p.rank >= 1 && p.rank <= 100))
    && dayOf(p.at) >= releaseDay && dayOf(p.at) <= lastDay).map(p => [p.at, p])).values()].sort((a, b) => a.at.localeCompare(b.at));
  let start = 0;
  for (let i = 1; i < snapshots.length; i++) {
    if (Date.parse(snapshots[i].at) - Date.parse(snapshots[i - 1].at) > 30 * 60000) start = i;
    if (Date.parse(snapshots[i].at) - Date.parse(snapshots[start].at) >= 15 * 60000) {
      return { date: dayOf(snapshots[start].at), qualifiedAt: snapshots[i].at, qualification: snapshots.slice(start, i + 1) };
    }
  }
  return null;
}
export interface Daily { date: string; peak: number; hours: number; points: RadarPoint[] }
export function dailyPoints(points: RadarPoint[]): Daily[] {
  const days = new Map<string, Map<string, RadarPoint>>();
  for (const p of points) {
    if (!Number.isSafeInteger(p.count) || p.count < 0 || !Number.isFinite(Date.parse(p.at))) continue;
    const day = dayOf(p.at), hour = p.at.slice(0, 13);
    const bucket = days.get(day) ?? new Map<string, RadarPoint>();
    // One peak per hour: accelerated monitoring cannot multiply the evidence count.
    if (!bucket.has(hour) || bucket.get(hour)!.count < p.count) bucket.set(hour, p);
    days.set(day, bucket);
  }
  return [...days].sort(([a], [b]) => a.localeCompare(b)).map(([date, hours]) => {
    const ps = [...hours.values()].sort((a, b) => a.at.localeCompare(b.at));
    return { date, peak: Math.max(...ps.map(p => p.count)), hours: hours.size, points: ps };
  });
}
export interface Signal { date: string; peak: number; baseline: number | null; baselineDays: number; status: "confirmed" | "suspected"; kind: "breakout" | "comeback" | "watch"; points: RadarPoint[] }
export function confirmationPoints(points: RadarPoint[], baseline: number): RadarPoint[] {
  if (!(baseline > 0 && baseline <= 5000)) return [];
  const high = dailyPoints(points).flatMap(d => d.points).filter(p => p.count >= baseline * 5 && p.count - baseline >= 2000);
  return high.length >= 3 && Date.parse(high.at(-1)!.at) - Date.parse(high[0].at) >= 2 * 3600000 ? high : [];
}
/** Thresholds are initial product rules, never a claimed calibrated accuracy score. */
export function detect(points: RadarPoint[], options: { releaseDay?: string | null; established?: boolean } = {}): Signal[] {
  if (options.established) return [];
  const days = dailyPoints(points), byDay = new Map(days.map(d => [d.date, d]));
  const signals: Signal[] = [];
  let lastSignal = "";
  for (const d of days) {
    if (lastSignal && Date.parse(d.date) - Date.parse(lastSignal) < 14 * 86400000) continue;
    const history = Array.from({ length: 7 }, (_, i) => byDay.get(previousDay(d.date, i + 1))).filter((v): v is Daily => !!v && v.hours >= 12);
    const baseline = history.length >= 3 ? median(history.map(v => v.peak)) : null;
    const recentRelease = !!options.releaseDay && options.releaseDay >= previousDay(d.date, 14) && options.releaseDay <= d.date;
    if (baseline !== null && baseline > 20000) continue;
    const threshold = baseline === null ? 5000 : Math.max(baseline * (baseline <= 5000 ? 3 : 2.5), baseline + 1000);
    const high = d.points.filter(p => p.count >= threshold);
    if (high.length < 3 || Date.parse(high.at(-1)!.at) - Date.parse(high[0].at) < 2 * 3600000) continue;
    // Unknown baseline needs a measured same-day ascent. Starting collection on a hot game is not growth.
    if (baseline === null) {
      const before = d.points.filter(p => p.at < high[0].at);
      if (before.length < 3 || median(before.map(p => p.count)) > 1000 || d.peak < 5000 || recentRelease) continue;
    }
    if (recentRelease && d.peak >= 40000) continue;
    const confirmed = baseline !== null && history.length === 7 && confirmationPoints(d.points, baseline).length > 0 && !recentRelease;
    signals.push({ date: d.date, peak: d.peak, baseline, baselineDays: history.length,
      status: confirmed ? "confirmed" : "suspected", kind: confirmed ? "breakout" : baseline !== null && baseline > 5000 ? "comeback" : "watch", points: d.points });
    lastSignal = d.date;
  }
  return signals;
}
