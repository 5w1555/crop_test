import test from "node:test";
import assert from "node:assert/strict";

import {
  applyRouteCropRequestContract,
  buildCropOptionPayload,
  buildRouteCropRequestContract,
  buildStoreUpdateResultContract,
  normalizePipeline,
  normalizePipelineStages,
  parseCanonicalCropResponse,
} from "./cropRequestContract.js";

test("normalizePipeline returns supported values", () => {
  assert.equal(normalizePipeline("face"), "face");
  assert.equal(normalizePipeline("salience"), "salience");
  assert.equal(normalizePipeline("heuristic"), "heuristic");
  assert.equal(normalizePipeline("auto"), "auto");
});

test("normalizePipeline safely migrates legacy and invalid values to auto", () => {
  assert.equal(normalizePipeline("FACE_DETECTION"), "face");
  assert.equal(normalizePipeline("legacy"), "auto");
  assert.equal(normalizePipeline(""), "auto");
  assert.equal(normalizePipeline(undefined), "auto");
});

test("buildRouteCropRequestContract serializes method, pipeline, and option values", () => {
  const formData = new FormData();
  formData.set("method", "profile");
  formData.set("pipeline", "salience");
  formData.set("pipeline_stages", "salience,heuristic");
  formData.set("target_aspect_ratio", "1:1");
  formData.set("margin_top", "0.1");
  formData.set("margin_right", "0.2");
  formData.set("margin_bottom", "0.3");
  formData.set("margin_left", "0.4");
  formData.set("anchor_hint", "center");
  formData.set("filters", "detail");
  formData.set("crop_coordinates", '{"left":0.1,"top":0.1,"width":0.8,"height":0.8}');

  const contract = buildRouteCropRequestContract(formData);

  assert.equal(contract.method, "profile");
  assert.equal(contract.pipeline, "salience");
  assert.deepEqual(contract.pipelineStages, ["salience", "heuristic"]);
});

test("normalizePipelineStages deduplicates and falls back to auto", () => {
  assert.deepEqual(normalizePipelineStages("face,face,legacy"), ["face", "auto"]);
  assert.deepEqual(normalizePipelineStages(""), ["auto"]);
});

test("parseCanonicalCropResponse parses success payload", () => {
  const payload = {
    status: "succeeded",
    jobId: "job-1",
    mediaUpdates: [
      { status: "updated", sourceFilename: "a.jpg" },
      { status: "updated", sourceFilename: "b.jpg" },
    ],
    summary: { requestedCount: 2, successCount: 2, failedCount: 0, failedFiles: [] },
    errors: [],
  };

  const result = parseCanonicalCropResponse(payload);
  assert.equal(result.jobId, "job-1");
  assert.equal(result.cropSummary.successCount, 2);
  assert.equal(result.cropSummary.failedCount, 0);
});

test("buildStoreUpdateResultContract supports partial failures", () => {
  const payload = {
    status: "partial_failure",
    jobId: "job-2",
    mediaUpdates: [
      { status: "updated", sourceFilename: "a.jpg" },
      { status: "failed", sourceFilename: "b.jpg", error: { code: "crop_failed", message: "Bad image" } },
    ],
    summary: { requestedCount: 2, successCount: 1, failedCount: 1, failedFiles: ["b.jpg"] },
    errors: [{ code: "crop_failed", message: "Bad image", sourceFilename: "b.jpg" }],
  };

  const result = buildStoreUpdateResultContract(payload, { files: [] });

  assert.equal(result.mode, "store-updated");
  assert.equal(result.mediaUpdates.length, 2);
  assert.equal(result.cropSummary.successCount, 1);
  assert.equal(result.cropSummary.failedCount, 1);
  assert.equal(result.errors.length, 1);
});

test("parseCanonicalCropResponse rejects non-canonical payloads", () => {
  assert.equal(parseCanonicalCropResponse({ downloadUrl: "https://legacy" }), null);
});


test("applyRouteCropRequestContract writes normalized option fields", () => {
  const formData = new FormData();

  applyRouteCropRequestContract(formData, {
    method: "head_bust",
    pipeline: "FACE_DETECTION",
    pipelineStages: "salience,legacy,salience",
    optionValues: {
      targetAspectRatio: "4:5",
      marginTop: "0.1",
      marginRight: "0.2",
      marginBottom: "0.3",
      marginLeft: "0.4",
      anchorHint: "center",
      filters: "detail",
      cropCoordinates: '{"left":0.1}',
    },
  });

  assert.equal(formData.get("method"), "head_bust");
  assert.equal(formData.get("pipeline"), "face");
  assert.equal(formData.get("pipeline_stages"), "salience,auto");
  assert.equal(formData.get("target_aspect_ratio"), "4:5");
});

test("buildCropOptionPayload validates and normalizes values", () => {
  const payload = buildCropOptionPayload({
    targetAspectRatio: "1:1",
    marginTop: "0",
    marginRight: "1",
    marginBottom: "2",
    marginLeft: "3",
    anchorHint: "center",
    filters: "detail,sharpen",
    cropCoordinates: '{"left":0.1,"top":0.1}',
  });

  assert.deepEqual(payload.errors, []);
  assert.equal(payload.options.targetAspectRatio, "1:1");
  assert.deepEqual(payload.options.filters, ["detail", "sharpen"]);
  assert.equal(payload.options.marginLeft, 3);
});
