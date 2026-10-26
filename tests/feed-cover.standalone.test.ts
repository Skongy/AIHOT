import assert from "node:assert/strict";
import { test } from "node:test";
import { toFeedItemSummary, type ItemRow } from "@aihot/backend/publication/items";
import { verifyProxyRequest } from "@aihot/backend/media/imgproxy";

const image = { kind: "image", url: "https://example.org/game.jpg", width: 1280, height: 720 };
const row: ItemRow = {
  id: "cover-fixture", title: "Game news", summary: "Summary", reason: null,
  category: null, tags: [], score: 75, selected: true, channel: "news", url: "https://example.org/news",
  published_at: new Date(), discovered_at: new Date(), timeline_at: new Date(),
  seat: true, body_mode: "full", source_name: "Fixture", source_tier: "T1",
  x_post: null, article_media: [image],
  original_title: null, visibility: "public", indexable: true, fact_id: null,
  source_mode: "editorial", author: null, language: "zh", story_public_id: null,
  story_title: null, zh_text: null, quoted_zh: null,
};

test("feed images use one real article image and independently signed small candidates", () => {
  const cover = toFeedItemSummary({ ...row, article_media: [
    { kind: "image", url: "https://example.org/pixel.gif", width: 1, height: 1 },
    { kind: "video", url: "https://example.org/trailer" },
    { kind: "image", url: "https://youtube.com/watch?v=fixture" },
    image,
    { ...image, url: "https://example.org/second.jpg" },
  ] }).cover;
  assert.ok(cover);
  assert.equal(cover.width, 1280);
  assert.equal(cover.height, 720);
  for (const entry of [cover.url, ...cover.srcSet!.split(", ").map(s => s.split(" ")[0]!)]) {
    const params = Object.fromEntries(new URL(entry, "http://localhost").searchParams);
    assert.equal(params.u, image.url);
    assert.equal(verifyProxyRequest(params).ok, true);
    assert.ok(["card", "thumb"].includes(params.mode!));
  }
});

test("summary-only and X reports never expose article body images", () => {
  assert.equal(toFeedItemSummary({ ...row, body_mode: "summary" }).cover, null);
  assert.equal(toFeedItemSummary({ ...row, channel: "x" }).cover, null);
});

test("missing media stays text-only and unknown dimensions can still show a real image", () => {
  for (const media of [null, undefined, [], [{ kind: "image", url: "javascript:alert(1)" }]]) {
    assert.equal(toFeedItemSummary({ ...row, article_media: media }).cover, null);
  }
  const cover = toFeedItemSummary({ ...row, article_media: [{ kind: "image", url: image.url }] }).cover;
  assert.ok(cover);
  assert.equal(cover.width, null);
  assert.equal(cover.height, null);
});
