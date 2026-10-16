import { loadItemDetail } from "@aihot/backend/publication/detail";
import { resolveStory, v1Story } from "@aihot/backend/publication/stories";
import { dailyWithNotes } from "@aihot/backend/publication/reports";
import { listEvidence, markInvalidated, type TaskRow } from "../db/store.ts";

/** Recheck public scope on resume/history reads, not just when evidence was first collected. */
export async function currentEvidence(task: TaskRow) {
  const evidence = await listEvidence(task.id);
  if (task.content_invalidated) return { invalidated: true, evidence: [] };
  for (const e of evidence) {
    let available = e.public_ok;
    if (available && (e.kind === "item" || e.kind === "selection_explain")) {
      const detail = e.object_id ? await loadItemDetail(e.object_id) : null;
      available = detail?.kind === "found" && detail.item.readingMode !== "summary-only";
    } else if (available && (e.kind === "story" || e.kind === "hot_explain")) {
      let story = e.object_id ? await resolveStory(e.object_id) : null;
      if (story?.kind === "merged") story = await resolveStory(story.target);
      available = story?.kind === "found" && !!(await v1Story(story.storyId));
    } else if (available && e.kind === "tool_note") {
      available = !!e.object_id && !!(await dailyWithNotes(e.object_id));
    }
    if (!available) {
      await markInvalidated(task.id);
      return { invalidated: true, evidence: [] };
    }
  }
  return { invalidated: false, evidence };
}

export function historySources(evidence: Array<Awaited<ReturnType<typeof listEvidence>>[number]>) {
  return evidence.slice(0, 30).map((e) => ({ previousCitation: e.id, kind: e.kind, objectId: e.object_id,
    title: e.title, siteUrl: e.site_url, source: e.source_name, publishedAt: e.published_at?.toISOString() ?? null }));
}
