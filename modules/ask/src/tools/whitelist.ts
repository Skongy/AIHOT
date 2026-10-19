// In-site Agent tools. All article reads use the shared publication layer.
import { z } from "zod";
import { PUBLIC_API_CATEGORY_KEYS } from "@aihot/contracts/taxonomy";
import { mcpToolName } from "@aihot/contracts/mcp";
import {
  hotAnswer, storyAnswer, dailyAnswer,
} from "@aihot/backend/publication/agent";
import { askItems } from "@aihot/backend/publication/ask";
import { loadItemDetail } from "@aihot/backend/publication/detail";
import { InvalidCursorError } from "@aihot/backend/lib/cursor";
import { askAliases, askRange, type AskRangeInput } from "./search-query.ts";
import { resolveStory, v1HotTopics, v1Story } from "@aihot/backend/publication/stories";
import { dailyWithNotes } from "@aihot/backend/publication/reports";
import { isValidDate } from "@aihot/contracts/time";
import { explainSelection } from "./explain-selection.ts";
import { explainHot } from "./explain-hot.ts";

export const ASK_TOOL_NAMES = [
  "get_latest",
  "search",
  "get_hot_topics",
  "get_story",
  "explain_selection",
  "explain_hot",
  "get_daily",
  "get_article",
] as const;

export type AskToolName = (typeof ASK_TOOL_NAMES)[number];

export const ASK_TOOL_LABELS_ZH: Record<AskToolName, string> = {
  get_latest: "查近期资讯",
  search: "站内搜索",
  get_hot_topics: "查热点",
  get_story: "查事件进展",
  explain_selection: "解释入选",
  explain_hot: "解释上榜",
  get_daily: "查日报",
  get_article: "读这篇资讯",
};

const categorySchema = z.enum(PUBLIC_API_CATEGORY_KEYS as unknown as [string, ...string[]]).optional();
const rangeSchema = {
  window: z.enum(["1h", "24h", "7d", "30d", "all"]).optional().describe("滚动时间，仅 1h|24h|7d|30d|all；超过30天用 all 或 from/until。指定 from/until 时优先日期范围。"),
  from: z.string().max(40).optional().describe("开始（含）：YYYY-MM-DD 按北京时间，或带时区 ISO 时间。"),
  until: z.string().max(40).optional().describe("结束：日期包含当天；ISO 时间不含该时刻。今天用北京时间当日日期作为 from。"),
  cursor: z.string().max(4096).optional().describe("下一页游标，保持其余查询参数和 mode 不变，不要编造。"),
};

const SCHEMAS: Record<AskToolName, z.ZodType> = {
  get_latest: z.object({
    ...rangeSchema,
    mode: z.enum(["selected", "all"]).optional().describe("selected=精选（默认，与精选页一致）；all=全部公开动态。问精选时务必用 selected。"),
    category: categorySchema,
    limit: z.number().int().min(1).max(30).optional().describe("每页条数，1–30，默认10。有 nextCursor 表示仅为部分结果。"),
  }).strict(),
  search: z.object({
    q: z.string().min(2).max(200).describe("搜索词，2–200字。"),
    ...rangeSchema,
    mode: z.enum(["selected", "all"]).optional().describe("all=全部公开动态（默认，适合具名事实查询）；selected=仅精选。翻页须使用返回的 mode。"),
    category: categorySchema,
    limit: z.number().int().min(1).max(30).optional().describe("最多返回条数，1–30，默认10。"),
  }).strict(),
  get_hot_topics: z.object({
    limit: z.number().int().min(1).max(10).optional().describe("热点条数，1–10，默认10。"),
  }).strict(),
  get_story: z.object({
    public_id: z.string().min(1).max(128).describe("事件公开 ID，来自用户站内链接、历史出处或工具返回，不要猜测。"),
    limit: z.number().int().min(1).max(50).optional().describe("时间线条数，1–50，默认20。"),
  }).strict(),
  explain_selection: z.object({
    article_id: z.string().min(1).max(128).describe("条目 ID（站内 /items/… 路径中的 id）。"),
  }).strict(),
  explain_hot: z.object({
    public_id: z.string().min(1).max(128).describe("事件公开 ID，须来自 get_hot_topics。"),
  }).strict(),
  get_daily: z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("可选真实日历日期 YYYY-MM-DD；省略则取最新一期日报。"),
  }).strict(),
  get_article: z.object({ article_id: z.string().min(1).max(128).describe("用户当前文章 /items/… 或工具返回的资讯 ID。") }).strict(),
};

