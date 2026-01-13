import test from "node:test";
import assert from "node:assert/strict";

import { parseCommaList, resolveMissionFilters, missionMatchesFilters } from "../src/prepare-revenue-sweep.mjs";

test("parseCommaList trims, dedupes, and drops empties", () => {
  assert.deepEqual(parseCommaList(" a, b ,a,, "), ["a", "b"]);
});

test("resolveMissionFilters returns null sets when no filters provided", () => {
  const f = resolveMissionFilters({});
  assert.equal(f.onlyMissionIds, null);
  assert.equal(f.onlyMissionTitles, null);
});

test("missionMatchesFilters matches by id", () => {
  const filters = resolveMissionFilters({ "only-mission-ids": "id1,id2" });
  assert.equal(missionMatchesFilters({ id: "id2", title: "x" }, filters), true);
  assert.equal(missionMatchesFilters({ id: "id3", title: "x" }, filters), false);
});

test("missionMatchesFilters matches by title (case-insensitive)", () => {
  const filters = resolveMissionFilters({ "only-mission-titles": "Mission Atlas-Fund" });
  assert.equal(missionMatchesFilters({ id: "x", title: "MISSION ATLAS-FUND" }, filters), true);
  assert.equal(missionMatchesFilters({ id: "x", title: "Other" }, filters), false);
});

