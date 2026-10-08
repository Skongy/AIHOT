// Daily layout: one-line lead sentence; category quotas floor then cap (shortfall ok; overflow → flashes).
import "./setup.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { arrangeDaily, leadSentence, type EditionEntry } from "@aihot/backend/reports/edition";

function entry(id: string, category: string, importance: number, sourceId = "s1"): EditionEntry {
  return {
    entry: {
      itemId: id, factId: null, storyPublicId: null, title: id, summary: `${id}摘要。还有第二句。`,
      sourceName: "测试源", sourceUrl: `https://example.com/${id}`, sourceId, firstParty: false,
      role: "report", score: importance, publishedAt: "2026-10-08T00:00:00Z", sources: 1,
    },
    category, tags: [], storyId: null, mentions: new Set(), sourceIds: new Set([sourceId]),
    authority: 3, importance, previous: null,
  };
}

test("leadSentence keeps the first Chinese sentence", () => {
  assert.equal(leadSentence("第一句。第二句！"), "第一句。");
  assert.equal(leadSentence("Only one line"), "Only one line");
  assert.equal(leadSentence("What? More."), "What?");
});

test("without quotas arrangeDaily keeps the upstream size", () => {
  const many = Array.from({ length: 20 }, (_, i) => entry(`e${i}`, i % 2 ? "industry" : "new-games", 100 - i, `src${i}`));
  const { main, flashes } = arrangeDaily(many);
  assert.equal(main.length, 12);
  assert.ok(flashes.length > 0);
});

test("quotas meet floors when possible, cap each category, and send the rest to flashes", () => {
  const quotas = { "new-games": [2, 4] as const, esports: [2, 4] as const, industry: [3, 5] as const };
  const entries = [
    ...Array.from({ length: 8 }, (_, i) => entry(`ng${i}`, "new-games", 90 - i, `ng${i}`)),
    ...Array.from({ length: 1 }, (_, i) => entry(`es${i}`, "esports", 80 - i, `es${i}`)), // shortfall vs min 2
    ...Array.from({ length: 10 }, (_, i) => entry(`in${i}`, "industry", 70 - i, `in${i}`)),
  ];
  const { main, flashes } = arrangeDaily(entries, quotas);
  const count = (cat: string) => main.filter((e) => e.category === cat).length;
  assert.equal(count("new-games"), 4, "capped at max");
  assert.equal(count("esports"), 1, "shortfall kept, not padded");
  assert.equal(count("industry"), 5, "capped at max");
  assert.ok(flashes.length >= 8, "overflow becomes flashes");
  // Importance order: new-games first
  assert.equal(main[0]!.entry.itemId, "ng0");
});
