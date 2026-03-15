import { authenticate } from "../shopify.server";
import { buildPlanView } from "../utils/plan.js";
import { getShopPlanUsage, reservePlanCapacity } from "../utils/plan.server.js";
import { createCropJob } from "../utils/cropJobs.server.js";
import { getBillingState } from "../utils/billing.server";
import { buildFilesFromMediaSources, resolveSelectedMedia } from "../utils/shopifyMedia.server";
import { buildRouteCropRequestContract } from "../utils/cropRequestContract.js";

const ANCHOR_HINT_OPTIONS = ["auto", "top", "center", "bottom", "left", "right"];
const SUPPORTED_FILTERS = ["sharpen", "detail", "grayscale"];

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

function buildCropOptionPayload(values) {
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

function validateImageFile(file) {
  if (!(file instanceof File)) return "Please upload an image.";
  if (!file.type.startsWith("image/")) return "Only image files are supported.";
  return null;
}

function jsonError(error, status = 400, extra = {}) {
  return Response.json({ error, ...extra }, { status });
}

export const loader = async ({ request }) => {
  const { session, billing } = await authenticate.admin(request);
  const billingState = await getBillingState({ billing });
  const planUsage = buildPlanView(await getShopPlanUsage(session.shop, { hasActiveProPlan: billingState.hasActivePayment }));
  const appOrigin = new URL(request.url).origin;
  return { planUsage, hasActiveProPlan: billingState.hasActivePayment, appOrigin };
};

export const action = async ({ request }) => {
  const { session, billing, admin } = await authenticate.admin(request);
  const startedAt = Date.now();
  const formData = await request.formData();
  const files = formData.getAll("file");
  const selectedMediaIds = formData.getAll("selected_media_id").map((value) => String(value || "").trim()).filter(Boolean);
  const selectedProductIds = formData.getAll("selected_product_id").map((value) => String(value || "").trim()).filter(Boolean);

  if (!selectedMediaIds.length && !files.length) {
    return jsonError("Please select at least one Shopify media item or upload an image.");
  }

  let resolvedMedia = [];
  if (selectedMediaIds.length) {
    const mediaResult = await resolveSelectedMedia({
      admin,
      mediaIds: selectedMediaIds,
      productIds: selectedProductIds,
    });
    if (mediaResult.invalidMediaIds.length) {
      return jsonError("Some selected media items are unavailable or do not belong to this shop.", 403, { invalidMediaIds: mediaResult.invalidMediaIds });
    }
    resolvedMedia = mediaResult.media;
  }

  const uploadedFiles = [];
  for (const file of files) {
    const fileError = validateImageFile(file);
    if (fileError) return jsonError(`${file instanceof File ? file.name : "File"}: ${fileError}`);
    uploadedFiles.push(file);
  }

  const mediaSourceFiles = resolvedMedia.length ? await buildFilesFromMediaSources(resolvedMedia) : [];
  const filesForCrop = mediaSourceFiles.length ? mediaSourceFiles : uploadedFiles;

  const { method, pipeline, optionValues } = buildRouteCropRequestContract(formData);
  const optionPayload = buildCropOptionPayload(optionValues);
  if (optionPayload.errors.length) return jsonError(optionPayload.errors.join(" "));

  const billingState = await getBillingState({ billing });
  const planReservation = await reservePlanCapacity({
    shop: session.shop,
    imageCount: filesForCrop.length,
    method,
    hasActiveProPlan: billingState.hasActivePayment,
  });
  if (!planReservation.ok) return jsonError(planReservation.error, 403, { plan: planReservation.plan });

  const jobId = await createCropJob({
    shop: session.shop,
    admin,
    files: filesForCrop,
    startedAt,
    mediaTargets: resolvedMedia,
    options: { method: planReservation.effectiveMethod, pipeline, ...optionPayload.options },
  });

  return Response.json({
    status: "accepted",
    jobId,
    mediaUpdates: [],
    summary: { requestedCount: filesForCrop.length, successCount: 0, failedCount: 0, failedFiles: [] },
    errors: [],
  }, { status: 202 });
};
