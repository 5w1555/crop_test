export const CROP_PIPELINES = ["auto", "face", "salience", "heuristic"];
export const ANCHOR_HINT_OPTIONS = ["auto", "top", "center", "bottom", "left", "right"];
export const SUPPORTED_FILTERS = ["sharpen", "detail", "grayscale"];

export const DEFAULT_CROP_OPTION_VALUES = {
  targetAspectRatio: "",
  marginTop: "",
  marginRight: "",
  marginBottom: "",
  marginLeft: "",
  anchorHint: "",
  filters: "",
  cropCoordinates: "",
};

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

export function applyRouteCropRequestContract(
  formData,
  { method = "auto", pipeline = "auto", pipelineStages, optionValues = DEFAULT_CROP_OPTION_VALUES } = {},
) {
  const normalizedPipeline = normalizePipeline(pipeline);
  const normalizedPipelineStages = normalizePipelineStages(pipelineStages || normalizedPipeline);

  formData.set("method", String(method || "auto"));
  formData.set("pipeline", normalizedPipeline);
  formData.set("pipeline_stages", normalizedPipelineStages.join(","));
  formData.set("target_aspect_ratio", String(optionValues.targetAspectRatio || ""));
  formData.set("margin_top", String(optionValues.marginTop || ""));
  formData.set("margin_right", String(optionValues.marginRight || ""));
  formData.set("margin_bottom", String(optionValues.marginBottom || ""));
  formData.set("margin_left", String(optionValues.marginLeft || ""));
  formData.set("anchor_hint", String(optionValues.anchorHint || ""));
  formData.set("filters", String(optionValues.filters || ""));
  formData.set("crop_coordinates", String(optionValues.cropCoordinates || ""));

  return formData;
}

function normalizeTargetAspectRatio(rawValue) {
  const value = String(rawValue || "").trim();
  if (!value) return { value: "", error: null };
  const ratioParts = value.split(":");
  if (ratioParts.length > 2) {
    return { value, error: "Aspect ratio must be a single number (e.g. 1.5) or W:H (e.g. 4:5)." };
  }
  const parsedNumbers = ratioParts.map((part) => Number(part.trim()));
  if (parsedNumbers.some((part) => !Number.isFinite(part) || part <= 0)) {
    return { value, error: "Aspect ratio values must be positive numbers." };
  }
  return { value, error: null };
}

function normalizeMarginValue(rawValue, label) {
  const value = String(rawValue || "").trim();
  if (!value) return { value: "", numericValue: null, error: null };
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue < 0) {
    return { value, numericValue: null, error: `${label} must be a non-negative number.` };
  }
  return { value, numericValue, error: null };
}

function normalizeAnchorHint(rawValue) {
  const value = String(rawValue || "").trim().toLowerCase();
  if (!value) return { value: "", error: null };
  if (!ANCHOR_HINT_OPTIONS.includes(value)) {
    return { value, error: `Anchor hint must be one of: ${ANCHOR_HINT_OPTIONS.join(", ")}.` };
  }
  return { value, error: null };
}

function normalizeFilters(rawValue) {
  const value = String(rawValue || "").trim();
  if (!value) return { value: "", normalizedFilters: [], error: null };
  const normalizedFilters = value.split(",").map((entry) => entry.trim().toLowerCase()).filter(Boolean);
  const invalidFilters = normalizedFilters.filter((entry) => !SUPPORTED_FILTERS.includes(entry));
  if (invalidFilters.length) {
    return { value, normalizedFilters: [], error: `Unsupported filters: ${invalidFilters.join(", ")}. Allowed: ${SUPPORTED_FILTERS.join(", ")}.` };
  }
  return { value, normalizedFilters, error: null };
}

function normalizeCropCoordinates(rawValue) {
  const value = String(rawValue || "").trim();
  if (!value) return { value: "", coordinates: undefined, error: null };
  let parsed;
  try { parsed = JSON.parse(value); } catch {
    return { value, coordinates: undefined, error: "Crop coordinates must be valid JSON." };
  }
  if (!parsed || typeof parsed !== "object") {
    return { value, coordinates: undefined, error: "Crop coordinates must be a JSON object." };
  }
  return { value, coordinates: parsed, error: null };
}

export function buildCropOptionPayload(values = DEFAULT_CROP_OPTION_VALUES) {
  const targetAspectRatio = normalizeTargetAspectRatio(values.targetAspectRatio);
  const marginTop = normalizeMarginValue(values.marginTop, "Top margin/padding");
  const marginRight = normalizeMarginValue(values.marginRight, "Right margin/padding");
  const marginBottom = normalizeMarginValue(values.marginBottom, "Bottom margin/padding");
  const marginLeft = normalizeMarginValue(values.marginLeft, "Left margin/padding");
  const anchorHint = normalizeAnchorHint(values.anchorHint);
  const filters = normalizeFilters(values.filters);
  const cropCoordinates = normalizeCropCoordinates(values.cropCoordinates);

  const errors = [targetAspectRatio.error, marginTop.error, marginRight.error, marginBottom.error, marginLeft.error, anchorHint.error, filters.error, cropCoordinates.error].filter(Boolean);

  return {
    errors,
    options: {
      targetAspectRatio: targetAspectRatio.value || undefined,
      marginTop: marginTop.numericValue,
      marginRight: marginRight.numericValue,
      marginBottom: marginBottom.numericValue,
      marginLeft: marginLeft.numericValue,
      anchorHint: anchorHint.value || undefined,
      filters: filters.normalizedFilters.length ? filters.normalizedFilters : undefined,
      cropCoordinates: cropCoordinates.coordinates,
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
