import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLoaderData, useRouteError } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { PLAN_CONFIG, buildPlanView } from "../utils/plan.js";
import {
  commitPlanUsage,
  getShopPlanUsage,
  reservePlanCapacity,
} from "../utils/plan.server.js";
import { cropImages } from "../utils/smartCropClient";
import { getBillingState } from "../utils/billing.server";
import { PRO_PLAN } from "../utils/billing";
import {
  buildRouteCropRequestContract,
  normalizePipeline,
} from "../utils/cropRequestContract.js";

const CROP_METHODS = [
  {
    value: "auto",
    label: "Auto",
    description:
      "Automatically chooses frontal/profile logic and uses center/content fallback when no face is detected.",
  },
  {
    value: "head_bust",
    label: "Head bust",
    description:
      "Portrait-focused crop intended for head and shoulders framing.",
  },
  {
    value: "frontal",
    label: "Frontal",
    description:
      "Best when the face looks straight at the camera and both eyes are visible.",
  },
  {
    value: "profile",
    label: "Profile",
    description:
      "Optimized for side-profile shots where one side of the face is dominant.",
  },
  {
    value: "chin",
    label: "Chin",
    description: "Crops with an emphasis around the jaw/chin region.",
  },
  {
    value: "nose",
    label: "Nose",
    description: "Centers the crop relative to nose landmarks.",
  },
  {
    value: "below_lips",
    label: "Below lips",
    description:
      "Anchors composition just below the lips for tighter portrait crops.",
  },
];

const PRESET_OPTIONS = [
  {
    value: "auto",
    label: "Auto (recommended)",
    method: "auto",
    description:
      "Best default for mixed catalog uploads. The app decides the crop strategy.",
  },
  {
    value: "portrait",
    label: "Portrait",
    method: "head_bust",
    description: "Head-and-shoulders framing for model and profile imagery.",
  },
  {
    value: "product",
    label: "Product",
    method: "auto",
    description:
      "Balanced product framing with content fallback when no face is present.",
  },
  {
    value: "square",
    label: "Square",
    method: "chin",
    description:
      "Tighter composition preferred for social grids and square presentation.",
  },
];

const ANCHOR_HINT_OPTIONS = [
  "auto",
  "top",
  "center",
  "bottom",
  "left",
  "right",
];
const SUPPORTED_FILTERS = ["sharpen", "detail", "grayscale"];
const PREFERENCE_STORAGE_KEY = "crop.additional.preferences";
const PRESET_ASPECT_RATIO_HINTS = {
  portrait: 4 / 5,
  square: 1,
  product: 1,
};
const METHOD_ASPECT_RATIO_HINTS = {
  head_bust: 4 / 5,
  frontal: 4 / 5,
  profile: 4 / 5,
  chin: 1,
  nose: 1,
  below_lips: 1,
  center_content: 1,
};
const PIPELINE_OPTIONS = [
  {
    value: "auto",
    label: "Auto",
    description:
      "Recommended for most batches. Smart Crop chooses the best pipeline per image.",
  },
  {
    value: "face",
    label: "Face",
    description:
      "Use for portrait-heavy sets where a visible face should drive composition.",
  },
  {
    value: "salience",
    label: "Salience",
    description:
      "Use for products and objects when visual attention (not faces) should lead framing.",
  },
  {
    value: "heuristic",
    label: "Heuristic",
    description:
      "Use for deterministic fallback behavior when you need consistent non-ML crop logic.",
  },
];
const MIN_CROP_SIZE_FRACTION = 0.05;
const CROP_COORDINATE_EPSILON = 0.001;
const CROP_RESIZE_HIT_SIZE_PX = 14;
const CROP_RESIZE_HANDLES = [
  "n",
  "s",
  "e",
  "w",
  "nw",
  "ne",
  "sw",
  "se",
];

function parseCropSummaryHeader(rawSummary) {
  if (!rawSummary) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawSummary);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    const successCount = Number(parsed.successCount);
    const failedCount = Number(parsed.failedCount);
    const elapsedSeconds = Number(parsed.elapsedSeconds);
    const failedFiles = Array.isArray(parsed.failedFiles)
      ? parsed.failedFiles
          .map((entry) => {
            if (typeof entry === "string") {
              return entry;
            }

            if (entry && typeof entry === "object") {
              if (typeof entry.filename === "string") return entry.filename;
              if (typeof entry.file_name === "string") return entry.file_name;
              if (typeof entry.name === "string") return entry.name;
            }

            return null;
          })
          .filter(Boolean)
      : [];

    return {
      successCount: Number.isFinite(successCount) ? successCount : 0,
      failedCount: Number.isFinite(failedCount) ? failedCount : 0,
      elapsedSeconds: Number.isFinite(elapsedSeconds) ? elapsedSeconds : null,
      failedFiles,
    };
  } catch {
    return null;
  }
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) {
    return min;
  }

  if (value < min) {
    return min;
  }

  if (value > max) {
    return max;
  }

  return value;
}

function normalizeTargetAspectRatio(rawValue) {
  const value = String(rawValue || "").trim();
  if (!value) {
    return { value: "", error: null };
  }

  const ratioParts = value.split(":");
  if (ratioParts.length > 2) {
    return {
      value,
      error:
        "Aspect ratio must be a single number (e.g. 1.5) or W:H (e.g. 4:5).",
    };
  }

  const parsedNumbers = ratioParts.map((part) => Number(part.trim()));
  if (parsedNumbers.some((part) => !Number.isFinite(part) || part <= 0)) {
    return {
      value,
      error: "Aspect ratio values must be positive numbers.",
    };
  }

  return { value, error: null };
}

function normalizeMarginValue(rawValue, label) {
  const value = String(rawValue || "").trim();
  if (!value) {
    return { value: "", numericValue: null, error: null };
  }

  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue < 0) {
    return {
      value,
      numericValue: null,
      error: `${label} must be a non-negative number.`,
    };
  }

  return { value, numericValue, error: null };
}

function normalizeAnchorHint(rawValue) {
  const value = String(rawValue || "")
    .trim()
    .toLowerCase();
  if (!value) {
    return { value: "", error: null };
  }

  if (!ANCHOR_HINT_OPTIONS.includes(value)) {
    return {
      value,
      error: `Anchor hint must be one of: ${ANCHOR_HINT_OPTIONS.join(", ")}.`,
    };
  }

  return { value, error: null };
}

function normalizeFilters(rawValue) {
  const value = String(rawValue || "").trim();
  if (!value) {
    return { value: "", normalizedFilters: [], error: null };
  }

  const normalizedFilters = value
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

  const invalidFilters = normalizedFilters.filter(
    (entry) => !SUPPORTED_FILTERS.includes(entry),
  );

  if (invalidFilters.length) {
    return {
      value,
      normalizedFilters: [],
      error: `Unsupported filters: ${invalidFilters.join(", ")}. Allowed: ${SUPPORTED_FILTERS.join(", ")}.`,
    };
  }

  return { value, normalizedFilters, error: null };
}

function getPreviewAnchorBias(anchorHint, method) {
  const normalizedAnchor = String(anchorHint || "")
    .trim()
    .toLowerCase();

  if (normalizedAnchor === "top") {
    return { x: 0.5, y: 0 };
  }

  if (normalizedAnchor === "bottom") {
    return { x: 0.5, y: 1 };
  }

  if (normalizedAnchor === "left") {
    return { x: 0, y: 0.5 };
  }

  if (normalizedAnchor === "right") {
    return { x: 1, y: 0.5 };
  }

  if (normalizedAnchor === "center") {
    return { x: 0.5, y: 0.5 };
  }

  switch (method) {
    case "head_bust":
    case "frontal":
    case "profile":
      return { x: 0.5, y: 0.2 };
    case "below_lips":
      return { x: 0.5, y: 0.6 };
    case "chin":
      return { x: 0.5, y: 0.72 };
    case "nose":
      return { x: 0.5, y: 0.5 };
    default:
      return { x: 0.5, y: 0.5 };
  }
}

