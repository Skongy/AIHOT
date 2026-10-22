export type Step = { stepId: string; tool: string; labelZh: string; status: "running" | "ok" | "fail"; summary?: string };
export type Evidence = { id: number; kind?: string; title?: string | null; siteUrl?: string | null; originalUrl?: string | null; sourceName?: string | null; publishedAt?: string | null; unavailable?: boolean };
export type AskMode = "normal" | "deep";
export type ResearchStepStatus = "pending" | "running" | "done" | "skipped" | "failed";
export type ResearchStepView = { index: number; goal: string; tool: string | null; toolLabel: string | null; status: ResearchStepStatus; dependsOn: number[]; summary?: string };
export type ResearchPlanView = { version: number; steps: ResearchStepView[] };
export type ReportTimelineItem = { at: string; timelineAt?: string | null; mentioned?: string | null; title: string; evidenceId: number; sourceType: string; credibility?: string };
export type ReportedItem = { id: number; title: string; sourceName: string | null; sourceType: string; siteUrl: string | null; publishedAt: string | null; timelineAt: string | null; mentioned: string | null; excerpt: string | null };
export type ReportHeatItem = { label: string; value: string; evidenceId: number };
export type ResearchReportView = {
  showTimeline?: boolean;
  showCoverage?: boolean;
  lead?: string;
  summary: string[];
  timeline: ReportTimelineItem[];
  reported?: ReportedItem[];
  coverage: { official: number; media: number; unknown: number; cited?: number };
  comparison: Array<{ text: string; evidenceIds: number[] }>;
  heat: ReportHeatItem[];
  chart: Array<{ label: string; value: number; evidenceId: number }> | null;
  uncertainty: Array<{ status: string; text: string; note: string; evidenceIds: number[] }>;
  citations: Array<{ id: number; title: string; sourceName: string | null; sourceType: string; siteUrl: string | null; publishedAt: string | null }>;
};
export type Message = { key: string; role: "user" | "assistant"; text: string; taskId?: string; status?: string; steps?: Step[]; evidence?: Evidence[]; contentInvalidated?: boolean; requestId?: string; mode?: AskMode; plan?: ResearchPlanView; report?: ResearchReportView };
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

function textList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function idList(value: unknown): number[] {
  return Array.isArray(value) ? value.filter((item): item is number => Number.isInteger(item) && item > 0) : [];
}

export function reportFromPayload(payload: Record<string, unknown>): ResearchReportView | undefined {
  const report = payload.report && typeof payload.report === "object" ? payload.report as Record<string, unknown> : payload;
  const coverage = report.coverage && typeof report.coverage === "object" ? report.coverage as Record<string, unknown> : {};
  const timeline = Array.isArray(report.timeline) ? report.timeline.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (typeof row.at !== "string" || typeof row.title !== "string" || !Number.isInteger(row.evidenceId)) return [];
    return [{
      at: row.at,
      timelineAt: typeof row.timelineAt === "string" ? row.timelineAt : null,
      mentioned: typeof row.mentioned === "string" ? row.mentioned : null,
      title: row.title,
      evidenceId: row.evidenceId as number,
      sourceType: typeof row.sourceType === "string" ? row.sourceType : "未知",
      credibility: typeof row.credibility === "string" ? row.credibility : "来源支持",
    }];
  }) : [];
  const heat = Array.isArray(report.heat) ? report.heat.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (typeof row.label !== "string" || typeof row.value !== "string" || !Number.isInteger(row.evidenceId)) return [];
    return [{ label: row.label, value: row.value, evidenceId: row.evidenceId as number }];
  }) : [];
  const chart = Array.isArray(report.chart) ? report.chart.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (typeof row.label !== "string" || typeof row.value !== "number" || !Number.isFinite(row.value) || !Number.isInteger(row.evidenceId)) return [];
    return [{ label: row.label, value: row.value, evidenceId: row.evidenceId as number }];
  }) : null;
  const rows = (value: unknown) => Array.isArray(value) ? value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (typeof row.text !== "string") return [];
    return [{ text: row.text, evidenceIds: idList(row.evidenceIds) }];
  }) : [];
  const uncertainty = Array.isArray(report.uncertainty) ? report.uncertainty.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (typeof row.text !== "string" || typeof row.note !== "string") return [];
    return [{ status: typeof row.status === "string" ? row.status : "insufficient", text: row.text, note: row.note, evidenceIds: idList(row.evidenceIds) }];
  }) : [];
  const citations = Array.isArray(report.citations) ? report.citations.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (!Number.isInteger(row.id) || typeof row.title !== "string") return [];
    return [{
      id: row.id as number,
      title: row.title,
      sourceName: typeof row.sourceName === "string" ? row.sourceName : null,
      sourceType: typeof row.sourceType === "string" ? row.sourceType : "未知",
      siteUrl: typeof row.siteUrl === "string" ? row.siteUrl : null,
      publishedAt: typeof row.publishedAt === "string" ? row.publishedAt : null,
    }];
  }) : [];
  const reported = Array.isArray(report.reported) ? report.reported.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (!Number.isInteger(row.id) || typeof row.title !== "string") return [];
    return [{
      id: row.id as number,
      title: row.title,
      sourceName: typeof row.sourceName === "string" ? row.sourceName : null,
      sourceType: typeof row.sourceType === "string" ? row.sourceType : "未知",
      siteUrl: typeof row.siteUrl === "string" ? row.siteUrl : null,
      publishedAt: typeof row.publishedAt === "string" ? row.publishedAt : null,
      timelineAt: typeof row.timelineAt === "string" ? row.timelineAt : null,
      mentioned: typeof row.mentioned === "string" ? row.mentioned : null,
      excerpt: typeof row.excerpt === "string" ? row.excerpt : null,
    }];
  }) : [];
  if (!textList(report.summary).length && !timeline.length && !citations.length && !uncertainty.length && !reported.length && typeof report.lead !== "string") return undefined;
  return {
    lead: typeof report.lead === "string" ? report.lead : undefined,
    showTimeline: typeof report.showTimeline === "boolean" ? report.showTimeline : undefined,
    showCoverage: typeof report.showCoverage === "boolean" ? report.showCoverage : undefined,
    summary: textList(report.summary),
    timeline,
    reported,
    coverage: {
      official: typeof coverage.official === "number" ? coverage.official : 0,
      media: typeof coverage.media === "number" ? coverage.media : 0,
      unknown: typeof coverage.unknown === "number" ? coverage.unknown : 0,
      cited: typeof coverage.cited === "number" ? coverage.cited : undefined,
    },
    comparison: rows(report.comparison),
    heat,
    chart: chart && chart.length >= 2 ? chart : null,
    uncertainty,
    citations,
  };
}

export function snapshotReport(events: Array<{ type: string; payload?: Record<string, unknown> }> = []): ResearchReportView | undefined {
  let report: ResearchReportView | undefined;
  for (const event of events) {
    if (event.type !== "research_report") continue;
    report = reportFromPayload(event.payload ?? {}) ?? report;
  }
  return report;
}

export function applyAskEvent(message: Message, type: string, payload: Record<string, unknown>): Message {
  if (payload.unavailable) return { ...message, text: "相关来源已不可用，原回答不再展示", evidence: [], steps: [], plan: undefined, report: undefined, contentInvalidated: true };
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
  if (type === "research_report") {
    const report = reportFromPayload(payload);
    return report ? { ...message, report } : message;
  }
  return message;
}