const ASK_TOOL_DESCRIPTIONS: Record<AskToolName, string> = {
  get_latest: "按精确时间范围查近期资讯；默认精选、过去24小时。window 仅允许 1h/24h/7d/30d/all；超过30天用 all 或 from/until。支持自定义日期及游标翻页。不用于具名游戏搜索。",
  search: "按游戏或关键词查全部站内公开报道，自动匹配中英文别名。q 使用游戏名，可附空格分隔的关键词；只有明确要求精选时才传 mode=selected。默认近7天。window 仅允许 1h/24h/7d/30d/all；超过30天用 all 或 from/until。支持日期及翻页。",
  get_hot_topics: "查当前热点榜（多信源同时讨论的事件）。",
  get_story: "查事件的来龙去脉与报道时间线；public_id 来自用户站内链接、历史出处或工具返回。",
  explain_selection: "解释某条目为何入选精选（评分与门槛说明）。",
  explain_hot: "解释某事件为何上热点榜。",
  get_daily: "查本站游戏日报成品。省略 date 取最新一期；今天须指定北京时间日期。不要用滚动资讯列表冒充日报。",
  get_article: "读取指定公开资讯的标题、摘要、来源、时间与关联事件，供文章上下文提问和连续追问。不能据摘要补写全文细节。",
};

/** OpenAI tool specs for the model (short names). */
export function askToolSpecs() {
  return ASK_TOOL_NAMES.map((name) => ({
    type: "function" as const,
    function: {
      name,
      description: ASK_TOOL_DESCRIPTIONS[name],
      parameters: z.toJSONSchema(SCHEMAS[name], { io: "input" }) as Record<string, unknown>,
    },
  }));
}

export interface ToolExecOk {
  ok: true;
  name: AskToolName;
  text: string;
  structured: Record<string, unknown>;
  /** Evidence candidates extracted for the registry. */
  evidence: EvidenceCandidate[];
}

export interface ToolExecFail {
  ok: false;
  name: string;
  errorCode: string;
  message: string;
}

export type ToolExecResult = ToolExecOk | ToolExecFail;

export interface EvidenceCandidate {
  kind: "item" | "story" | "selection_explain" | "hot_explain" | "tool_note";
  objectId: string | null;
  title: string | null;
  sourceName: string | null;
  publishedAt: string | null;
  siteUrl: string | null;
  originalUrl: string | null;
  toolName: string;
  rawRef: Record<string, unknown>;
}

function truncate(text: string, max = 4000): string {
  if ([...text].length <= max) return text;
  return [...text].slice(0, max).join("") + "\n…(已截断)";
}

const ASK_WINDOWS = ["1h", "24h", "7d", "30d", "all"] as const;
type AskWindowLiteral = (typeof ASK_WINDOWS)[number];

/** Model often invents 90d/14d/2w; map common mistakes before Zod so search still runs. */
const WINDOW_COERCE: Record<string, AskWindowLiteral> = {
  "1h": "1h", "24h": "24h", "7d": "7d", "30d": "30d", "all": "all",
  "90d": "all", "60d": "all", "180d": "all", "365d": "all", "1y": "all", "12m": "all", "6m": "all", "3m": "all",
  "14d": "30d", "2w": "30d", "15d": "30d", "21d": "30d",
  "3d": "7d", "2d": "7d", "4d": "7d", "5d": "7d", "10d": "7d",
};