function formatRatioPreviewLabel(aspectRatio) {
  if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) {
    return "Original ratio";
  }

  const widthPart = aspectRatio >= 1 ? aspectRatio : 1;
  const heightPart = aspectRatio >= 1 ? 1 : 1 / aspectRatio;
  const formatPart = (value) => Number(value.toFixed(2)).toString();

  return `${formatPart(widthPart)}:${formatPart(heightPart)}`;
}

function normalizeCropCoordinates(rawValue) {
  const value = String(rawValue || "").trim();
  if (!value) {
    return { value: "", coordinates: undefined, error: null };
  }

  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    return {
      value,
      coordinates: undefined,
      error: "Crop coordinates must be valid JSON.",
    };
  }

  if (!parsed || typeof parsed !== "object") {
    return {
      value,
      coordinates: undefined,
      error: "Crop coordinates must be a JSON object.",
    };
  }

  const left = Number(parsed.left);
  const top = Number(parsed.top);
  const width = Number(parsed.width);
  const height = Number(parsed.height);

  if (
    !Number.isFinite(left) ||
    !Number.isFinite(top) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height)
  ) {
    return {
      value,
      coordinates: undefined,
      error: "Crop coordinates require numeric left, top, width, and height.",
    };
  }

  if (width <= 0 || height <= 0) {
    return {
      value,
      coordinates: undefined,
      error: "Crop width and height must be positive.",
    };
  }

  if (
    left < 0 ||
    top < 0 ||
    left + width > 1 + CROP_COORDINATE_EPSILON ||
    top + height > 1 + CROP_COORDINATE_EPSILON
  ) {
    return {
      value,
      coordinates: undefined,
      error:
        "Crop coordinates must stay within image bounds (fractional 0 to 1 values).",
    };
  }

  const sourceWidth =
    parsed.sourceWidth === undefined ? undefined : Number(parsed.sourceWidth);
  const sourceHeight =
    parsed.sourceHeight === undefined ? undefined : Number(parsed.sourceHeight);

  if (
    (sourceWidth !== undefined &&
      (!Number.isFinite(sourceWidth) || sourceWidth <= 0)) ||
    (sourceHeight !== undefined &&
      (!Number.isFinite(sourceHeight) || sourceHeight <= 0))
  ) {
    return {
      value,
      coordinates: undefined,
      error: "Crop coordinates source dimensions must be positive numbers.",
    };
  }

  return {
    value,
    coordinates: {
      ...parsed,
      left: clamp(left, 0, 1),
      top: clamp(top, 0, 1),
      width: clamp(width, 0, 1),
      height: clamp(height, 0, 1),
      ...(sourceWidth !== undefined ? { sourceWidth } : {}),
      ...(sourceHeight !== undefined ? { sourceHeight } : {}),
    },
    error: null,
  };
}

function createDefaultCropRect({
  sourceAspectRatio,
  targetAspectRatio,
  anchorBias,
}) {
  if (!Number.isFinite(sourceAspectRatio) || sourceAspectRatio <= 0) {
    return null;
  }

  const safeTargetAspectRatio = clamp(
    targetAspectRatio || sourceAspectRatio,
    0.2,
    5,
  );
  const normalizedTargetAspectRatio = safeTargetAspectRatio / sourceAspectRatio;
  let width = 1;
  let height = 1;

  if (normalizedTargetAspectRatio >= 1) {
    height = 1 / normalizedTargetAspectRatio;
  } else {
    width = normalizedTargetAspectRatio;
  }

  width = clamp(width, MIN_CROP_SIZE_FRACTION, 1);
  height = clamp(height, MIN_CROP_SIZE_FRACTION, 1);

  const biasX = clamp(anchorBias?.x ?? 0.5, 0, 1);
  const biasY = clamp(anchorBias?.y ?? 0.5, 0, 1);

  return {
    left: clamp((1 - width) * biasX, 0, 1 - width),
    top: clamp((1 - height) * biasY, 0, 1 - height),
    width,
    height,
  };
}

function buildCropRectFromDragPoints({
  startPoint,
  currentPoint,
  lockedAspectRatio,
  minSize = MIN_CROP_SIZE_FRACTION,
}) {
  const directionX = currentPoint.x >= startPoint.x ? 1 : -1;
  const directionY = currentPoint.y >= startPoint.y ? 1 : -1;
  const maxWidth = directionX > 0 ? 1 - startPoint.x : startPoint.x;
  const maxHeight = directionY > 0 ? 1 - startPoint.y : startPoint.y;

  let width = clamp(Math.abs(currentPoint.x - startPoint.x), 0, maxWidth);
  let height = clamp(Math.abs(currentPoint.y - startPoint.y), 0, maxHeight);

  if (Number.isFinite(lockedAspectRatio) && lockedAspectRatio > 0) {
    if (width === 0 && height > 0) {
      width = height * lockedAspectRatio;
    } else if (height === 0 && width > 0) {
      height = width / lockedAspectRatio;
    }

    if (width > 0 && height > 0) {
      if (width / height > lockedAspectRatio) {
        width = height * lockedAspectRatio;
      } else {
        height = width / lockedAspectRatio;
      }
    }

    if (width > maxWidth) {
      width = maxWidth;
      height = width / lockedAspectRatio;
    }

    if (height > maxHeight) {
      height = maxHeight;
      width = height * lockedAspectRatio;
    }
  }

  if (width < minSize || height < minSize) {
    return null;
  }

  const left = directionX > 0 ? startPoint.x : startPoint.x - width;
  const top = directionY > 0 ? startPoint.y : startPoint.y - height;

  return {
    left: clamp(left, 0, Math.max(1 - width, 0)),
    top: clamp(top, 0, Math.max(1 - height, 0)),
    width: clamp(width, minSize, 1),
    height: clamp(height, minSize, 1),
  };
}

function isPointInsideCropRect(point, cropRect) {
  if (!point || !cropRect) {
    return false;
  }

  return (
    point.x >= cropRect.left &&
    point.x <= cropRect.left + cropRect.width &&
    point.y >= cropRect.top &&
    point.y <= cropRect.top + cropRect.height
  );
}

function getCropResizeHandle(point, cropRect, hitThresholdX, hitThresholdY) {
  if (!point || !cropRect) {
    return null;
  }

  const left = cropRect.left;
  const right = cropRect.left + cropRect.width;
  const top = cropRect.top;
  const bottom = cropRect.top + cropRect.height;
  const nearLeft = Math.abs(point.x - left) <= hitThresholdX;
  const nearRight = Math.abs(point.x - right) <= hitThresholdX;
  const nearTop = Math.abs(point.y - top) <= hitThresholdY;
  const nearBottom = Math.abs(point.y - bottom) <= hitThresholdY;

  if (nearTop && nearLeft) return "nw";
  if (nearTop && nearRight) return "ne";
  if (nearBottom && nearLeft) return "sw";
  if (nearBottom && nearRight) return "se";
  if (nearTop && point.x >= left && point.x <= right) return "n";
  if (nearBottom && point.x >= left && point.x <= right) return "s";
  if (nearLeft && point.y >= top && point.y <= bottom) return "w";
  if (nearRight && point.y >= top && point.y <= bottom) return "e";

  return null;
}

