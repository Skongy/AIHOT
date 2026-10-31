import "../../../tests/setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import Fastify from "fastify";
import { sql, closeDb } from "@aihot/backend/db";
import { ensureQueue, getBoss, stopBoss } from "@aihot/backend/jobs/queue";
import { newUuid } from "@aihot/backend/lib/ids";
import { askRunQueue } from "../server-queue.ts";
import { registerAskRoutes } from "../src/http/routes.ts";
import { createSession } from "../src/db/store.ts";

const app = Fastify();
registerAskRoutes(app);
after(async () => { await app.close(); await stopBoss(); await closeDb(); });
await ensureQueue(askRunQueue.name, askRunQueue.options);

const post = (sessionId: string, payload: unknown) => app.inject({ method: "POST", url: `/api/ask/sessions/${sessionId}/messages`, payload: payload as object });

test("concurrent different requests keep exactly one active task per session", async () => {
  const { sessionId } = await createSession();
  const responses = await Promise.all(Array.from({ length: 8 }, () => post(sessionId, { clientRequestId: newUuid(), message: "今天有哪些游戏消息？" })));
  assert.equal(responses.filter(r => r.statusCode === 200).length, 1);
  assert.equal(responses.filter(r => r.statusCode === 409).length, 7);
  const [count] = await sql`SELECT count(*)::int AS n FROM ask_tasks WHERE session_id = ${sessionId} AND status IN ('queued', 'running')`;
  assert.equal(count.n, 1);
});

test("concurrent retries reuse one task without failing the winning enqueue", async () => {
  const { sessionId } = await createSession(), clientRequestId = newUuid();
  const responses = await Promise.all(Array.from({ length: 8 }, () => post(sessionId, { clientRequestId, message: "分析近期游戏动态", mode: "deep" })));
  assert.deepEqual(responses.map(r => r.statusCode), Array(8).fill(200));
  assert.equal(new Set(responses.map(r => r.json().taskId)).size, 1);
  const rows = await sql`SELECT status FROM ask_tasks WHERE session_id = ${sessionId}`;
  assert.equal(rows.length, 1); assert.equal(rows[0].status, "queued");
  assert.equal((await sql`SELECT 1 FROM ask_messages WHERE session_id = ${sessionId}`).length, 1);
});

test("invalid message field types return 400 and create no task", async () => {
  const { sessionId } = await createSession();
  for (const payload of [{ clientRequestId: 123, message: "问题" }, { clientRequestId: newUuid(), message: {} }, { clientRequestId: [], message: "问题" }]) {
    assert.equal((await post(sessionId, payload)).statusCode, 400);
  }
  assert.equal((await sql`SELECT 1 FROM ask_tasks WHERE session_id = ${sessionId}`).length, 0);
});

test("an enqueue failure rolls back the task and message together", async () => {
  const { sessionId } = await createSession(), boss = await getBoss();
  await boss.deleteQueue(askRunQueue.name);
  try {
    assert.equal((await post(sessionId, { clientRequestId: newUuid(), message: "任务应当回滚" })).statusCode, 500);
    assert.equal((await sql`SELECT 1 FROM ask_tasks WHERE session_id = ${sessionId}`).length, 0);
    assert.equal((await sql`SELECT 1 FROM ask_messages WHERE session_id = ${sessionId}`).length, 0);
  } finally { await boss.createQueue(askRunQueue.name, askRunQueue.options); }
});
