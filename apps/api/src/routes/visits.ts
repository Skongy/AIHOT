import type { FastifyInstance } from "fastify";
import { config } from "@aihot/backend/config";
import { recordVisit, visitIp, visitPath } from "@aihot/backend/operations/visits";

export function registerVisits(app: FastifyInstance) {
  // Bounded per-process protection: metrics are best effort, never a reason to block reading.
  const clients = new Map<string, number>();
  let minute = 0;
  let total = 0;
  let pending = 0;
  app.post("/api/site/visit", { bodyLimit: 2048 }, async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    if (req.headers.origin !== new URL(config.siteUrl).origin || (req.headers["sec-fetch-site"] && req.headers["sec-fetch-site"] !== "same-origin")) {
      return reply.code(403).send();
    }
    const body = req.body as { path?: unknown; referrer?: unknown } | null;
    const path = visitPath(body?.path);
    const ip = visitIp(req.headers["x-forwarded-for"] as string | undefined, req.raw.socket.remoteAddress ?? "");
    if (!path || !ip) return reply.code(400).send();
    const now = Math.floor(Date.now() / 60000);
    if (now !== minute) { minute = now; total = 0; clients.clear(); }
    const count = clients.get(ip) ?? 0;
    if (total >= 600 || count >= 60 || pending >= 10) return reply.header("Retry-After", "60").code(429).send();
    total++;
    clients.set(ip, count + 1);
    pending++;
    try {
      await recordVisit({ ip, path, referrer: body?.referrer, userAgent: String(req.headers["user-agent"] ?? "") });
      return reply.code(204).send();
    } catch (err) {
      req.log.error({ err }, "visit recording failed");
      return reply.code(503).send();
    } finally { pending--; }
  });
}
