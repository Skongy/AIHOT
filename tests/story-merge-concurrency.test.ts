import "./setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { newUuid } from "@aihot/backend/lib/ids";
import { sql, closeDb } from "@aihot/backend/db";
import { ensureQueue, QUEUES, stopBoss } from "@aihot/backend/jobs/queue";
import { mergeStoryInto } from "@aihot/backend/events/merge";

after(async () => { await stopBoss(); await closeDb(); });
test("opposite concurrent story merges cannot deadlock or form an alias cycle", async () => {
  await ensureQueue(QUEUES.digest);
  for (let i = 0; i < 3; i++) {
    const [a] = await sql`INSERT INTO stories (public_id,title) VALUES (${newUuid()},'Merge A') RETURNING id`;
    const [b] = await sql`INSERT INTO stories (public_id,title) VALUES (${newUuid()},'Merge B') RETURNING id`;
    const settled = await Promise.allSettled([mergeStoryInto(a.id, b.id, "test", "admin"), mergeStoryInto(b.id, a.id, "test", "admin")]);
    for (const result of settled) assert.equal(result.status, "fulfilled", result.status === "rejected" ? String(result.reason) : "merge completed");
    const results = settled.map(result => result.status === "fulfilled" ? result.value : null);
    assert.equal(results.filter(Boolean).length, 1);
    const rows = await sql`SELECT id,merged_into FROM stories WHERE id IN (${a.id},${b.id})`;
    assert.equal(rows.filter(r => r.merged_into === null).length, 1);
    assert.equal((await sql`SELECT 1 FROM story_aliases WHERE story_id IN (${a.id},${b.id})`).length, 1);
  }
});
