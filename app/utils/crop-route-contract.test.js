import test from "node:test";
import assert from "node:assert/strict";
import { createCropAction } from "../lib/crop/route-action.server.js";

function buildRequestWithFormData(formData) {
  return new Request("http://localhost/crop", {
    method: "POST",
    body: formData,
  });
}

test("/app/crop and /api/crop forward identical crop options for the same payload", async () => {
  const calls = [];
  const cropImagesWithOutputs = async (files, options) => {
    calls.push({ files, options });
    return {
      status: "succeeded",
      mediaUpdates: files.map((file) => ({
        source: file.name,
        croppedImageUrl: `https://example.test/${file.name}`,
      })),
      summary: {
        requestedCount: files.length,
        succeededCount: files.length,
        failedCount: 0,
      },
      errors: [],
    };
  };

  const sharedDeps = {
    cropImagesWithOutputs,
    authenticateAdmin: async () => {},
    isPreviewRequest: () => true,
  };

  const appCropAction = createCropAction(sharedDeps);
  const apiCropAction = createCropAction(sharedDeps);

  const file = new File(["mock image bytes"], "shirt.jpg", { type: "image/jpeg" });
  const formData = new FormData();
  formData.append("file", file);
  formData.append("method", "profile");
  formData.append("pipeline", "face");
  formData.append("targetAspectRatio", "0.8");
  formData.append("marginTop", "0.1");
  formData.append("marginRight", "0.2");
  formData.append("marginBottom", "0.3");
  formData.append("marginLeft", "0.4");
  formData.append("anchorHint", "top");
  formData.append("filters", "detail,sharpen");
  formData.append("headRotationHeuristicEnabled", "true");
  formData.append("centerBiasHeuristicEnabled", "false");
  formData.append("overrideImageSizeLimit", "1");

  const appResponse = await appCropAction({ request: buildRequestWithFormData(formData) });
  const apiResponse = await apiCropAction({ request: buildRequestWithFormData(formData) });

  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].options, calls[1].options);
  assert.equal(calls[0].files[0].name, calls[1].files[0].name);

  assert.deepEqual(appResponse, apiResponse);
});