function resizeCropRectFromHandle({ startRect, handle, point, lockedAspectRatio }) {
  if (!startRect || !handle || !point) {
    return null;
  }

  if (["nw", "ne", "sw", "se"].includes(handle) && lockedAspectRatio) {
    const oppositePoint = {
      x: handle.includes("w") ? startRect.left + startRect.width : startRect.left,
      y: handle.includes("n") ? startRect.top + startRect.height : startRect.top,
    };

    return buildCropRectFromDragPoints({
      startPoint: oppositePoint,
      currentPoint: point,
      lockedAspectRatio,
    });
  }

  const minSize = MIN_CROP_SIZE_FRACTION;
  const startRight = startRect.left + startRect.width;
  const startBottom = startRect.top + startRect.height;
  let left = startRect.left;
  let right = startRight;
  let top = startRect.top;
  let bottom = startBottom;

  if (handle.includes("w")) {
    left = clamp(point.x, 0, startRight - minSize);
  }
  if (handle.includes("e")) {
    right = clamp(point.x, startRect.left + minSize, 1);
  }
  if (handle.includes("n")) {
    top = clamp(point.y, 0, startBottom - minSize);
  }
  if (handle.includes("s")) {
    bottom = clamp(point.y, startRect.top + minSize, 1);
  }

  const width = right - left;
  const height = bottom - top;
  if (width < minSize || height < minSize) {
    return null;
  }

  return { left, top, width, height };
}

function areCropRectsEquivalent(firstRect, secondRect, epsilon = 0.0001) {
  if (!firstRect || !secondRect) {
    return false;
  }

  return (
    Math.abs(firstRect.left - secondRect.left) <= epsilon &&
    Math.abs(firstRect.top - secondRect.top) <= epsilon &&
    Math.abs(firstRect.width - secondRect.width) <= epsilon &&
    Math.abs(firstRect.height - secondRect.height) <= epsilon
  );
}

function deriveAnchorHintFromCropRect(cropRect) {
  if (!cropRect) {
    return "center";
  }

  const centerX = cropRect.left + cropRect.width / 2;
  const centerY = cropRect.top + cropRect.height / 2;
  const distanceFromCenterX = centerX - 0.5;
  const distanceFromCenterY = centerY - 0.5;

  if (
    Math.max(
      Math.abs(distanceFromCenterX),
      Math.abs(distanceFromCenterY),
    ) <= 0.12
  ) {
    return "center";
  }

  if (Math.abs(distanceFromCenterX) > Math.abs(distanceFromCenterY)) {
    return distanceFromCenterX < 0 ? "left" : "right";
  }

  return distanceFromCenterY < 0 ? "top" : "bottom";
}

function buildCropOptionPayload(values) {
  const targetAspectRatio = normalizeTargetAspectRatio(
    values.targetAspectRatio,
  );
  const marginTop = normalizeMarginValue(
    values.marginTop,
    "Top margin/padding",
  );
  const marginRight = normalizeMarginValue(
    values.marginRight,
    "Right margin/padding",
  );
  const marginBottom = normalizeMarginValue(
    values.marginBottom,
    "Bottom margin/padding",
  );
  const marginLeft = normalizeMarginValue(
    values.marginLeft,
    "Left margin/padding",
  );
  const anchorHint = normalizeAnchorHint(values.anchorHint);
  const filters = normalizeFilters(values.filters);
  const cropCoordinates = normalizeCropCoordinates(values.cropCoordinates);

  const errors = [
    targetAspectRatio.error,
    marginTop.error,
    marginRight.error,
    marginBottom.error,
    marginLeft.error,
    anchorHint.error,
    filters.error,
    cropCoordinates.error,
  ].filter(Boolean);

  return {
    errors,
    options: {
      targetAspectRatio: targetAspectRatio.value || undefined,
      marginTop: marginTop.numericValue,
      marginRight: marginRight.numericValue,
      marginBottom: marginBottom.numericValue,
      marginLeft: marginLeft.numericValue,
      anchorHint: anchorHint.value || undefined,
      filters: filters.normalizedFilters.length
        ? filters.normalizedFilters
        : undefined,
      cropCoordinates: cropCoordinates.coordinates,
    },
  };
}

function validateImageFile(file) {
  if (!(file instanceof File)) {
    return "Please upload an image.";
  }

  if (!file.type.startsWith("image/")) {
    return "Only image files are supported.";
  }

  return null;
}

function jsonError(error, status = 400, extra = {}) {
  return Response.json(
    {
      error,
      ...extra,
    },
    { status },
  );
}

export const loader = async ({ request }) => {
  const { session, billing } = await authenticate.admin(request);
  const billingState = await getBillingState({ billing });

  const planUsage = buildPlanView(
    await getShopPlanUsage(session.shop, {
      hasActiveProPlan: billingState.hasActivePayment,
    }),
  );

  return {
    planUsage,
    hasActiveProPlan: billingState.hasActivePayment,
  };
};

export const action = async ({ request }) => {
  const { session, billing } = await authenticate.admin(request);
  const startedAt = Date.now();

  const formData = await request.formData();
  const files = formData.getAll("file");

  if (!files.length) {
    return jsonError("Please upload at least one image.");
  }

  for (const file of files) {
    const fileError = validateImageFile(file);
    if (fileError) {
      return jsonError(
        `${file instanceof File ? file.name : "File"}: ${fileError}`,
      );
    }
  }

  const { method, pipeline, optionValues } =
    buildRouteCropRequestContract(formData);
  const optionPayload = buildCropOptionPayload(optionValues);

  if (optionPayload.errors.length) {
    return jsonError(optionPayload.errors.join(" "));
  }

  const billingState = await getBillingState({ billing });
  const planReservation = await reservePlanCapacity({
    shop: session.shop,
    imageCount: files.length,
    method,
    hasActiveProPlan: billingState.hasActivePayment,
  });

  if (!planReservation.ok) {
    return jsonError(planReservation.error, 403, { plan: planReservation.plan });
  }

  try {
    const response = await cropImages(files, {
      method: planReservation.effectiveMethod,
      pipeline,
      ...optionPayload.options,
    });
    const elapsedMs = Date.now() - startedAt;

    const metadataFromHeaders = (() => {
      const parseNumeric = (value) => {
        if (value === null || value === undefined || value === "") return null;
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
      };

      const parseManifestHeader = () => {
        const possibleManifestHeaders = [
          "x-smartcrop-manifest",
          "x-manifest",
          "x-crop-manifest",
        ];

        for (const headerName of possibleManifestHeaders) {
          const rawValue = response.headers.get(headerName);
          if (!rawValue) continue;

          try {
            const parsed = JSON.parse(rawValue);
            if (parsed && typeof parsed === "object") {
              return parsed;
            }
          } catch {
            // ignore malformed manifest headers
          }
        }

        return null;
      };

      const manifest = parseManifestHeader();
      const failedFiles =
        (Array.isArray(manifest?.failed_files) && manifest.failed_files) ||
        (Array.isArray(manifest?.failedFiles) && manifest.failedFiles) ||
        [];
      const failedCount =
        parseNumeric(response.headers.get("x-failed-count")) ??
        parseNumeric(manifest?.failed_count) ??
        parseNumeric(manifest?.failedCount) ??
        failedFiles.length;
      const processedCount =
        parseNumeric(response.headers.get("x-processed-count")) ??
        parseNumeric(manifest?.processed_count) ??
        parseNumeric(manifest?.processedCount) ??
        Math.max(files.length - failedCount, 0);
      const successCount = Math.max(processedCount - failedCount, 0);
      const elapsedFromManifest =
        parseNumeric(response.headers.get("x-elapsed-ms")) ??
        parseNumeric(manifest?.elapsed_ms) ??
        parseNumeric(manifest?.elapsedMs) ??
        null;

      return {
        requestedCount: files.length,
        processedCount,
        successCount,
        failedCount,
        failedFiles,
        elapsedMs: elapsedFromManifest ?? elapsedMs,
        manifest,
      };
    })();

    const mimeType =
      response.headers.get("content-type") || "application/octet-stream";
    if (!mimeType.includes("application/zip")) {
      const bodyPreview = (await response.text()).slice(0, 500);
      console.error("Smart Crop API returned unexpected content type", {
        mimeType,
        bodyPreview,
      });
      return jsonError(
        `Expected application/zip response but received ${mimeType}.`,
        502,
      );
    }

    await commitPlanUsage({
      shop: session.shop,
      imageCount: metadataFromHeaders.successCount,
    });

    const headers = new Headers({
      "content-type": response.headers.get("content-type") || "application/zip",
      "content-disposition":
        response.headers.get("content-disposition") ||
        'attachment; filename="cropped_batch.zip"',
      "cache-control": "no-store",
    });

    const contentEncoding = response.headers.get("content-encoding");
    if (contentEncoding) {
      headers.set("content-encoding", contentEncoding);
    }

    const contentLength = response.headers.get("content-length");
    if (contentLength) {
      headers.set("content-length", contentLength);
    }

    headers.set(
      "x-crop-summary",
      JSON.stringify({
        ...metadataFromHeaders,
        elapsedSeconds: Number((metadataFromHeaders.elapsedMs / 1000).toFixed(2)),
      }),
    );

    return new Response(response.body, {
      status: response.status,
      headers,
    });
  } catch (error) {
    console.error("Crop action failed", {
      error: error instanceof Error ? error.message : error,
      fileCount: files.length,
      method: planReservation.effectiveMethod,
    });
    return jsonError(
      error instanceof Error
        ? error.message
        : "Unable to crop image. Check the FastAPI service.",
      502,
    );
  }
};