/** Coerce tool args in place for schema recovery. Exported for unit tests. */
export function coerceAskToolArgs(tool: AskToolName, args: unknown): unknown {
  if (!args || typeof args !== "object" || Array.isArray(args)) return args;
  if (tool !== "get_latest" && tool !== "search") return args;
  const out: Record<string, unknown> = { ...(args as Record<string, unknown>) };
  if (!("window" in out) || out.window === undefined || out.window === null) return out;
  if (typeof out.window !== "string") {
    delete out.window;
    return out;
  }
  const key = out.window.trim().toLowerCase();
  const mapped = WINDOW_COERCE[key];
  if (mapped) out.window = mapped;
  else delete out.window; // unknown → drop, tool uses its default window
  return out;
}

/** Validate and execute one whitelist tool call. Unknown names / bad JSON / schema fail without side effects. */
export async function executeAskTool(name: string, argsJson: string): Promise<ToolExecResult> {
  if (!(ASK_TOOL_NAMES as readonly string[]).includes(name)) {
    return { ok: false, name, errorCode: "unknown_tool", message: `工具不在白名单：${name}` };
  }
  const tool = name as AskToolName;
  let args: unknown;
  try {
    args = JSON.parse(argsJson);
  } catch {
    return { ok: false, name, errorCode: "invalid_arguments", message: "工具参数不是完整 JSON，未执行。" };
  }
  const coerced = coerceAskToolArgs(tool, args);
  const parsed = SCHEMAS[tool].safeParse(coerced);
  if (!parsed.success) {
    return { ok: false, name, errorCode: "invalid_arguments", message: `参数校验失败：${parsed.error.message}` };
  }

  try {
    switch (tool) {
      case "get_latest":
      case "search": {
        const a = parsed.data as AskRangeInput & { q?: string; mode?: "selected" | "all"; category?: typeof PUBLIC_API_CATEGORY_KEYS[number]; limit?: number; cursor?: string };
        let range;
        try { range = askRange(a, tool === "search" ? "7d" : "24h"); }
        catch (e) { return { ok: false, name: tool, errorCode: "invalid_arguments", message: String((e as Error).message) }; }
        const queries = tool === "search" ? askAliases(a.q!) : [];
        const base = { queries, category: a.category, limit: a.limit ?? 10, cursor: a.cursor, ...range,
          rangeKey: JSON.stringify([a.window ?? (tool === "search" ? "7d" : "24h"), a.from ?? null, a.until ?? null]) };
        // A named fact query must not hide a fresh public report merely because it missed
        // the editorial selection threshold while older selected results still match.
        let mode = a.mode ?? (tool === "search" ? "all" : "selected");
        let res = await askItems({ ...base, mode });
        let expanded = false;
        // Every returned public item is citeable. The answer renderer only shows evidence actually
        // cited in the final text, so a recent page can expose exact source ids without dumping the
        // whole page under「参考来源」.
        const evidence: EvidenceCandidate[] = res.items.map((it) => ({
          kind: "item" as const, objectId: it.id, title: it.title, sourceName: it.source.name,
          publishedAt: it.publishedAt, siteUrl: `/items/${it.id}`, originalUrl: it.links.original,
          toolName: tool, rawRef: { id: it.id, q: a.q ?? null, firstParty: it.firstParty },
        }));
        const structured = { count: res.items.length, mode, expanded, from: res.from, until: res.until, nextCursor: res.nextCursor, aliases: queries };
        const text = JSON.stringify({ scope: mode === "selected" ? "精选" : "全部公开动态（含未入选）", ...structured,
          note: "时间范围按站内时间，开始含、结束不含。有 nextCursor 仅为一页，不得冒充完整统计。来源类型不代表事实已核实。空结果仅指本查询范围；具名搜索无结果不得改用无关近期列表凑答案。",
          items: res.items.map((it, i) => ({ evidencePosition: i + 1, article_id: it.id, title: it.title, summary: it.summary,
            source: it.source.name, sourceType: it.firstParty ? "官方来源" : "媒体报道", publishedAt: it.publishedAt, timelineAt: it.timelineAt })) });
        return { ok: true, name: tool, text, structured, evidence };
      }
      case "get_article": {
        const { article_id } = parsed.data as { article_id: string };
        const detail = await loadItemDetail(article_id);
        if (detail.kind !== "found" || detail.item.readingMode === "summary-only") return { ok: false, name: tool, errorCode: "not_found", message: "这篇资讯已不可用或仅保留来源信息，暂不支持问答。" };
        const it = detail.item;
        return { ok: true, name: tool, text: JSON.stringify({ article_id: it.id, title: it.title, summary: it.summary,
          source: it.source.name, publishedAt: it.publishedAt, story: it.story,
          note: "只有标题与摘要。不得补写未提供的全文细节；媒体转述不等于官方确认。" }),
          structured: { count: 1 }, evidence: [{ kind: "item", objectId: it.id, title: it.title, sourceName: it.source.name,
            publishedAt: it.publishedAt, siteUrl: `/items/${it.id}`, originalUrl: it.links.original, toolName: tool,
            rawRef: { id: it.id } }] };
      }
      case "get_hot_topics": {
        const a = parsed.data as { limit?: number };
        const limit = a.limit ?? 10;
        const hot = await v1HotTopics();
        const text = truncate(hotAnswer(hot as never, limit, "mcp"));
        const items = (hot.items ?? []).slice(0, limit);
        const evidence: EvidenceCandidate[] = items.map((t: { id: string; title: string; links?: { story?: string } }) => {
          const storyHref = t.links?.story ?? "";
          const publicId = storyHref.split("/story/")[1]?.split(/[?#]/)[0] ?? t.id;
          return {
            kind: "story" as const,
            objectId: publicId,
            title: t.title,
            sourceName: null,
            publishedAt: null,
            siteUrl: `/story/${publicId}`,
            originalUrl: null,
            toolName: tool,
            rawRef: { id: t.id, publicId },
          };
        });
        return { ok: true, name: tool, text, structured: { count: evidence.length }, evidence };
      }
      case "get_story": {
        const a = parsed.data as { public_id: string; limit?: number };
        const limit = a.limit ?? 20;
        let lookup = await resolveStory(a.public_id);
        if (lookup.kind === "merged") lookup = await resolveStory(lookup.target);
        const body = lookup.kind === "found" ? await v1Story(lookup.storyId) : null;
        if (!body) return { ok: false, name: tool, errorCode: "not_found", message: "没有这个公开事件。" };
        const text = truncate(storyAnswer(body.story, limit, "mcp"));
        return {
          ok: true,
          name: tool,
          text,
          structured: { publicId: body.story.publicId, reportCount: Math.min(body.story.reports.length, limit) },
          evidence: [{
            kind: "story",
            objectId: body.story.publicId as string,
            title: body.story.title as string,
            sourceName: null,
            publishedAt: null,
            siteUrl: `/story/${body.story.publicId}`,
            originalUrl: null,
            toolName: tool,
            rawRef: { publicId: body.story.publicId },
          }, ...body.story.reports.slice(0, limit).map((report) => ({
            kind: "item" as const,
            objectId: report.id,
            title: report.title,
            sourceName: report.source.name,
            publishedAt: report.publishedAt,
            siteUrl: report.links.aihot,
            originalUrl: report.links.original,
            toolName: tool,
            rawRef: { id: report.id, publicId: body.story.publicId, firstParty: report.source.firstParty },
          }))],
        };
      }
      case "explain_selection": {
        const a = parsed.data as { article_id: string };
        const r = await explainSelection(a.article_id);
        if (r.isError) {
          const code = (r.structured.error as { code: string }).code;
          return { ok: false, name: tool, errorCode: code, message: r.text };
        }
        const article = r.structured.article as { id: string; title: string; sourceName?: string; publishedAt?: string | null; links?: { site?: string; original?: string | null } };
        return {
          ok: true,
          name: tool,
          text: truncate(r.text),
          structured: r.structured,
          evidence: [{
            kind: "selection_explain",
            objectId: article.id,
            title: article.title,
            sourceName: article.sourceName ?? null,
            publishedAt: article.publishedAt ?? null,
            siteUrl: article.links?.site ?? `/items/${article.id}`,
            originalUrl: article.links?.original ?? null,
            toolName: tool,
            rawRef: { article_id: a.article_id },
          }],
        };
      }
      case "explain_hot": {
        const a = parsed.data as { public_id: string };
        const r = await explainHot(a.public_id);
        if (r.isError) {
          const code = (r.structured.error as { code: string }).code;
          return { ok: false, name: tool, errorCode: code, message: r.text };
        }
        const story = r.structured.story as { publicId: string; title: string; links?: { site?: string } };
        return {
          ok: true,
          name: tool,
          text: truncate(r.text),
          structured: r.structured,
          evidence: [{
            kind: "hot_explain",
            objectId: story.publicId,
            title: story.title,
            sourceName: null,
            publishedAt: null,
            siteUrl: story.links?.site ?? `/story/${story.publicId}`,
            originalUrl: null,
            toolName: tool,
            rawRef: { public_id: a.public_id },
          }],
        };
      }
      case "get_daily": {
        const a = parsed.data as { date?: string };
        if (a.date && !isValidDate(a.date)) {
          return { ok: false, name: tool, errorCode: "invalid_arguments", message: `${a.date} 不是有效日期。` };
        }
        const res = await dailyWithNotes(a.date ?? "latest");
        if (!res) {
          return {
            ok: false,
            name: tool,
            errorCode: "not_found",
            message: a.date ? `没有 ${a.date} 的公开日报。` : "还没有公开日报。",
          };
        }
        const date = res.body.report.date as string;
        const text = truncate(dailyAnswer(res.body.report, "mcp", res.notes));
        return {
          ok: true,
          name: tool,
          text,
          structured: { date, count: 1 },
          evidence: [{
            kind: "tool_note",
            objectId: date,
            title: `日报 · ${date}`,
            sourceName: null,
            publishedAt: (res.body.report.generatedAt as string | null) ?? null,
            siteUrl: `/daily/${date}`,
            originalUrl: null,
            toolName: tool,
            rawRef: { date },
          }],
        };
      }
    }
  } catch (e) {
    if (e instanceof InvalidCursorError) return { ok: false, name, errorCode: "invalid_arguments", message: "翻页参数与查询不匹配，请重新检索。" };
    return { ok: false, name, errorCode: "internal_error", message: "工具执行失败。" };
  }
}

/** Short user-facing step summary — never the model-facing tool body (preamble / URLs / security fence). */
export function friendlyStepSummary(exec: ToolExecOk): string {
  const count = typeof exec.structured.count === "number" ? exec.structured.count : exec.evidence.length;
  // get_latest is an unfiltered recent dump, not query-matched hits.
  if (exec.name === "get_latest") {
    const scope = exec.structured.mode === "all" ? "公开动态" : "精选";
    return count > 0 ? `拉取近期${scope} ${count} 条` : "暂无结果";
  }
  if (exec.name === "get_daily") {
    const date = typeof exec.structured.date === "string" ? exec.structured.date : "";
    return date ? `已加载 ${date} 日报` : "已加载日报";
  }
  const n = exec.evidence.length;
  if (n > 0) return `找到 ${n} 条相关资料`;
  if (typeof count === "number") return count > 0 ? `找到 ${count} 条相关资料` : "暂无结果";
  return "完成";
}

/** Full MCP tool names for documentation. */
export const ASK_MCP_NAMES = ASK_TOOL_NAMES.map((n) => mcpToolName(n));
