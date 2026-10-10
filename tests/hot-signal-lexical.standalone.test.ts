// Hot-list matching without embeddings: seed patterns + lexical bar stay conservative (宁漏勿误报).
import assert from "node:assert/strict";
import { test } from "node:test";
import { HOT_SEED_ENTITY_IDS, SELECTION } from "@aihot/industry/selection";
import { IDENTITY_LEXICON } from "@aihot/industry/taxonomy";
import { lexicalSimilarity } from "@aihot/backend/events/relate";

const SEED_PATTERNS = IDENTITY_LEXICON.filter((e) => (HOT_SEED_ENTITY_IDS as readonly string[]).includes(e.id));
const seedIdsIn = (text: string) => SEED_PATTERNS.filter((e) => e.patterns.some((p) => p.test(text))).map((e) => e.id);

test("T1/T1_5 stay below T2 after game retarget", () => {
  assert.ok(SELECTION.thresholds.T1! < SELECTION.thresholds.T2!);
  assert.ok(SELECTION.thresholds.T1_5! < SELECTION.thresholds.T2!);
  assert.ok(SELECTION.thresholds.T1! <= SELECTION.thresholds.T1_5!);
  assert.ok(SELECTION.understandFloor < SELECTION.thresholds.T1!);
});

test("seed patterns catch Chinese and Latin hot words, not entertainment", () => {
  assert.deepEqual(seedIdsIn("博德之门3新DLC"), ["baldurs-gate-3"]);
  assert.deepEqual(seedIdsIn("BG3 patch notes"), ["baldurs-gate-3"]);
  assert.deepEqual(seedIdsIn("杀戮尖塔2发售日"), ["slay-the-spire-2"]);
  assert.deepEqual(seedIdsIn("STS2 Early Access"), ["slay-the-spire-2"]);
  assert.deepEqual(seedIdsIn("以撒的结合新道具"), ["binding-of-isaac-rebirth"]);
  assert.deepEqual(seedIdsIn("喵喵的结合 demo"), ["mewgenics"]);
  assert.deepEqual(seedIdsIn("管泽元Bin聊S赛新版本"), []);
  assert.deepEqual(seedIdsIn("杜兰特徐静雨签和解协议"), []);
});

test("lexical overlap alone is weak across languages; seed co-mention is the bridge", () => {
  assert.ok(lexicalSimilarity("博德之门3新DLC公布", "《博德之门 3》宣布新DLC并开放预购") >= 0.3);
  assert.ok(lexicalSimilarity("BG3", "Baldur's Gate 3 community update") < 0.25);
  assert.ok(seedIdsIn("BG3").length && seedIdsIn("Baldur's Gate 3 community update").length);
});
