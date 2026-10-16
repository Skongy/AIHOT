export type Step = { stepId: string; tool: string; labelZh: string; status: "running" | "ok" | "fail"; summary?: string };
export type Evidence = { id: number; kind?: string; title?: string | null; siteUrl?: string | null; originalUrl?: string | null; sourceName?: string | null; publishedAt?: string | null; unavailable?: boolean };
export type Message = { key: string; role: "user" | "assistant"; text: string; taskId?: string; status?: string; steps?: Step[]; evidence?: Evidence[]; contentInvalidated?: boolean; requestId?: string };
export const TERMINAL = new Set(["completed", "completed_degraded", "failed", "cancelled", "limit_reached"]);

export function snapshotSteps(events: Array<{ type: string; payload?: Record<string, unknown> }> = []): Step[] {
  const steps: Step[] = [];
  for (const { type, payload: p = {} } of events) {
    if (type === "step_start") steps.push({ stepId: String(p.stepId), tool: String(p.tool), labelZh: String(p.labelZh ?? p.tool), status: "running" });
    if (type === "step_end") {
      const step = steps.find((s) => s.stepId === p.stepId);
      if (step) { step.status = p.ok ? "ok" : "fail"; step.summary = typeof p.summary === "string" ? p.summary : undefined; }
    }
  }
  return steps;
}
