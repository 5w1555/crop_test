import { authenticate } from "../shopify.server";
import { buildPlanView } from "../utils/plan.js";
import { getShopPlanUsage, reservePlanCapacity } from "../utils/plan.server.js";
import { createCropJob } from "../lib/crop/jobs.server.js";
import { getBillingState } from "../lib/billing.server.js";
import { buildFilesFromMediaSources, resolveSelectedMedia } from "../utils/shopifyMedia.server.js";
import { buildCropOptionPayload, buildRouteCropRequestContract } from "../lib/crop/contract.js";

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
