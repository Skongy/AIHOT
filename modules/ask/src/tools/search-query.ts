import { ENTITIES } from "@aihot/industry/taxonomy";
import { isValidDate } from "@aihot/contracts/time";

export type AskWindow = "1h" | "24h" | "7d" | "30d" | "all";
export interface AskRangeInput { window?: AskWindow; from?: string; until?: string }

function boundary(value: string, end: boolean): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value) && isValidDate(value)) {
    const date = new Date(`${value}T00:00:00+08:00`);
    return new Date(date.getTime() + (end ? 86400000 : 0));
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    || !isValidDate(value.slice(0, 10)) || !Number.isFinite(Date.parse(value))) {
    throw new Error("日期须为真实 YYYY-MM-DD 或带时区的 ISO 时间。");
  }
  return new Date(value);
}

/** Date-only bounds use Beijing calendar days; the end is exclusive. */
export function askRange(input: AskRangeInput, fallback: AskWindow, now = new Date()) {
  const window = input.window ?? fallback;
  const durations = { "1h": 3600000, "24h": 86400000, "7d": 7 * 86400000, "30d": 30 * 86400000 };
  const until = input.until ? boundary(input.until, true) : now;
  const from = input.from ? boundary(input.from, false)
    : input.until || window === "all" ? null : new Date(now.getTime() - durations[window]);
  if (from && from >= until) throw new Error("开始时间必须早于结束时间。");
  return { from, until: new Date(Math.min(until.getTime(), now.getTime())) };
}

const normal = (value: string) => value.normalize("NFKC").toLowerCase().replace(/[《》]/g, "").replace(/\s+/g, " ").trim();

const CONTENT_STOPS = ["有没有公布", "有没有", "这一周", "为什么", "是否", "哪些", "哪个", "怎么", "如何", "什么", "哪位", "哪支", "谁", "吗", "呢"];
const CONTENT_HINTS = ["全球冠军赛", "冠军赛", "平衡调整", "夺冠", "冠军", "平衡", "联名", "贴纸", "缓刑", "补丁", "售价"];
const CONTENT_LATIN_STOP = new Set(["the", "who", "won", "and", "for", "with", "from", "game", "games"]);

/** Space-separated terms for keyword search. A whole question must not become one LIKE phrase. */
export function askContentQuery(text: string): string {
  const raw = normal(text).replace(/[？?。！!，,、]/g, " ").replace(/\s+/g, " ").trim();
  let entity = "";
  let entityAt = -1;
  for (const item of Object.values(ENTITIES)) {
    const names = [...new Set([item.name, ...item.aliases, ...(item.otherNames ?? [])].map(normal))].sort((a, b) => b.length - a.length);
    for (const name of names) {
      if (name.length < 2 || name.length < entity.length) continue;
      const index = raw.indexOf(name);
      if (index < 0) continue;
      if (/^[a-z0-9]/.test(name) && /[a-z0-9]/.test(raw[index - 1] ?? "")) continue;
      if (/[a-z0-9]$/.test(name) && /[a-z0-9]/.test(raw[index + name.length] ?? "")) continue;
      if (name.length === entity.length && index > entityAt) continue;
      entity = name;
      entityAt = index;
    }
  }
  const years = raw.match(/20\d{2}/g) ?? [];
  const hints: string[] = [];
  let scan = raw;
  for (const hint of [...CONTENT_HINTS].sort((a, b) => b.length - a.length)) {
    if (!scan.includes(hint) || hints.some((chosen) => chosen.includes(hint))) continue;
    hints.push(hint);
    scan = scan.split(hint).join(" ");
  }
  let rest = entityAt >= 0 ? `${raw.slice(0, entityAt)} ${raw.slice(entityAt + entity.length)}` : raw;
  for (const stop of CONTENT_STOPS) rest = rest.split(stop).join(" ");
  const latin = [...rest.matchAll(/[a-z][a-z0-9][a-z0-9.-]{0,}/g)].map((match) => match[0]).filter((token) => !CONTENT_LATIN_STOP.has(token) && token !== entity);
  const terms = [...new Set([entity, ...years, ...hints, ...latin].map((term) => term.trim()).filter((term) => term.length >= 2))];
  if (terms.length) return terms.slice(0, 6).join(" ");
  return raw.length >= 2 ? raw.slice(0, 80) : "游戏新闻";
}

/** Expand one named entity, retaining extra keywords; never broaden an unknown query. */
export function askAliases(query: string): string[] {
  const q = normal(query);
  for (const entity of Object.values(ENTITIES)) {
    const names = [...new Set([entity.name, ...entity.aliases, ...(entity.otherNames ?? [])].map(normal))];
    for (const name of [...names].sort((a, b) => b.length - a.length)) {
      const index = q.indexOf(name);
      if (index < 0) continue;
      if (/^[a-z0-9]/.test(name) && /[a-z0-9]/.test(q[index - 1] ?? "")) continue;
      if (/[a-z0-9]$/.test(name) && /[a-z0-9]/.test(q[index + name.length] ?? "")) continue;
      const before = q.slice(0, index);
      const after = q.slice(index + name.length);
      const expanded = names.flatMap((alias) => {
        const replaced = before + alias + after;
        // Chinese questions commonly attach a qualifier directly to the game name
        // (e.g. “无畏契约冠军赛”). Add a tokenized variant so SQL can match the
        // entity and qualifier independently even when the article inserts other words.
        const separated = after && !/^\s/.test(after) ? `${before}${alias} ${after}` : replaced;
        return [replaced, separated];
      });
      return [...new Set([q, ...expanded])].slice(0, 16);
    }
  }
  return [q];
}
