// Closed alias groups for Ask keyword search. No database and no model.
import assert from "node:assert/strict";
import { test } from "node:test";
import { askSearchGroups } from "@aihot/backend/publication/ask";

test("one term can match a closed alias, and other terms stay required", () => {
  assert.deepEqual(askSearchGroups("绝地求生 联动"), [["绝地求生"], ["联动", "联名"]]);
  assert.deepEqual(askSearchGroups("PUBG Bentley"), [["pubg"], ["宾利", "bentley"]]);
  assert.deepEqual(askSearchGroups("无畏契约 冠军"), [["无畏契约"], ["冠军"]]);
  assert.deepEqual(askSearchGroups("联动活动"), [["联动活动"]]);
});
