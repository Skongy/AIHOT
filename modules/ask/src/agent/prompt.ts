import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { beijingDate, beijingTime } from "@aihot/contracts/time";

export const PROMPT_VERSION = "ask-system-v2";

const SYSTEM = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../../prompts/system-v1.md"), "utf8");

/** System prompt; injects the current Beijing clock so relative windows like「最近一小时」are not guessed. */
export function askSystemPrompt(now = Date.now()): string {
  const clock = `${beijingDate(now)} ${beijingTime(now)}`;
  return `${SYSTEM.trim()}

# 当前时间
现在是北京时间 ${clock}。回答「最近一小时／今天／昨晚」等相对时间时必须以此为准，不要自行假设当前时刻。
工具按「站内时间」过滤范围，与精选页时间轴一致。最近一小时用 window=1h，今天用北京时间当天的 from 日期；不要以原文发布时间替代。
`;
}
