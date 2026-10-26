import type { RadarEvent, RadarKind } from "../types";
export type { RadarEvent };
export const fmt = (n: number) => new Intl.NumberFormat("en-US").format(n);
export const kindLabels: Record<RadarKind, string> = { breakout: "突然爆火", comeback: "老游戏翻红", watch: "继续观察" };
export const multiplier = (e: RadarEvent) => e.baseline && e.baseline > 0 ? `${(e.peak / e.baseline).toFixed(1)}×` : "待补记录";
export const stamp = (date: string) => `${Number(date.slice(5, 7))} 月 ${Number(date.slice(8))} 日`;
export const store = (e: RadarEvent) => `https://store.steampowered.com/app/${e.appid}/`;
export const cover = (e: RadarEvent) => e.coverUrl;
