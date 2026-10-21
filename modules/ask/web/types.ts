export type Step = { stepId: string; tool: string; labelZh: string; status: "running" | "ok" | "fail"; summary?: string };
export type Evidence = { id: number; kind?: string; title?: string | null; siteUrl?: string | null; originalUrl?: string | null; sourceName?: string | null; publishedAt?: string | null; unavailable?: boolean };
export type AskMode = "normal" | "deep";
export type ResearchStepStatus = "pending" | "running" | "done" | "skipped" | "failed";
export type ResearchStepView = { index: number; goal: string; tool: string | null; toolLabel: string | null; status: ResearchStepStatus; dependsOn: number[]; summary?: string };
export type ResearchPlanView = { version: number; steps: ResearchStepView[] };
export type Message = { key: string; role: "user" | "assistant"; text: string; taskId?: string; status?: string; steps?: Step[]; evidence?: Evidence[]; contentInvalidated?: boolean; requestId?: string; mode?: AskMode; plan?: ResearchPlanView };
export const TERMINAL = new Set(["completed", "completed_degraded", "failed", "cancelled", "limit_reached"]);

const RESEARCH_STATUS = new Set<ResearchStepStatus>(["pending", "running", "done", "skipped", "failed"]);

function researchStatus(value: unknown): ResearchStepStatus | null {
  return typeof value === "string" && RESEARCH_STATUS.has(value as ResearchStepStatus) ? value as ResearchStepStatus : null;
}

function researchStep(value: unknown): ResearchStepView | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const index = typeof row.index === "number" ? row.index : Number(row.index);
  if (!Number.isInteger(index)) return null;
  const goal = typeof row.goal === "string" ? row.goal : "";
  if (!goal) return null;
  return {
    index,
    goal,
    tool: typeof row.tool === "string" ? row.tool : null,
    toolLabel: typeof row.toolLabel === "string" ? row.toolLabel : null,
    status: researchStatus(row.status) ?? "pending",
    dependsOn: Array.isArray(row.dependsOn) ? row.dependsOn.filter((item): item is number => Number.isInteger(item)) : [],
    summary: typeof row.summary === "string" ? row.summary : undefined,
  };
}

export function snapshotSteps(events: Array<{ type: string; payload?: Record<string, unknown> }> = []): Step[] {
  const steps: Step[] = [];
  for (const { type, payload: p = {} } of events) {
    if (type === "step_start") {
      const step = { stepId: String(p.stepId), tool: String(p.tool), labelZh: String(p.labelZh ?? p.tool), status: "running" as const };
      const index = steps.findIndex((item) => item.stepId === step.stepId);
      if (index >= 0) steps[index] = { ...steps[index]!, ...step };
      else steps.push(step);
    }
    if (type === "step_end") {
      const step = steps.find((item) => item.stepId === p.stepId);
      if (step) { step.status = p.ok ? "ok" : "fail"; step.summary = typeof p.summary === "string" ? p.summary : undefined; }
    }
  }
  return steps;
}

/** Rebuild the research plan from backend events only. Later events replace earlier ones. */
export function snapshotResearch(events: Array<{ type: string; payload?: Record<string, unknown> }> = []): ResearchPlanView | undefined {
  let plan: ResearchPlanView | undefined;
  for (const event of events) plan = applyResearchEvent(plan, event.type, event.payload ?? {}) ?? plan;
  return plan;
}

export function applyResearchEvent(plan: ResearchPlanView | undefined, type: string, payload: Record<string, unknown>): ResearchPlanView | undefined {
  if (type === "research_plan" && Array.isArray(payload.steps)) {
    const steps = payload.steps.map(researchStep).filter((step): step is ResearchStepView => !!step);
    if (!steps.length) return plan;
    return { version: typeof payload.version === "number" ? payload.version : 1, steps };
  }
  if (type === "research_step" && plan) {
    const index = typeof payload.index === "number" ? payload.index : Number(payload.index);
    const status = researchStatus(payload.status);
    return {
      ...plan,
      steps: plan.steps.map((step) => step.index === index ? {
        ...step,
        status: status ?? step.status,
        summary: typeof payload.summary === "string" ? payload.summary : step.summary,
      } : step),
    };
  }
  return plan;
}

export function applyAskEvent(message: Message, type: string, payload: Record<string, unknown>): Message {
  if (payload.unavailable) return { ...message, text: "相关来源已不可用，原回答不再展示", evidence: [], steps: [], plan: undefined, contentInvalidated: true };
  if (type === "answer_delta") return { ...message, text: message.text + String(payload.text ?? "") };
  if (type === "answer_done") return { ...message, text: String(payload.text ?? message.text) };
  if (type === "task_status") return { ...message, status: String(payload.status ?? message.status) };
  if (type === "evidence") {
    const evidence = new Map((message.evidence ?? []).map((item) => [item.id, item]));
    for (const item of (payload.items ?? []) as Evidence[]) evidence.set(item.id, item);
    return { ...message, evidence: [...evidence.values()] };
  }
  if (type === "step_start") {
    const step: Step = { stepId: String(payload.stepId), tool: String(payload.tool), labelZh: String(payload.labelZh ?? payload.tool), status: "running" };
    const steps = message.steps ?? [];
    const index = steps.findIndex((item) => item.stepId === step.stepId);
    if (index >= 0) { const copy = steps.slice(); copy[index] = { ...copy[index]!, ...step }; return { ...message, steps: copy }; }
    return { ...message, steps: [...steps, step] };
  }
  if (type === "step_end") return { ...message, steps: (message.steps ?? []).map((step) => step.stepId === payload.stepId ? { ...step, status: payload.ok ? "ok" : "fail", summary: typeof payload.summary === "string" ? payload.summary : undefined } : step) };
  if (type === "research_plan" || type === "research_step") {
    const plan = applyResearchEvent(message.plan, type, payload);
    return plan ? { ...message, plan } : message;
  }
  return message;
}
