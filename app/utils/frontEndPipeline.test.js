import test from "node:test";
import assert from "node:assert/strict";

import {
  derivePrimaryPipeline,
  getPipelineTemplateForPreset,
  normalizePipelineStageList,
  serializePipelineStages,
} from "./frontEndPipeline.js";

test("normalizePipelineStageList sanitizes values, dedupes, and falls back to auto", () => {
  assert.deepEqual(normalizePipelineStageList("face, auto, face, legacy"), [
    "face",
    "auto",
  ]);
  assert.deepEqual(normalizePipelineStageList([]), ["auto"]);
});

test("getPipelineTemplateForPreset returns deterministic stage sequences", () => {
  assert.deepEqual(getPipelineTemplateForPreset("portrait"), [
    "face",
    "auto",
    "heuristic",
  ]);
  assert.deepEqual(getPipelineTemplateForPreset("unknown"), ["auto"]);
});

test("derivePrimaryPipeline and serializePipelineStages are stable", () => {
  assert.equal(derivePrimaryPipeline(["salience", "heuristic"]), "salience");
  assert.equal(derivePrimaryPipeline(""), "auto");
  assert.equal(serializePipelineStages(["salience", "salience", "auto"]), "salience,auto");
});
