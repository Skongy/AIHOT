import type { FastifyInstance } from "fastify";
import { enqueueOn } from "@aihot/backend/jobs/queue";
import { sql } from "@aihot/backend/db";
import { askRunQueue } from "../../server-queue.ts";
import {
  createSession, createTask, findTaskByClientRequest, getSession, getTask, hasActiveTask,
  listEvidence, listEventsAfter, listMessages, markTaskEnqueueFailed, maxEventSeq,
  redactEventPayload, redactedAnswer, requestCancel,
} from "../db/store.ts";
import { sendAskProblem } from "./problem.ts";
import { attachAskSse } from "./sse.ts";
import { currentEvidence } from "../agent/evidence.ts";
import { decideAskPost } from "./decide.ts";
import { loadItemDetail } from "@aihot/backend/publication/detail";
import { config } from "@aihot/backend/config";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(v: string) {
  return UUID_RE.test(v);
}

export function registerAskRoutes(app: FastifyInstance) {
  app.get("/api/ask/capabilities", async (_req, reply) => reply.header("Cache-Control", "no-store").send({ available: config.modelCallsEnabled }));

  app.get("/api/ask/context/:articleId", async (req, reply) => {
    const { articleId } = req.params as { articleId: string };
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(articleId)) return sendAskProblem(req, reply, { status: 400, code: "invalid_request", detail: "无效的资讯地址" });
    const result = await loadItemDetail(articleId);
    if (result.kind !== "found" || result.item.readingMode === "summary-only") return sendAskProblem(req, reply, { status: 404, code: "not_found", detail: "这篇资讯已不可用，请换一个问题。" });
    return reply.header("Cache-Control", "no-store").send({ id: result.item.id, title: result.item.title, sourceName: result.item.source.name });
  });
  app.post("/api/ask/sessions", async (req, reply) => {
    const body = (req.body ?? {}) as { clientSessionId?: string };
    const created = await createSession(body.clientSessionId ?? null);
    return reply.header("Cache-Control", "no-store").send(created);
  });

  app.get("/api/ask/sessions/:sessionId", async (req, reply) => {
    const { sessionId } = req.params as { sessionId: string };
    if (!isUuid(sessionId)) return sendAskProblem(req, reply, { status: 400, code: "invalid_request", detail: "无效的 sessionId" });
    const session = await getSession(sessionId);
    if (!session) return sendAskProblem(req, reply, { status: 404, code: "session_not_found", detail: "会话不存在或已过期" });
    const messages = await listMessages(sessionId, 30);
    for (const message of messages) {
      if (message.role !== "assistant" || !message.task_id) continue;
      const task = await getTask(message.task_id);
      if (task && (await currentEvidence(task)).invalidated) message.content = "相关来源已不可用，原回答不再展示";
    }
    const active = await hasActiveTask(sessionId);
    const tasks = await sql<{ id: string; status: string; client_request_id: string }[]>`
      SELECT id::text, status, client_request_id FROM ask_tasks
      WHERE session_id = ${sessionId}::uuid ORDER BY created_at DESC LIMIT 5`;
    return reply.header("Cache-Control", "no-store").send({
      sessionId: session.id,
      expiresAt: session.expires_at.toISOString(),
      canSend: !active,
      messages: messages.map((m) => ({ id: m.id, role: m.role, content: m.content, taskId: m.task_id, createdAt: m.created_at.toISOString() })),
      recentTasks: tasks,
    });
  });

  app.post("/api/ask/sessions/:sessionId/messages", async (req, reply) => {
    const { sessionId } = req.params as { sessionId: string };
    if (!isUuid(sessionId)) return sendAskProblem(req, reply, { status: 400, code: "invalid_request", detail: "无效的 sessionId" });
    const session = await getSession(sessionId);
    if (!session) return sendAskProblem(req, reply, { status: 404, code: "session_not_found", detail: "会话不存在或已过期" });

    if (!config.modelCallsEnabled) return sendAskProblem(req, reply, { status: 503, code: "service_disabled", detail: "问答暂未开放，仍可浏览站内资讯与历史对话。" });

    const body = (req.body ?? {}) as { message?: string; clientRequestId?: string; mode?: unknown };
    const existing = body.clientRequestId ? await findTaskByClientRequest(sessionId, body.clientRequestId.trim()) : null;
    const decision = decideAskPost({
      message: body.message ?? "",
      clientRequestId: body.clientRequestId ?? "",
      mode: body.mode,
      existing,
      active: existing ? false : await hasActiveTask(sessionId),
    });
    if (decision.kind === "problem") return sendAskProblem(req, reply, decision);
    if (decision.kind === "replay") {
      return reply.header("Cache-Control", "no-store").send({ taskId: decision.taskId, status: decision.status, resumeFromSeq: 0 });
    }

    let task;
    try {
      task = await sql.begin(async (tx) => {
        const t = await createTask({ sessionId, clientRequestId: decision.clientRequestId, message: decision.message, mode: decision.mode }, tx);
        await enqueueOn(askRunQueue, { taskId: t.id }, {}, tx);
        return t;
      });
    } catch (e) {
      // Compensation if create somehow left a queued row without job.
      const orphan = await findTaskByClientRequest(sessionId, decision.clientRequestId);
      if (orphan?.status === "queued") await markTaskEnqueueFailed(orphan.id, String(e).slice(0, 300));
      return sendAskProblem(req, reply, { status: 500, code: "internal_error", detail: "创建任务失败" });
    }

    return reply.header("Cache-Control", "no-store").send({
      taskId: task.id,
      status: "queued",
      resumeFromSeq: 0,
    });
  });

  app.get("/api/ask/tasks/:taskId", async (req, reply) => {
    const { taskId } = req.params as { taskId: string };
    if (!isUuid(taskId)) return sendAskProblem(req, reply, { status: 400, code: "invalid_request", detail: "无效的 taskId" });
    const task = await getTask(taskId);
    if (!task) return sendAskProblem(req, reply, { status: 404, code: "task_not_found", detail: "任务不存在" });
    if ((await currentEvidence(task)).invalidated) task.content_invalidated = true;
    const snapshotSeq = await maxEventSeq(taskId);
    const answers = redactedAnswer(task);
    const evidence = await listEvidence(taskId);
    const evidenceView = task.content_invalidated
      ? evidence.map((e) => ({ id: e.id, kind: e.kind, unavailable: true, reason: "source_withdrawn" }))
      : evidence.map((e) => ({
          id: e.id, kind: e.kind, objectId: e.object_id, title: e.title, sourceName: e.source_name,
          publishedAt: e.published_at?.toISOString() ?? null, siteUrl: e.site_url, originalUrl: e.original_url,
          toolName: e.tool_name, publicOk: e.public_ok,
        }));
    const events = await listEventsAfter(taskId, 0, 2000);
    const steps = events
      .filter((e) => e.type === "step_start" || e.type === "step_end")
      .map((e) => ({ seq: e.seq, type: e.type, payload: redactEventPayload(task, e.type, e.payload) }));
    const research = events
      .filter((e) => e.type === "research_plan" || e.type === "research_step")
      .map((e) => ({ seq: e.seq, type: e.type, payload: redactEventPayload(task, e.type, e.payload) }));

    return reply.header("Cache-Control", "no-store").send({
      taskId: task.id,
      sessionId: task.session_id,
      mode: task.mode,
      planVersion: task.plan_version,
      status: task.status,
      modelCalls: task.model_calls,
      toolCalls: task.tool_calls,
      errorCode: task.error_code,
      errorMessage: task.error_message,
      draftAnswer: answers.draftAnswer,
      finalAnswer: answers.finalAnswer,
      contentInvalidated: answers.contentInvalidated,
      steps,
      research,
      evidence: evidenceView,
      snapshotSeq,
      receiptIds: task.active_receipt_id ? [task.active_receipt_id] : [],
      cancelRequested: task.cancel_requested,
      createdAt: task.created_at.toISOString(),
      startedAt: task.started_at?.toISOString() ?? null,
      finishedAt: task.finished_at?.toISOString() ?? null,
    });
  });

  app.get("/api/ask/tasks/:taskId/events", async (req, reply) => {
    const { taskId } = req.params as { taskId: string };
    if (!isUuid(taskId)) return sendAskProblem(req, reply, { status: 400, code: "invalid_request", detail: "无效的 taskId" });
    const task = await getTask(taskId);
    if (!task) return sendAskProblem(req, reply, { status: 404, code: "task_not_found", detail: "任务不存在" });
    if ((await currentEvidence(task)).invalidated) task.content_invalidated = true;
    return attachAskSse(req, reply, task);
  });

  app.post("/api/ask/tasks/:taskId/cancel", async (req, reply) => {
    const { taskId } = req.params as { taskId: string };
    if (!isUuid(taskId)) return sendAskProblem(req, reply, { status: 400, code: "invalid_request", detail: "无效的 taskId" });
    const task = await requestCancel(taskId);
    if (!task) {
      const cur = await getTask(taskId);
      if (!cur) return sendAskProblem(req, reply, { status: 404, code: "task_not_found", detail: "任务不存在" });
      return reply.header("Cache-Control", "no-store").send({ taskId, status: cur.status, cancelRequested: cur.cancel_requested });
    }
    return reply.header("Cache-Control", "no-store").send({ taskId, status: task.status, cancelRequested: true });
  });
}
