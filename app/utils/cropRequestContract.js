export const CROP_PIPELINES = ["auto", "face", "salience", "heuristic"];

export function normalizePipeline(rawValue) {
  const value = String(rawValue || "")
    .trim()
    .toLowerCase();

  if (!value) {
    return "auto";
  }

  if (CROP_PIPELINES.includes(value)) {
    return value;
  }

  if (value === "face_detection") {
    return "face";
  }

  return "auto";
}

export function normalizePipelineStages(rawValue) {
  const values = Array.isArray(rawValue)
    ? rawValue
    : String(rawValue || "")
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);

  const normalized = [];

  for (const value of values) {
    const stage = normalizePipeline(value);
    if (!normalized.includes(stage)) {
      normalized.push(stage);
    }
  }

  return normalized.length ? normalized : ["auto"];
}

export function buildRouteCropRequestContract(formData) {
  const pipeline = normalizePipeline(formData.get("pipeline"));
  const pipelineStages = normalizePipelineStages(
    formData.get("pipeline_stages") || pipeline,
  );

  return {
    method: String(formData.get("method") || "auto"),
    pipeline: pipelineStages[0] || pipeline,
    pipelineStages,
    optionValues: {
      targetAspectRatio: String(formData.get("target_aspect_ratio") || ""),
      marginTop: String(formData.get("margin_top") || ""),
      marginRight: String(formData.get("margin_right") || ""),
      marginBottom: String(formData.get("margin_bottom") || ""),
      marginLeft: String(formData.get("margin_left") || ""),
      anchorHint: String(formData.get("anchor_hint") || ""),
      filters: String(formData.get("filters") || ""),
      cropCoordinates: String(formData.get("crop_coordinates") || ""),
    },
  };
}

function normalizeMediaUpdateStatus(rawStatus) {
  const value = String(rawStatus || "").trim().toLowerCase();
  if (!value) {
    return "unknown";
  }

  if (["updated", "success", "ok", "completed"].includes(value)) {
    return "updated";
  }

  if (["failed", "error"].includes(value)) {
    return "failed";
  }

  return value;
}

function normalizeStoreUpdateResult(result, index, files) {
  return {
    mediaId:
      result?.mediaId ||
      result?.media_id ||
      result?.shopifyMediaId ||
      result?.shopify_media_id ||
      null,
    status: normalizeMediaUpdateStatus(result?.status),
    updatedImageUrl:
      result?.updatedImageUrl ||
      result?.updated_image_url ||
      result?.imageUrl ||
      result?.image_url ||
      null,
    adminTargetUrl:
      result?.adminTargetUrl ||
      result?.admin_target_url ||
      result?.mediaAdminUrl ||
      result?.media_admin_url ||
      result?.productAdminUrl ||
      result?.product_admin_url ||
      null,
    sourceFilename:
      result?.sourceFilename ||
      result?.source_filename ||
      result?.filename ||
      files[index]?.name ||
      `image-${index + 1}`,
    error: result?.error || null,
  };
}

export function buildStoreUpdateResultContract(payload, { files = [] } = {}) {
  const candidateResults =
    payload?.storeUpdatedResults ||
    payload?.store_updated_results ||
    payload?.updatedMedia ||
    payload?.updated_media ||
    payload?.mediaUpdates ||
    payload?.media_updates ||
    payload?.results;

  if (Array.isArray(candidateResults) && candidateResults.length > 0) {
    const mediaUpdates = candidateResults.map((result, index) =>
      normalizeStoreUpdateResult(result, index, files),
    );

    const successCount = mediaUpdates.filter((result) => result.status === "updated").length;
    const failedItems = mediaUpdates.filter((result) => result.status === "failed");

    return {
      mode: "store-updated",
      mediaUpdates,
      cropSummary: {
        requestedCount: mediaUpdates.length,
        successCount,
        failedCount: failedItems.length,
        failedFiles: failedItems.map((result) => result.sourceFilename),
      },
      legacyZip: null,
    };
  }

  if (payload?.downloadUrl) {
    return {
      mode: "zip-compat",
      mediaUpdates: files.map((file, index) => ({
        mediaId: null,
        status: "legacy_zip_only",
        updatedImageUrl: null,
        adminTargetUrl: null,
        sourceFilename: file?.name || `image-${index + 1}`,
        error: null,
      })),
      cropSummary: {
        requestedCount: files.length,
        successCount: files.length,
        failedCount: 0,
        failedFiles: [],
      },
      legacyZip: {
        downloadUrl: payload.downloadUrl,
        filename: payload.filename || "cropped_batch.zip",
        expiresIn: payload.expiresIn || 600,
      },
    };
  }

  return null;
}
