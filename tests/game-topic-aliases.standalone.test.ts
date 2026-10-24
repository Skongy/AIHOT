import "./setup.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { findTopic } from "@aihot/backend/publication/topics";

test("new game topics match explicit title aliases without requiring historical reanalysis", () => {
  for (const [slug, titles] of [
    ["gta-6", ["《GTA6》新预告", "《Grand Theft Auto VI》发售消息"]],
    ["phantom-blade-zero", ["《影之刃零》实机演示", "Phantom Blade Zero gameplay"]],
    ["call-of-duty-modern-warfare-4", ["《使命召唤：现代战争4》开发消息", "《使命召唤：现代战争 4》新报道"]],
    ["cyberpunk-2077", ["《赛博朋克2077》版本更新", "Cyberpunk 2077 patch"]],
    ["mass-effect-5", ["《质量效应5》开发进展", "Mass Effect 5 news"]],
    ["zelda-ocarina-of-time", ["《塞尔达传说 时之笛》新消息", "《塞尔达传说：时之笛》版本消息"]],
  ] as const) {
    const topic = findTopic(slug)!;
    assert.ok(topic, slug);
    assert.equal(topic.entityId, null);
    assert.deepEqual(topic.tags, []);
    for (const title of titles) assert.match(title, new RegExp(topic.pattern!, "i"), slug);
  }
});

test("specific game aliases do not match generic franchises or different numbered games", () => {
  for (const [slug, titles] of [
    ["gta-6", ["GTA60 更新", "GTA 5 更新", "NEXTGTA6 新闻"]],
    ["mass-effect-5", ["质量效应系列的新消息", "质量效应 4 更新", "Mass Effect 50"]],
    ["cyberpunk-2077", ["赛博朋克：边缘行者2", "Cyberpunk 20770"]],
    ["call-of-duty-modern-warfare-4", ["使命召唤：现代战争3", "Modern Warfare 40"]],
  ] as const) {
    for (const title of titles) assert.doesNotMatch(title, new RegExp(findTopic(slug)!.pattern!, "i"));
  }
});