export default function CropImagePage() {
  const { planUsage, hasActiveProPlan } = useLoaderData();
  const shopify = useAppBridge();

  const inputRef = useRef(null);
  const previewUrlRef = useRef("");
  const previewStageRef = useRef(null);
  const cropInteractionRef = useRef(null);
  const preferencesHydratedRef = useRef(false);
  const [fileError, setFileError] = useState("");
  const [selectedUploadFiles, setSelectedUploadFiles] = useState([]);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [previewFile, setPreviewFile] = useState(null);
  const [previewDimensions, setPreviewDimensions] = useState({
    width: 0,
    height: 0,
  });
  const [selectedPreset, setSelectedPreset] = useState("auto");
  const [selectedPipeline, setSelectedPipeline] = useState("auto");
  const [previewCropRect, setPreviewCropRect] = useState(null);
  const [cropHoverHandle, setCropHoverHandle] = useState(null);
  const [isCropDirty, setIsCropDirty] = useState(false);
  const [lockPresetAspectRatio, setLockPresetAspectRatio] = useState(true);
  const [cropValidationError, setCropValidationError] = useState("");
  const [isCropPointerActive, setIsCropPointerActive] = useState(false);
  const [isDragActive, setIsDragActive] = useState(false);
  const [isSubmittingDownload, setIsSubmittingDownload] = useState(false);
  const [isReadyToDownload, setIsReadyToDownload] = useState(false);
  const [downloadResult, setDownloadResult] = useState(null);
  const [downloadBlob, setDownloadBlob] = useState(null);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      const savedPreferences = window.localStorage.getItem(
        PREFERENCE_STORAGE_KEY,
      );

      if (!savedPreferences) {
        return;
      }

      const parsedPreferences = JSON.parse(savedPreferences);
      if (typeof parsedPreferences !== "object" || !parsedPreferences) {
        return;
      }

      if (
        typeof parsedPreferences.selectedPreset === "string" &&
        PRESET_OPTIONS.some((preset) => preset.value === parsedPreferences.selectedPreset)
      ) {
        setSelectedPreset(parsedPreferences.selectedPreset);
      }

      setSelectedPipeline(normalizePipeline(parsedPreferences.selectedPipeline));
    } catch (error) {
      console.warn("Failed to hydrate crop preferences from local storage", {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      preferencesHydratedRef.current = true;
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !preferencesHydratedRef.current) {
      return;
    }

    window.localStorage.setItem(
      PREFERENCE_STORAGE_KEY,
      JSON.stringify({
        selectedPreset,
        selectedPipeline,
      }),
    );
  }, [selectedPipeline, selectedPreset]);

  const showToast = useCallback(
    (message, options) => {
      if (typeof window === "undefined") {
        return;
      }

      if (
        !shopify ||
        !shopify.toast ||
        typeof shopify.toast.show !== "function"
      ) {
        return;
      }

      shopify.toast.show(message, options);
    },
    [shopify],
  );

  useEffect(() => {
    return () => {
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      if (downloadBlob) {
        URL.revokeObjectURL(downloadBlob.url);
      }
    };
  }, [downloadBlob]);

  const syncPreviewFile = (nextFiles) => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = "";
    }

    const firstFile = nextFiles[0];
    if (!firstFile) {
      setPreviewFile(null);
      setPreviewDimensions({ width: 0, height: 0 });
      setPreviewCropRect(null);
      setIsCropDirty(false);
      setCropHoverHandle(null);
      setCropValidationError("");
      return;
    }

    const previewUrl = URL.createObjectURL(firstFile);
    previewUrlRef.current = previewUrl;
    setPreviewDimensions({ width: 0, height: 0 });
    setPreviewCropRect(null);
    setIsCropDirty(false);
    setCropHoverHandle(null);
    setCropValidationError("");
    setPreviewFile({
      name: firstFile.name,
      src: previewUrl,
    });
  };

  const syncSelectedFiles = (nextFiles) => {
    const nextError = nextFiles
      .map((file) => {
        const error = validateImageFile(file);
        return error ? `${file.name}: ${error}` : null;
      })
      .find(Boolean);

    setFileError(nextError || "");
    syncPreviewFile(nextError ? [] : nextFiles);
    if (nextError) {
      setSelectedUploadFiles([]);
      setSelectedFiles([]);
      return;
    }

    setSelectedUploadFiles(nextFiles);
    setSelectedFiles(
      nextFiles.map((file) => ({
        name: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
      })),
    );
  };

  const hasValidSelection = selectedFiles.length > 0 && !fileError;
  const selectedPresetConfig =
    PRESET_OPTIONS.find((preset) => preset.value === selectedPreset) ||
    PRESET_OPTIONS[0];
  const selectedMethod = selectedPresetConfig.method;
  const selectedMethodDetails =
    CROP_METHODS.find((method) => method.value === selectedMethod) ||
    CROP_METHODS[0];
  const selectedPipelineDetails =
    PIPELINE_OPTIONS.find((pipeline) => pipeline.value === selectedPipeline) ||
    PIPELINE_OPTIONS[0];
  const isPlanBlockedByMethod =
    !planUsage.allowsFaceDetection && selectedMethod !== "auto";
  const blockedMethodUnlockPlan = PLAN_CONFIG.pro.label;
  const sourceAspectRatio =
    previewDimensions.width > 0 && previewDimensions.height > 0
      ? previewDimensions.width / previewDimensions.height
      : null;
  const hintedTargetAspectRatio =
    sourceAspectRatio &&
    clamp(
      PRESET_ASPECT_RATIO_HINTS[selectedPreset] ||
        METHOD_ASPECT_RATIO_HINTS[selectedMethod] ||
        sourceAspectRatio,
      0.2,
      5,
    );
  const normalizedLockedAspectRatio =
    lockPresetAspectRatio &&
    sourceAspectRatio &&
    hintedTargetAspectRatio &&
    clamp(hintedTargetAspectRatio / sourceAspectRatio, 0.05, 20);

  const defaultPreviewCropRect = useMemo(() => {
    if (!sourceAspectRatio || !hintedTargetAspectRatio) {
      return null;
    }

    return createDefaultCropRect({
      sourceAspectRatio,
      targetAspectRatio: hintedTargetAspectRatio,
      anchorBias: getPreviewAnchorBias("auto", selectedMethod),
    });
  }, [hintedTargetAspectRatio, selectedMethod, sourceAspectRatio]);

  useEffect(() => {
    setIsCropDirty(false);
  }, [selectedPreset]);

  useEffect(() => {
    if (!previewFile || !defaultPreviewCropRect) {
      setPreviewCropRect(null);
      setIsCropDirty(false);
      setCropHoverHandle(null);
      return;
    }

    setPreviewCropRect((previousRect) => {
      if (isCropDirty && previousRect) {
        return previousRect;
      }

      if (areCropRectsEquivalent(previousRect, defaultPreviewCropRect)) {
        return previousRect;
      }

      return defaultPreviewCropRect;
    });
  }, [defaultPreviewCropRect, isCropDirty, previewFile]);

  const getNormalizedPointerPosition = useCallback((event) => {
    const stage = previewStageRef.current;
    if (!stage) {
      return null;
    }

    const bounds = stage.getBoundingClientRect();
    if (!bounds.width || !bounds.height) {
      return null;
    }

    return {
      x: clamp((event.clientX - bounds.left) / bounds.width, 0, 1),
      y: clamp((event.clientY - bounds.top) / bounds.height, 0, 1),
    };
  }, []);

  const getCropResizeHitThreshold = useCallback(() => {
    const stage = previewStageRef.current;
    if (!stage) {
      return null;
    }

    const bounds = stage.getBoundingClientRect();
    if (!bounds.width || !bounds.height) {
      return null;
    }

    return {
      x: Math.min(CROP_RESIZE_HIT_SIZE_PX / bounds.width, 0.06),
      y: Math.min(CROP_RESIZE_HIT_SIZE_PX / bounds.height, 0.06),
    };
  }, []);

  const handleCropPointerDown = useCallback(
    (event) => {
      if (event.pointerType === "mouse" && event.button !== 0) {
        return;
      }

      const pointerPoint = getNormalizedPointerPosition(event);
      if (!pointerPoint) {
        return;
      }

      const hitThreshold = getCropResizeHitThreshold();
      const resizeHandle = hitThreshold
        ? getCropResizeHandle(
            pointerPoint,
            previewCropRect,
            hitThreshold.x,
            hitThreshold.y,
          )
        : null;

      const isMoveInteraction = isPointInsideCropRect(
        pointerPoint,
        previewCropRect,
      );

      cropInteractionRef.current = resizeHandle
        ? {
            pointerId: event.pointerId,
            mode: "resize",
            handle: resizeHandle,
            startRect: previewCropRect,
          }
        : isMoveInteraction
          ? {
            pointerId: event.pointerId,
            mode: "move",
            startRect: previewCropRect,
            offsetX: pointerPoint.x - previewCropRect.left,
            offsetY: pointerPoint.y - previewCropRect.top,
          }
          : {
            pointerId: event.pointerId,
            mode: "draw",
            startPoint: pointerPoint,
          };

      setIsCropPointerActive(true);
      setIsCropDirty(true);
      setCropHoverHandle(resizeHandle);
      setCropValidationError("");
      event.currentTarget.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    },
    [getCropResizeHitThreshold, getNormalizedPointerPosition, previewCropRect],
  );

  const handleCropPointerMove = useCallback(
    (event) => {
      const interaction = cropInteractionRef.current;
      const pointerPoint = getNormalizedPointerPosition(event);
      if (!pointerPoint) {
        return;
      }

      if (!interaction) {
        if (!previewCropRect) {
          setCropHoverHandle(null);
          return;
        }

        const hitThreshold = getCropResizeHitThreshold();
        if (!hitThreshold) {
          setCropHoverHandle(null);
          return;
        }

        setCropHoverHandle(
          getCropResizeHandle(
            pointerPoint,
            previewCropRect,
            hitThreshold.x,
            hitThreshold.y,
          ),
        );
        return;
      }

      if (interaction.pointerId !== event.pointerId) {
        return;
      }

      if (interaction.mode === "resize" && interaction.startRect) {
        const nextRect = resizeCropRectFromHandle({
          startRect: interaction.startRect,
          handle: interaction.handle,
          point: pointerPoint,
          lockedAspectRatio: normalizedLockedAspectRatio || null,
        });

        if (nextRect) {
          setPreviewCropRect(nextRect);
        }
        return;
      }

      if (interaction.mode === "move" && interaction.startRect) {
        setPreviewCropRect({
          ...interaction.startRect,
          left: clamp(
            pointerPoint.x - interaction.offsetX,
            0,
            1 - interaction.startRect.width,
          ),
          top: clamp(
            pointerPoint.y - interaction.offsetY,
            0,
            1 - interaction.startRect.height,
          ),
        });
        return;
      }

      const nextRect = buildCropRectFromDragPoints({
        startPoint: interaction.startPoint,
        currentPoint: pointerPoint,
        lockedAspectRatio: normalizedLockedAspectRatio || null,
      });

      if (nextRect) {
        setPreviewCropRect(nextRect);
      }
    },
    [
      getCropResizeHitThreshold,
      getNormalizedPointerPosition,
      normalizedLockedAspectRatio,
      previewCropRect,
    ],
  );

  const finishCropPointerInteraction = useCallback((event) => {
    const interaction = cropInteractionRef.current;
    if (!interaction || interaction.pointerId !== event.pointerId) {
      return;
    }

    cropInteractionRef.current = null;
    setIsCropPointerActive(false);
    setCropHoverHandle(null);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  }, []);

  const handleCropPointerCaptureLost = useCallback(() => {
    cropInteractionRef.current = null;
    setIsCropPointerActive(false);
    setCropHoverHandle(null);
  }, []);

  const cropPreviewModel = useMemo(() => {
    if (
      !previewCropRect ||
      !sourceAspectRatio ||
      previewCropRect.height <= 0 ||
      previewCropRect.width <= 0
    ) {
      return null;
    }

    return {
      ...previewCropRect,
      targetAspectRatio: clamp(
        (previewCropRect.width / previewCropRect.height) * sourceAspectRatio,
        0.2,
        5,
      ),
    };
  }, [previewCropRect, sourceAspectRatio]);

  const cropOptionFields = useMemo(() => {
    if (!cropPreviewModel || previewDimensions.width <= 0 || previewDimensions.height <= 0) {
      return {
        targetAspectRatio: "",
        marginTop: "",
        marginRight: "",
        marginBottom: "",
        marginLeft: "",
        anchorHint: "center",
        cropCoordinates: "",
      };
    }

    const toFieldString = (value) => Number(value.toFixed(4)).toString();
    const marginTop = clamp(cropPreviewModel.top, 0, 1);
    const marginLeft = clamp(cropPreviewModel.left, 0, 1);
    const marginRight = clamp(
      1 - cropPreviewModel.left - cropPreviewModel.width,
      0,
      1,
    );
    const marginBottom = clamp(
      1 - cropPreviewModel.top - cropPreviewModel.height,
      0,
      1,
    );

    return {
      targetAspectRatio: toFieldString(cropPreviewModel.targetAspectRatio),
      marginTop: toFieldString(marginTop),
      marginRight: toFieldString(marginRight),
      marginBottom: toFieldString(marginBottom),
      marginLeft: toFieldString(marginLeft),
      anchorHint: deriveAnchorHintFromCropRect(cropPreviewModel),
      cropCoordinates: JSON.stringify({
        version: 1,
        unit: "fraction",
        mode: "manual-drag",
        left: Number(cropPreviewModel.left.toFixed(6)),
        top: Number(cropPreviewModel.top.toFixed(6)),
        width: Number(cropPreviewModel.width.toFixed(6)),
        height: Number(cropPreviewModel.height.toFixed(6)),
        sourceWidth: previewDimensions.width,
        sourceHeight: previewDimensions.height,
      }),
    };
  }, [cropPreviewModel, previewDimensions.height, previewDimensions.width]);

  const cropOptionValidation = useMemo(
    () =>
      buildCropOptionPayload({
        targetAspectRatio: cropOptionFields.targetAspectRatio,
        marginTop: cropOptionFields.marginTop,
        marginRight: cropOptionFields.marginRight,
        marginBottom: cropOptionFields.marginBottom,
        marginLeft: cropOptionFields.marginLeft,
        anchorHint: cropOptionFields.anchorHint,
        filters: "",
        cropCoordinates: cropOptionFields.cropCoordinates,
      }),
    [cropOptionFields],
  );

  const cropCoordinateSummary = useMemo(() => {
    if (!cropPreviewModel || previewDimensions.width <= 0 || previewDimensions.height <= 0) {
      return null;
    }

    return {
      leftPx: Math.round(cropPreviewModel.left * previewDimensions.width),
      topPx: Math.round(cropPreviewModel.top * previewDimensions.height),
      widthPx: Math.round(cropPreviewModel.width * previewDimensions.width),
      heightPx: Math.round(cropPreviewModel.height * previewDimensions.height),
    };
  }, [cropPreviewModel, previewDimensions.height, previewDimensions.width]);

  const cropOverlayStyle = useMemo(() => {
    if (!cropPreviewModel) {
      return null;
    }

    return {
      left: `${(cropPreviewModel.left * 100).toFixed(2)}%`,
      top: `${(cropPreviewModel.top * 100).toFixed(2)}%`,
      width: `${(cropPreviewModel.width * 100).toFixed(2)}%`,
      height: `${(cropPreviewModel.height * 100).toFixed(2)}%`,
    };
  }, [cropPreviewModel]);
  const croppedOutputImageStyle = useMemo(() => {
    if (!cropPreviewModel) {
      return null;
    }

    return {
      width: `${(100 / cropPreviewModel.width).toFixed(4)}%`,
      height: `${(100 / cropPreviewModel.height).toFixed(4)}%`,
      left: `${((-cropPreviewModel.left / cropPreviewModel.width) * 100).toFixed(4)}%`,
      top: `${((-cropPreviewModel.top / cropPreviewModel.height) * 100).toFixed(4)}%`,
    };
  }, [cropPreviewModel]);
  const cropPreviewRatioLabel = useMemo(() => {
    if (!cropPreviewModel) {
      return "";
    }

    return formatRatioPreviewLabel(cropPreviewModel.targetAspectRatio);
  }, [cropPreviewModel]);

  const resetPreviewCrop = useCallback(() => {
    setIsCropDirty(false);
    setCropValidationError("");
    setCropHoverHandle(null);
    setPreviewCropRect(defaultPreviewCropRect);
  }, [defaultPreviewCropRect]);

  const cropCursor = useMemo(() => {
    if (isCropPointerActive) {
      if (cropHoverHandle === "n" || cropHoverHandle === "s") return "ns-resize";
      if (cropHoverHandle === "e" || cropHoverHandle === "w") return "ew-resize";
      if (cropHoverHandle === "ne" || cropHoverHandle === "sw") return "nesw-resize";
      if (cropHoverHandle === "nw" || cropHoverHandle === "se") return "nwse-resize";
      return "grabbing";
    }

    if (cropHoverHandle === "n" || cropHoverHandle === "s") return "ns-resize";
    if (cropHoverHandle === "e" || cropHoverHandle === "w") return "ew-resize";
    if (cropHoverHandle === "ne" || cropHoverHandle === "sw") return "nesw-resize";
    if (cropHoverHandle === "nw" || cropHoverHandle === "se") return "nwse-resize";
    if (cropPreviewModel) return "grab";
    return "crosshair";
  }, [cropHoverHandle, cropPreviewModel, isCropPointerActive]);

  const handleDownloadSubmit = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;

    if (!(form instanceof HTMLFormElement)) {
      showToast("Unable to submit crop request form.", { isError: true });
      return;
    }

    const requestUrl = (() => {
      if (typeof window === "undefined") {
        return form.action || "/app/additional";
      }

      const url = new URL(
        form.action || window.location.href,
        window.location.origin,
      );

      if (!url.search) {
        url.search = window.location.search;
      }

      return `${url.pathname}${url.search}`;
    })();

    if (!hasValidSelection) {
      if (fileError) {
        showToast(fileError, { isError: true });
      }
      return;
    }

    if (!cropPreviewModel) {
      const message =
        "Preview crop is not ready yet. Wait for the image preview to load.";
      setCropValidationError(message);
      showToast(message, { isError: true });
      return;
    }

    if (cropOptionValidation.errors.length) {
      const message = cropOptionValidation.errors.join(" ");
      setCropValidationError(message);
      showToast(message, { isError: true });
      return;
    }

    setCropValidationError("");
    setIsSubmittingDownload(true);
    setIsReadyToDownload(false);
    setDownloadResult(null);
    if (downloadBlob) {
      URL.revokeObjectURL(downloadBlob.url);
      setDownloadBlob(null);
    }
    showToast("Cropping started. Processing images...");

    try {
      if (!shopify || typeof shopify.idToken !== "function") {
        throw new Error("Shopify session token is unavailable in this context.");
      }

      const formData = new FormData();
      selectedUploadFiles.forEach((file) => {
        formData.append("file", file, file.name || "upload");
      });
      formData.set("method", selectedMethod);
      formData.set("pipeline", selectedPipeline);
      formData.set("target_aspect_ratio", cropOptionFields.targetAspectRatio);
      formData.set("margin_top", cropOptionFields.marginTop);
      formData.set("margin_right", cropOptionFields.marginRight);
      formData.set("margin_bottom", cropOptionFields.marginBottom);
      formData.set("margin_left", cropOptionFields.marginLeft);
      formData.set("anchor_hint", cropOptionFields.anchorHint);
      formData.delete("filters");

      if (cropOptionFields.cropCoordinates) {
        formData.set("crop_coordinates", cropOptionFields.cropCoordinates);
      } else {
        formData.delete("crop_coordinates");
      }

      const idToken = await shopify.idToken();
      const response = await fetch(requestUrl, {
        method: "POST",
        body: formData,
        headers: {
          Authorization: `Bearer ${idToken}`,
        },
      });

      const contentType = response.headers.get("content-type") || "";

      if (contentType.includes("application/json")) {
        const payload = await response.json();
        if (typeof payload?.error === "string" && payload.error) {
          showToast(payload.error, { isError: true });
          return;
        }
      }

      if (!response.ok) {
        throw new Error(`Crop request failed (${response.status}).`);
      }

      if (contentType.includes("text/html")) {
        throw new Error(
          "Session expired before the crop completed. Refresh the app and try again.",
        );
      }

      if (!contentType.includes("application/zip")) {
        throw new Error(`Expected ZIP download but received ${contentType}.`);
      }

      const disposition = response.headers.get("content-disposition") || "";
      const filenameMatch = disposition.match(/filename="([^"]+)"/i);
      const filename = filenameMatch?.[1] || "cropped_batch.zip";
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const summary = parseCropSummaryHeader(response.headers.get("x-crop-summary"));

      setDownloadBlob({
        url: blobUrl,
        filename,
      });
      setDownloadResult(summary);
      setIsReadyToDownload(true);

      showToast("Crop completed. Review results and download ZIP.");
    } catch (error) {
      showToast(
        error instanceof Error
          ? error.message
          : "Unable to crop image.",
        { isError: true },
      );
    } finally {
      setIsSubmittingDownload(false);
    }
  };

  const handleDownloadReadyZip = useCallback(() => {
    if (!downloadBlob) {
      return;
    }

    const anchor = document.createElement("a");
    anchor.href = downloadBlob.url;
    anchor.download = downloadBlob.filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }, [downloadBlob]);

  return (
    <s-page heading="Crop Images">
      <style>{`
        .responsive-table {
          width: 100%;
          border-collapse: collapse;
        }

        .responsive-table th,
        .responsive-table td {
          padding: 8px;
          border-bottom: 1px solid rgba(0, 0, 0, 0.08);
          vertical-align: top;
        }

        .responsive-card-list {
          display: none;
        }

        .responsive-card {
          border: 1px solid rgba(0, 0, 0, 0.08);
          border-radius: 8px;
          padding: 12px;
          background: var(--p-color-bg-surface, #fff);
        }

        .responsive-card-primary {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto auto;
          gap: 8px;
          align-items: start;
          margin-bottom: 8px;
        }

        .responsive-card-name {
          overflow-wrap: anywhere;
          font-weight: 600;
        }

        .responsive-card-metadata {
          display: grid;
          gap: 4px;
        }

        .responsive-card-row {
          display: flex;
          justify-content: space-between;
          gap: 8px;
        }

        .crop-preview-grid {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(180px, 240px);
          gap: 12px;
          align-items: start;
        }

        .crop-preview-stage {
          position: relative;
          width: 100%;
          max-width: 480px;
          border: 1px solid rgba(0, 0, 0, 0.08);
          border-radius: 12px;
          overflow: hidden;
          background: rgba(255, 255, 255, 0.9);
        }

        .crop-preview-stage img {
          display: block;
          width: 100%;
          height: auto;
        }

        .crop-preview-overlay {
          position: absolute;
          border: 2px solid #008060;
          border-radius: 10px;
          box-shadow: 0 0 0 9999px rgba(15, 23, 42, 0.35);
          pointer-events: none;
        }

        .crop-preview-handle {
          position: absolute;
          width: 12px;
          height: 12px;
          border-radius: 999px;
          border: 2px solid #fff;
          background: #008060;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
          transform: translate(-50%, -50%);
        }

        .crop-preview-cropped {
          position: relative;
          width: 100%;
          border: 1px solid rgba(0, 0, 0, 0.12);
          border-radius: 12px;
          overflow: hidden;
          background: #fff;
        }

        .crop-preview-cropped img {
          position: absolute;
          max-width: none;
          user-select: none;
          -webkit-user-drag: none;
        }

        @media (max-width: 900px) {
          .responsive-table {
            display: none;
          }

          .responsive-card-list {
            display: grid;
            gap: 12px;
          }

          .crop-preview-grid {
            grid-template-columns: minmax(0, 1fr);
          }

          .crop-preview-cropped {
            max-width: 320px;
          }
        }

        @media (max-width: 480px) {
          .responsive-card-primary {
            grid-template-columns: minmax(0, 1fr);
          }
        }
      `}</style>
      <s-section heading="Plan and usage">
        <s-stack direction="block" gap="small">
          <s-text>
            Current plan: <strong>{planUsage.label}</strong>
          </s-text>
          <s-text>
            Usage this month: {planUsage.imagesProcessed}/
            {planUsage.monthlyImageLimit} images
          </s-text>
          <s-text>Remaining this month: {planUsage.remaining} images</s-text>
          {!planUsage.allowsFaceDetection && (
            <s-banner tone="info">
              Free plan uses content-aware crop only ({" "}
              <code>center_content</code>). Face detection methods are available
              on the {PLAN_CONFIG.pro.label} plan (€
              {PLAN_CONFIG.pro.monthlyPriceEur}/month).
            </s-banner>
          )}
          {!hasActiveProPlan && (
            <s-text>
              To activate {PRO_PLAN}, open{" "}
              <s-link href="/app/billing">Billing</s-link> and approve the
              Shopify app subscription.
            </s-text>
          )}
        </s-stack>
      </s-section>

      <s-section heading="Layer 1 — Zero friction">
        <s-paragraph>
          Drop images and run Smart Crop. For most stores, the default preset
          handles the batch without extra setup.
        </s-paragraph>

        <form
          method="post"
          encType="multipart/form-data"
          onSubmit={handleDownloadSubmit}
        >
          <s-stack direction="block" gap="base">
            <label htmlFor="file">Image files</label>
            <s-box
              padding="base"
              border="base"
              borderRadius="base"
              background={isDragActive ? "bg-fill-brand" : "bg-fill"}
              onDragOver={(event) => {
                event.preventDefault();
                setIsDragActive(true);
              }}
              onDragLeave={(event) => {
                event.preventDefault();
                setIsDragActive(false);
              }}
              onDrop={(event) => {
                event.preventDefault();
                setIsDragActive(false);

                const nextFiles = Array.from(event.dataTransfer.files ?? []);
                if (!nextFiles.length) return;

                if (inputRef.current) {
                  try {
                    const dataTransfer = new DataTransfer();
                    nextFiles.forEach((file) => dataTransfer.items.add(file));
                    inputRef.current.files = dataTransfer.files;
                  } catch {
                    // Some embedded browser contexts disallow setting input.files.
                  }
                }

                syncSelectedFiles(nextFiles);
              }}
            >
              <s-stack direction="block" gap="small">
                <s-text>Drag and drop one or more images here</s-text>
                <s-text tone="subdued">or use the picker below</s-text>
                <input
                  id="file"
                  name="file"
                  ref={inputRef}
                  type="file"
                  multiple
                  accept="image/*"
                  required
                  onChange={(event) => {
                    const nextFiles = Array.from(
                      event.currentTarget.files ?? [],
                    );
                    syncSelectedFiles(nextFiles);
                  }}
                />
              </s-stack>
            </s-box>
            {fileError && <s-text tone="critical">{fileError}</s-text>}

            <s-box
              padding="base"
              border="base"
              borderRadius="base"
              background="bg-fill-secondary"
            >
              <s-stack direction="block" gap="small">
                <s-text fontWeight="semibold">Layer 2 — Light control</s-text>
                <s-text tone="subdued">
                  Choose a preset in plain language. You can run immediately
                  without touching advanced settings.
                </s-text>
                <label htmlFor="preset">Preset</label>
                <select
                  id="preset"
                  value={selectedPreset}
                  onChange={(event) =>
                    setSelectedPreset(event.currentTarget.value)
                  }
                >
                  {PRESET_OPTIONS.map((preset) => (
                    <option key={preset.value} value={preset.value}>
                      {preset.label}
                    </option>
                  ))}
                </select>
                <s-text tone="subdued">
                  {selectedPresetConfig.description}
                </s-text>
              </s-stack>
            </s-box>

            <input type="hidden" name="method" value={selectedMethod} />

            <s-box
              padding="base"
              border="base"
              borderRadius="base"
              background="bg-fill-secondary"
            >
              <s-stack direction="block" gap="small">
                <label htmlFor="pipeline">Pipeline</label>
                <select
                  id="pipeline"
                  name="pipeline"
                  value={selectedPipeline}
                  onChange={(event) =>
                    setSelectedPipeline(event.currentTarget.value)
                  }
                >
                  {PIPELINE_OPTIONS.map((pipeline) => (
                    <option key={pipeline.value} value={pipeline.value}>
                      {pipeline.label}
                    </option>
                  ))}
                </select>
                <s-text tone="subdued">
                  {selectedPipelineDetails.description}
                </s-text>
              </s-stack>
            </s-box>

            <details>
              <summary>
                <strong>Layer 3 - Drag to crop</strong>
              </summary>
              <s-box
                padding="base"
                border="base"
                borderRadius="base"
                style={{ marginTop: "12px" }}
              >
                <s-stack direction="block" gap="small">
                  <s-text tone="subdued">
                    Draw a crop box directly on the preview. Drag inside the
                    box to move it.
                  </s-text>
                  <label>
                    <input
                      type="checkbox"
                      checked={lockPresetAspectRatio}
                      onChange={(event) =>
                        setLockPresetAspectRatio(event.currentTarget.checked)
                      }
                    />{" "}
                    Lock ratio to preset (
                    {formatRatioPreviewLabel(hintedTargetAspectRatio || 0)})
                  </label>
                  <s-stack direction="inline" gap="small" wrap>
                    <s-button
                      type="button"
                      variant="secondary"
                      onClick={resetPreviewCrop}
                      disabled={!defaultPreviewCropRect}
                    >
                      Reset crop
                    </s-button>
                    {cropCoordinateSummary && (
                      <s-text tone="subdued">
                        X:{cropCoordinateSummary.leftPx}px Y:
                        {cropCoordinateSummary.topPx}px W:
                        {cropCoordinateSummary.widthPx}px H:
                        {cropCoordinateSummary.heightPx}px
                      </s-text>
                    )}
                  </s-stack>
                  {cropValidationError && (
                    <s-text tone="critical">{cropValidationError}</s-text>
                  )}
                </s-stack>
              </s-box>
            </details>

            <input
              type="hidden"
              name="target_aspect_ratio"
              value={cropOptionFields.targetAspectRatio}
            />
            <input
              type="hidden"
              name="margin_top"
              value={cropOptionFields.marginTop}
            />
            <input
              type="hidden"
              name="margin_right"
              value={cropOptionFields.marginRight}
            />
            <input
              type="hidden"
              name="margin_bottom"
              value={cropOptionFields.marginBottom}
            />
            <input
              type="hidden"
              name="margin_left"
              value={cropOptionFields.marginLeft}
            />
            <input
              type="hidden"
              name="anchor_hint"
              value={cropOptionFields.anchorHint}
            />
            <input
              type="hidden"
              name="crop_coordinates"
              value={cropOptionFields.cropCoordinates}
            />

            <s-box padding="base" border="base" borderRadius="base">
              <s-text fontWeight="semibold">Current crop strategy</s-text>
              {!planUsage.allowsFaceDetection && (
                <s-text tone="subdued">
                  Free plan requests are automatically processed with{" "}
                  <code>center_content</code>.
                </s-text>
              )}
              <s-text>
                <strong>{selectedMethodDetails.label}:</strong>{" "}
                {selectedMethodDetails.description}
              </s-text>
              {isPlanBlockedByMethod && (
                <s-banner tone="warning">
                  This preset uses <code>{selectedMethod}</code>, which is blocked on the Free plan. Upgrade to {blockedMethodUnlockPlan} to unlock this exact method.
                  <div style={{ marginTop: "8px" }}>
                    <s-link href="/app/billing">Upgrade to {blockedMethodUnlockPlan}</s-link>
                  </div>
                </s-banner>
              )}
            </s-box>

            <s-box padding="base" border="base" borderRadius="base" background="bg-fill-secondary">
              <s-text fontWeight="semibold">Quota remaining</s-text>
              <s-text>{planUsage.remaining} images left this month</s-text>
            </s-box>

            <s-button
              type="submit"
              disabled={
                !hasValidSelection ||
                isSubmittingDownload ||
                isPlanBlockedByMethod
              }
              {...(isSubmittingDownload ? { loading: true } : {})}
            >
              Process images
            </s-button>

            {isSubmittingDownload && <s-text>Processing images…</s-text>}
            {isReadyToDownload && downloadBlob && (
              <s-box padding="base" border="base" borderRadius="base">
                <s-stack direction="block" gap="small">
                  <s-text fontWeight="semibold">Batch results</s-text>
                  <s-text>
                    Success: {downloadResult?.successCount ?? 0} · Failed: {downloadResult?.failedCount ?? 0}
                    {downloadResult?.elapsedSeconds !== null &&
                    downloadResult?.elapsedSeconds !== undefined
                      ? ` · ${downloadResult.elapsedSeconds}s`
                      : ""}
                  </s-text>
                  {(downloadResult?.failedFiles?.length || 0) > 0 && (
                    <s-text tone="critical">
                      Failed files: {downloadResult.failedFiles.join(", ")}
                    </s-text>
                  )}
                  <s-button type="button" onClick={handleDownloadReadyZip}>
                    Download ZIP
                  </s-button>
                </s-stack>
              </s-box>
            )}
          </s-stack>
        </form>
      </s-section>

      <s-section heading="Preview">
        {!selectedFiles.length && (
          <s-paragraph>Select one or more images to show a preview.</s-paragraph>
        )}

        {previewFile && (
          <s-stack direction="block" gap="small">
            <s-text fontWeight="semibold">Preview (first image only)</s-text>
            {cropPreviewModel && (
              <s-text tone="subdued">
                Estimated output ratio: {cropPreviewRatioLabel}
              </s-text>
            )}
            <div className="crop-preview-grid">
              <div
                className="crop-preview-stage"
                ref={previewStageRef}
                onPointerDown={handleCropPointerDown}
                onPointerMove={handleCropPointerMove}
                onPointerUp={finishCropPointerInteraction}
                onPointerCancel={finishCropPointerInteraction}
                onLostPointerCapture={handleCropPointerCaptureLost}
                style={{
                  cursor: cropCursor,
                  touchAction: "none",
                }}
                onPointerLeave={() => {
                  if (!cropInteractionRef.current) {
                    setCropHoverHandle(null);
                  }
                }}
              >
                <img
                  src={previewFile.src}
                  alt="Selected preview"
                  onLoad={(event) => {
                    const { naturalWidth, naturalHeight } = event.currentTarget;
                    setPreviewDimensions((previous) => {
                      if (
                        previous.width === naturalWidth &&
                        previous.height === naturalHeight
                      ) {
                        return previous;
                      }

                      return {
                        width: naturalWidth,
                        height: naturalHeight,
                      };
                    });
                  }}
                />
                {cropOverlayStyle && (
                  <div
                    className="crop-preview-overlay"
                    style={cropOverlayStyle}
                  >
                    {CROP_RESIZE_HANDLES.map((handle) => (
                      <div
                        key={handle}
                        className="crop-preview-handle"
                        style={{
                          left: handle.includes("w")
                            ? "0%"
                            : handle.includes("e")
                              ? "100%"
                              : "50%",
                          top: handle.includes("n")
                            ? "0%"
                            : handle.includes("s")
                              ? "100%"
                              : "50%",
                          opacity:
                            cropHoverHandle === handle || isCropPointerActive
                              ? 1
                              : 0.75,
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>
              {cropPreviewModel && croppedOutputImageStyle && (
                <div
                  className="crop-preview-cropped"
                  style={{ aspectRatio: cropPreviewModel.targetAspectRatio }}
                >
                  <img
                    src={previewFile.src}
                    alt="Estimated crop preview"
                    style={croppedOutputImageStyle}
                  />
                </div>
              )}
            </div>
          </s-stack>
        )}
      </s-section>

      <s-section heading="Cropped output">
        <s-stack direction="inline" gap="base">
          <s-button
            variant="secondary"
            onClick={() => {
              setSelectedFiles([]);
              setSelectedUploadFiles([]);
              syncPreviewFile([]);
              setFileError("");
              setSelectedPreset("auto");
              setLockPresetAspectRatio(true);
              setPreviewCropRect(null);
              setIsCropDirty(false);
              setCropValidationError("");
              setIsCropPointerActive(false);
              cropInteractionRef.current = null;
              inputRef.current?.form?.reset();
              inputRef.current?.focus();
            }}
          >
            Reset selection
          </s-button>
          <s-text tone="subdued">
            Downloads use a generated link once the batch ZIP has been fully
            prepared.
          </s-text>
        </s-stack>
      </s-section>
    </s-page>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
