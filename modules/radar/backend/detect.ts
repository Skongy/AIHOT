import type { RadarPoint } from "../types.ts";
import type { RadarStatus } from "@aihot/contracts/radar";
import { isValidDate } from "@aihot/contracts/time";
export const LAUNCH_RULE_VERSION = "radar-launch-v2";
export const RULE_VERSION = "radar-v2";
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
export function validPoints(points: RadarPoint[]): RadarPoint[] {
  const unique = new Map<string, RadarPoint>();
  for (const p of points) if (Number.isSafeInteger(p.count) && p.count >= 0 && Number.isFinite(Date.parse(p.at))) {
    const at = new Date(p.at).toISOString();
    if (!unique.has(at) || unique.get(at)!.count < p.count) unique.set(at, { at, count: p.count });
  }
  return [...unique.values()].sort((a, b) => a.at.localeCompare(b.at));
}
/** Consecutive qualifying observations; duplicate/cached reads and long gaps are not evidence. */
function sustained(points: RadarPoint[], qualifies: (p: RadarPoint) => boolean, span: number, minimum = 2, maxGap = 60 * 60000): RadarPoint[] {
  let run: RadarPoint[] = [];
  for (const p of validPoints(points)) {
    if (!qualifies(p)) { run = []; continue; }
    if (run.length && Date.parse(p.at) - Date.parse(run.at(-1)!.at) > maxGap) run = [];
    run.push(p);
    if (run.length >= minimum && Date.parse(p.at) - Date.parse(run[0].at) >= span) return run;
  }
  return [];
}
export interface LaunchPoint extends RadarPoint { rank: number | null; source?: string }
export function detectLaunch(points: LaunchPoint[], releaseDay: string | null, appType: string | null) {
  if (appType !== "game" || !releaseDay || !isValidDate(releaseDay)) return null;
  const lastDay = previousDay(releaseDay, -13);
  const snapshots = points.filter(p => Number.isSafeInteger(p.count) && p.count >= 0 && dayOfSafe(p.at) >= releaseDay && dayOfSafe(p.at) <= lastDay);
  const qualified = (p: LaunchPoint) => (p.source === undefined || p.source === "steam-chart")
    ? (p.rank === null || (Number.isInteger(p.rank) && p.rank >= 1 && p.rank <= 100)) && p.count > 0
    : p.source === "steam-current" && p.count > 20000;
  const eligible = new Map(snapshots.filter(qualified).map(p => [new Date(p.at).toISOString(), p]));
  // Keep nonqualifying official samples too: a low reading breaks the qualifying sequence.
  const observed = snapshots.filter(p => p.source === undefined || p.source === "steam-chart" || p.source === "steam-current");
  const run = sustained(observed, p => eligible.has(p.at), 15 * 60000, 2, 60 * 60000);
  if (!run.length) return null;
  const qualification = run.map(p => ({ ...p, rank: eligible.get(p.at)!.rank, source: eligible.get(p.at)!.source ?? "steam-chart" }));
  return { date: dayOf(run[0].at), qualifiedAt: run.at(-1)!.at, qualification,
    basis: qualification.every(p => p.source === "steam-chart") ? "top100" as const : "players" as const };
}
function dayOfSafe(at: string) { return Number.isFinite(Date.parse(at)) ? dayOf(at) : ""; }
export interface Daily { date: string; peak: number; hours: number; points: RadarPoint[] }
export function dailyPoints(points: RadarPoint[]): Daily[] {
  const days = new Map<string, Map<string, RadarPoint>>();
  for (const p of validPoints(points)) {
    const day = dayOf(p.at), hour = p.at.slice(0, 13);
    const bucket = days.get(day) ?? new Map<string, RadarPoint>();
    if (!bucket.has(hour) || bucket.get(hour)!.count < p.count) bucket.set(hour, p);
    days.set(day, bucket);
  }
  return [...days].sort(([a], [b]) => a.localeCompare(b)).map(([date, hours]) => {
    const ps = [...hours.values()].sort((a, b) => a.at.localeCompare(b.at));
    return { date, peak: Math.max(...ps.map(p => p.count)), hours: hours.size, points: ps };
  });
}
const isGrowth = (count: number, baseline: number) => count >= Math.max(baseline * 3, baseline + 2000);
export function confirmationPoints(points: RadarPoint[], baseline: number): RadarPoint[] {
  if (!(baseline >= 0 && baseline <= 5000)) return [];
  const high = sustained(points, p => isGrowth(p.count, baseline), 2 * 3600000, 3);
  return high.length && dailyPoints(high).reduce((n, d) => n + d.hours, 0) >= 3 ? high : [];
}
export interface Signal { date: string; peak: number; baseline: number; baselineDays: number; status: "confirmed" | "suspected"; kind: "breakout"; points: RadarPoint[]; baselinePoints: RadarPoint[]; qualifiedAt: string; firstObservedAt: string }
/** A short baseline still needs three low hourly observations over two hours, never an assumed zero. */
export function detect(points: RadarPoint[], options: { releaseDay?: string | null; established?: boolean } = {}): Signal[] {
  if (options.established) return [];
  const valid = validPoints(points), days = dailyPoints(valid), byDay = new Map(days.map(d => [d.date, d]));
  const signals: Signal[] = [];
  let lastSignal = "";
  for (const d of days) {
    if (lastSignal && Date.parse(d.date) - Date.parse(lastSignal) < 14 * 86400000) continue;
    if (options.releaseDay && options.releaseDay <= d.date && previousDay(options.releaseDay, -13) >= d.date) continue;
    const history = Array.from({ length: 7 }, (_, i) => byDay.get(previousDay(d.date, i + 1))).filter((v): v is Daily => !!v && v.hours >= 12);
    const fullBaseline = history.length >= 3 ? median(history.map(v => v.peak)) : null;
    if (fullBaseline !== null && fullBaseline > 5000) continue;
    for (const first of valid.filter(p => dayOf(p.at) === d.date && p.count >= 2000)) {
      if (fullBaseline !== null && !isGrowth(first.count, fullBaseline)) continue;
      const before = fullBaseline === null ? dailyPoints(valid.filter(p => p.at < first.at && Date.parse(p.at) >= Date.parse(first.at) - 24 * 3600000)).flatMap(day => day.points) : [];
      const short = before.length >= 3 && Date.parse(before.at(-1)!.at) - Date.parse(before[0].at) >= 2 * 3600000 && before.every(p => p.count <= 5000);
      const baseline = fullBaseline ?? (short ? median(before.map(p => p.count)) : null);
      if (baseline === null || !isGrowth(first.count, baseline)) continue;
      const after = valid.filter(p => p.at >= first.at);
      const high = sustained(after, p => isGrowth(p.count, baseline), 15 * 60000);
      if (!high.length || high[0].at !== first.at) continue;
      const baselinePoints = fullBaseline !== null ? history.flatMap(v => v.points) : before;
      signals.push({ date: d.date, peak: d.peak, baseline, baselineDays: new Set(baselinePoints.map(p => dayOf(p.at))).size,
        status: confirmationPoints(after, baseline).length ? "confirmed" : "suspected", kind: "breakout", points: valid.filter(p => dayOf(p.at) === d.date),
        baselinePoints, qualifiedAt: high.at(-1)!.at, firstObservedAt: high[0].at });
      lastSignal = d.date;
      break;
    }
  }
  return signals;
}
/** Missing/stale data cannot cool an event. The baseline and discovery date never move. */
export function lifecycle(points: RadarPoint[], event: { status: RadarStatus; baseline: number | null; peak: number; launch: boolean; qualifiedAt: string }, now = Date.now()): RadarStatus {
  const recent = validPoints(points).filter(p => p.at >= event.qualifiedAt && Date.parse(p.at) <= now);
  if (!recent.length || now - Date.parse(recent.at(-1)!.at) > 90 * 60000) return event.status;
  const last = recent.at(-1)!;
  const tail = recent.filter(p => Date.parse(p.at) >= Date.parse(last.at) - 3 * 3600000);
  const trailing = (qualifies: (p: RadarPoint) => boolean) => {
    const run: RadarPoint[] = [];
    for (const p of [...tail].reverse()) {
      if (!qualifies(p) || (run.length && Date.parse(run.at(-1)!.at) - Date.parse(p.at) > 3600000)) break;
      run.push(p);
    }
    return run.reverse();
  };
  const cooled = confirmationWindow(trailing(p => p.count <= Math.max((event.baseline ?? 0) * 1.5, event.peak * .35)));
  if (cooled) return "cooled";
  const qualifies = (p: RadarPoint) => event.launch ? p.count >= 20000 || p.count >= event.peak * .5 : event.baseline !== null && isGrowth(p.count, event.baseline);
  const rising = trailing(qualifies);
  if (confirmationWindow(rising)) return "confirmed";
  if (event.status === "confirmed") return "confirmed";
  if (sustained(rising, qualifies, 30 * 60000, 3).length) return "surging";
  return event.status;
}
function confirmationWindow(points: RadarPoint[]) {
  const hourly = dailyPoints(points).flatMap(d => d.points);
  return hourly.length >= 3 && Date.parse(points.at(-1)!.at) - Date.parse(points[0].at) >= 2 * 3600000;
}
