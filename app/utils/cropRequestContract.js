export const CROP_PIPELINES = ["auto", "face", "salience", "heuristic"];

export const CANONICAL_CROP_STATUSES = [
  "accepted",
  "pending",
  "running",
  "succeeded",
  "partial_failure",
  "failed",
];

function asStringOrNull(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized ? normalized : null;
}

function normalizeErrorObject(errorValue, fallbackCode = "unknown_error") {
  if (!errorValue) {
    return null;
  }

  if (typeof errorValue === "string") {
    const message = asStringOrNull(errorValue);
    return message ? { code: fallbackCode, message } : null;
  }

  if (typeof errorValue === "object") {
    const code = asStringOrNull(errorValue.code) || fallbackCode;
    const message =
      asStringOrNull(errorValue.message) ||
      asStringOrNull(errorValue.detail) ||
      asStringOrNull(errorValue.error);

    if (!message) {
      return null;
    }

    const sourceFilename =
      asStringOrNull(errorValue.sourceFilename) ||
      asStringOrNull(errorValue.source_filename) ||
      asStringOrNull(errorValue.file) ||
      null;

    return {
      code,
      message,
      ...(sourceFilename ? { sourceFilename } : {}),
    };
  }

  return null;
}

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

  if (["updated", "success", "ok", "completed", "succeeded"].includes(value)) {
    return "updated";
  }

  if (["failed", "error"].includes(value)) {
    return "failed";
  }

  return value;
}

function normalizeMediaUpdate(result, index, files) {
  const sourceFilename =
    asStringOrNull(result?.sourceFilename) ||
    asStringOrNull(result?.source_filename) ||
    asStringOrNull(result?.filename) ||
    files[index]?.name ||
    `image-${index + 1}`;

  return {
    mediaId:
      asStringOrNull(result?.mediaId) ||
      asStringOrNull(result?.media_id) ||
      asStringOrNull(result?.shopifyMediaId) ||
      asStringOrNull(result?.shopify_media_id) ||
      null,
    sourceMediaId:
      asStringOrNull(result?.sourceMediaId) ||
      asStringOrNull(result?.source_media_id) ||
      null,
    destinationMediaId:
      asStringOrNull(result?.destinationMediaId) ||
      asStringOrNull(result?.destination_media_id) ||
      null,
    status: normalizeMediaUpdateStatus(result?.status),
    updatedImageUrl:
      asStringOrNull(result?.updatedImageUrl) ||
      asStringOrNull(result?.updated_image_url) ||
      asStringOrNull(result?.imageUrl) ||
      asStringOrNull(result?.image_url) ||
      null,
    adminTargetUrl:
      asStringOrNull(result?.adminTargetUrl) ||
      asStringOrNull(result?.admin_target_url) ||
      asStringOrNull(result?.mediaAdminUrl) ||
      asStringOrNull(result?.media_admin_url) ||
      asStringOrNull(result?.productAdminUrl) ||
      asStringOrNull(result?.product_admin_url) ||
      null,
    sourceFilename,
    idempotencyKey:
      asStringOrNull(result?.idempotencyKey) ||
      asStringOrNull(result?.idempotency_key) ||
      null,
    mutationOutcome:
      asStringOrNull(result?.mutationOutcome) ||
      asStringOrNull(result?.mutation_outcome) ||
      null,
    error: normalizeErrorObject(result?.error, "media_update_failed"),
  };
}

export function parseCanonicalCropResponse(payload, { files = [] } = {}) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  if (!CANONICAL_CROP_STATUSES.includes(payload.status)) {
    return null;
  }

  const mediaUpdates = Array.isArray(payload.mediaUpdates)
    ? payload.mediaUpdates.map((item, index) => normalizeMediaUpdate(item, index, files))
    : [];

  const successCount = mediaUpdates.filter((item) => item.status === "updated").length;
  const failedItems = mediaUpdates.filter((item) => item.status === "failed");

  const summary = payload.summary && typeof payload.summary === "object"
    ? payload.summary
    : {};

  const requestedCount =
    Number.isInteger(summary.requestedCount) && summary.requestedCount >= 0
      ? summary.requestedCount
      : mediaUpdates.length;

  const failedCount =
    Number.isInteger(summary.failedCount) && summary.failedCount >= 0
      ? summary.failedCount
      : failedItems.length;

  const normalizedErrors = Array.isArray(payload.errors)
    ? payload.errors
        .map((entry) => normalizeErrorObject(entry, "request_failed"))
        .filter(Boolean)
    : [];

  return {
    status: payload.status,
    jobId: asStringOrNull(payload.jobId),
    mediaUpdates,
    cropSummary: {
      requestedCount,
      successCount:
        Number.isInteger(summary.successCount) && summary.successCount >= 0
          ? summary.successCount
          : successCount,
      failedCount,
      failedFiles:
        Array.isArray(summary.failedFiles) && summary.failedFiles.length
          ? summary.failedFiles.map((item) => String(item))
          : failedItems.map((item) => item.sourceFilename),
      elapsedSeconds:
        typeof summary.elapsedSeconds === "number" ? summary.elapsedSeconds : undefined,
    },
    errors: normalizedErrors,
  };
}

export function buildStoreUpdateResultContract(payload, { files = [] } = {}) {
  const canonicalResponse = parseCanonicalCropResponse(payload, { files });
  if (!canonicalResponse) {
    return null;
  }

  return {
    mode: "store-updated",
    mediaUpdates: canonicalResponse.mediaUpdates,
    cropSummary: canonicalResponse.cropSummary,
    errors: canonicalResponse.errors,
    status: canonicalResponse.status,
    jobId: canonicalResponse.jobId,
  };
}
