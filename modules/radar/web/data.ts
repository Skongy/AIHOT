import type { RadarEvent, RadarKind } from "../types";
export type { RadarEvent };
export const fmt = (n: number) => new Intl.NumberFormat("en-US").format(n);
export const kindLabels: Record<RadarKind, string> = { breakout: "突然爆火", comeback: "老游戏翻红", watch: "继续观察", launch: "新游上榜" };
export const eventLabel = (e: RadarEvent) => e.kind === "launch" && (e.launch?.peak ?? e.peak) >= 50000 ? "首发热门" : kindLabels[e.kind];
export const multiplier = (e: RadarEvent) => e.kind === "launch" ? "Top 100" : e.baseline && e.baseline > 0 ? `${(e.peak / e.baseline).toFixed(1)}×` : "待补记录";
export const stamp = (date: string) => `${Number(date.slice(5, 7))} 月 ${Number(date.slice(8))} 日`;
export const store = (e: RadarEvent) => `https://store.steampowered.com/app/${e.appid}/`;
export const cover = (e: RadarEvent) => e.coverUrl;
