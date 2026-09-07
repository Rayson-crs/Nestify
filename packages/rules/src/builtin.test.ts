import assert from "node:assert/strict";
import test from "node:test";
import { getBuiltinProfile, listBuiltinProfiles } from "./load.ts";

test("download-inbox has five rules and rule 4 disabled", () => {
  const profile = getBuiltinProfile("download-inbox");
  assert.ok(profile);
  assert.equal(profile.rules.length, 5);
  assert.deepEqual(
    profile.rules.map((rule) => rule.priority),
    [1, 2, 3, 4, 5],
  );
  const moveVideos = profile.rules.find((rule) => rule.id === "move-videos-to-videos-folder");
  assert.equal(moveVideos?.enabled, false);
});

test("media-rename has grandparent template", () => {
  const profile = getBuiltinProfile("media-rename");
  assert.ok(profile);
  assert.equal(profile.rules[0]?.template, "{grandparent}{ext}");
  assert.equal(listBuiltinProfiles().length, 2);
});
