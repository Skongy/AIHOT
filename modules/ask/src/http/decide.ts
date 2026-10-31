// Decides whether a posted question creates a task, resumes one, or is rejected.
// The same clientRequestId always resumes the first task, even if a retry asks for the other mode.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AskRequestMode = "normal" | "deep";

export type AskPostDecision =
  | { kind: "problem"; status: 400 | 409; code: "invalid_request" | "task_conflict"; detail: string }
  | { kind: "replay"; taskId: string; status: string }
  | { kind: "create"; message: string; clientRequestId: string; mode: AskRequestMode };

export function parseAskMode(value: unknown): AskRequestMode | null {
  if (value === undefined || value === null || value === "") return "normal";
  if (value === "normal" || value === "deep") return value;
  return null;
}

export function decideAskPost(input: {
  message: unknown;
  clientRequestId: unknown;
  mode: unknown;
  existing: { id: string; status: string } | null;
  active: boolean;
}): AskPostDecision {
  const clientRequestId = typeof input.clientRequestId === "string" ? input.clientRequestId.trim() : "";
  if (!clientRequestId || !UUID_RE.test(clientRequestId)) {
    return { kind: "problem", status: 400, code: "invalid_request", detail: "clientRequestId 必须是 uuid" };
  }
  const mode = parseAskMode(input.mode);
  if (!mode) return { kind: "problem", status: 400, code: "invalid_request", detail: "mode 只能是 normal 或 deep" };
  const message = typeof input.message === "string" ? input.message.trim() : "";
  const len = [...message].length;
  if (len < 1 || len > 2000) {
    return { kind: "problem", status: 400, code: "invalid_request", detail: "message 长度须为 1–2000 字" };
  }
  if (input.existing) {
    const status = input.existing.status;
    return {
      kind: "replay",
      taskId: input.existing.id,
      status: status === "running" || status === "queued" ? status : status,
    };
  }
  if (input.active) {
    return { kind: "problem", status: 409, code: "task_conflict", detail: "当前会话已有执行中的任务" };
  }
  return { kind: "create", message, clientRequestId, mode };
}
