import test from "node:test";
import assert from "node:assert/strict";

import {
  buildRouteCropRequestContract,
  buildStoreUpdateResultContract,
  normalizePipeline,
  normalizePipelineStages,
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
  assert.deepEqual(contract.optionValues, {
    targetAspectRatio: "1:1",
    marginTop: "0.1",
    marginRight: "0.2",
    marginBottom: "0.3",
    marginLeft: "0.4",
    anchorHint: "center",
    filters: "detail",
    cropCoordinates: '{"left":0.1,"top":0.1,"width":0.8,"height":0.8}',
  });
});

test("buildRouteCropRequestContract normalizes unknown pipeline to auto", () => {
  const formData = new FormData();
  formData.set("pipeline", "not-real");

  const contract = buildRouteCropRequestContract(formData);

  assert.equal(contract.method, "auto");
  assert.equal(contract.pipeline, "auto");
  assert.deepEqual(contract.pipelineStages, ["auto"]);
});

test("normalizePipelineStages deduplicates and falls back to auto", () => {
  assert.deepEqual(normalizePipelineStages("face,face,legacy"), ["face", "auto"]);
  assert.deepEqual(normalizePipelineStages(""), ["auto"]);
});

test("buildStoreUpdateResultContract supports store-updated payloads", () => {
  const payload = {
    store_updated_results: [
      {
        media_id: "gid://shopify/MediaImage/1",
        status: "success",
        updated_image_url: "https://cdn.example.com/a.jpg",
        admin_target_url: "https://admin.shopify.com/store/test/products/1",
        source_filename: "a.jpg",
      },
      {
        media_id: "gid://shopify/MediaImage/2",
        status: "failed",
        error: "Image update failed",
        source_filename: "b.jpg",
      },
    ],
  };

  const result = buildStoreUpdateResultContract(payload, { files: [] });

  assert.equal(result.mode, "store-updated");
  assert.equal(result.mediaUpdates.length, 2);
  assert.equal(result.cropSummary.successCount, 1);
  assert.equal(result.cropSummary.failedCount, 1);
  assert.deepEqual(result.cropSummary.failedFiles, ["b.jpg"]);
});

test("buildStoreUpdateResultContract provides legacy zip compatibility", () => {
  const result = buildStoreUpdateResultContract(
    {
      downloadUrl: "https://files.example.com/cropped.zip",
      filename: "cropped.zip",
      expiresIn: 120,
    },
    {
      files: [{ name: "first.jpg" }, { name: "second.jpg" }],
    },
  );

  assert.equal(result.mode, "zip-compat");
  assert.equal(result.mediaUpdates.length, 2);
  assert.equal(result.mediaUpdates[0].status, "legacy_zip_only");
  assert.equal(result.legacyZip.downloadUrl, "https://files.example.com/cropped.zip");
  assert.equal(result.cropSummary.successCount, 2);
});
