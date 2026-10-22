import { defineQueue } from "@aihot/backend/modules";
import { runAskTask } from "./src/agent/loop.ts";
import { hostname } from "node:os";
import { randomUUID } from "node:crypto";

export interface AskRunJob {
  taskId: string;
}

const workerId = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;

export const askRunQueue = defineQueue<AskRunJob>({
  name: "ask.run",
  options: {
    policy: "short",
    retryLimit: 2,
    // The task lease is 60s. A retry that arrives before it expires cannot claim the row, and that
    // attempt is still completed, so the checkpoint would never run again. Keep the delay above the lease.
    // Heartbeats fail a dead process on the supervisor's pass. Without them the job stayed active until
    // expireInSeconds, and 600s plus this delay was the 12 minute wait seen on 2026-10-22.
    retryDelay: 90,
    expireInSeconds: 600,
    heartbeatSeconds: 30,
  },
  worker: { batchSize: 1, pollingIntervalSeconds: 1 },
  run: async (jobs) => {
    for (const job of jobs) {
      await runAskTask({ taskId: job.taskId, workerId });
    }
    return { ok: true, n: jobs.length };
  },
});
