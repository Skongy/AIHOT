import "./setup.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  areWireCopies,
  independentEvidenceKey,
  normalizeWireText,
  wireFingerprint,
  wireSimilarity,
} from "@aihot/backend/content/wire";

const WIRE = "索尼互动娱乐今日宣布《战神》新作将于明年登陆PC，预购现已开启，支持中文。官方同时公布了配置需求与预购奖励。";

test("normalizeWireText strips URLs punctuation and case", () => {
  assert.equal(normalizeWireText("Hello, WORLD! https://x.test/a"), "helloworld");
});

test("identical wire copies share a fingerprint", () => {
  const a = wireFingerprint("《战神》新作明年登陆PC，预购开启", WIRE);
  const b = wireFingerprint("《战神》新作明年登陆PC，预购开启", WIRE);
  assert.ok(a);
  assert.equal(a, b);
});

test("lightly edited wire titles still count as copies", () => {
  assert.ok(areWireCopies(
    "【资讯】《战神》新作明年登陆PC，预购开启",
    WIRE,
    "《战神》新作明年登陆PC，预购开启",
    WIRE,
  ));
  assert.ok(wireSimilarity(
    "【资讯】《战神》新作明年登陆PC，预购开启",
    WIRE,
    "《战神》新作明年登陆PC，预购开启",
    WIRE,
  ) >= 0.88);
});

test("different stories do not collapse", () => {
  assert.equal(areWireCopies(
    "《战神》新作明年登陆PC",
    WIRE,
    "《艾尔登法环》DLC评分解禁",
    "多家媒体给出《艾尔登法环》黄金树幽影的首发评分汇总，均分超过90。",
  ), false);
});

test("thin text yields no fingerprint", () => {
  assert.equal(wireFingerprint("短", "太短"), null);
});

test("independentEvidenceKey prefers wire fingerprint", () => {
  assert.equal(independentEvidenceKey("src-a", "abc"), "wire:abc");
  assert.equal(independentEvidenceKey("src-a", null), "source:src-a");
});
