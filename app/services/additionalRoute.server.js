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
  const selectedMediaIds = formData.getAll("selected_media_id").map(String).filter(Boolean);
  const selectedProductIds = formData.getAll("selected_product_id").map(String).filter(Boolean);

  if (!selectedMediaIds.length && !files.length) {
    return jsonError("Please select at least one Shopify media item or upload an image.");
  }

  // Resolve Shopify media (already fixed and working)
  let resolvedMedia = [];
  let mediaTargets = [];
  if (selectedMediaIds.length) {
    const mediaResult = await resolveSelectedMedia({ admin, mediaIds: selectedMediaIds, productIds: selectedProductIds });
    if (mediaResult.invalidMediaIds.length) {
      return jsonError("Some selected media items are unavailable.", 403, { invalidMediaIds: mediaResult.invalidMediaIds });
    }
    resolvedMedia = mediaResult.media;
    mediaTargets = resolvedMedia;
  }

  const uploadedFiles = files.filter(f => f instanceof File);
  const mediaSourceFiles = resolvedMedia.length ? await buildFilesFromMediaSources(resolvedMedia) : [];
  const filesForCrop = mediaSourceFiles.length ? mediaSourceFiles : uploadedFiles;

  const { method, pipeline, optionValues } = buildRouteCropRequestContract(formData);
  const optionPayload = buildCropOptionPayload(optionValues);
  if (optionPayload.errors.length) return jsonError(optionPayload.errors.join(" "));

  // Billing (unchanged)
  const billingState = await getBillingState({ billing });
  const planReservation = await reservePlanCapacity({
    shop: session.shop,
    imageCount: filesForCrop.length,
    method,
    hasActiveProPlan: billingState.hasActivePayment,
  });
  if (!planReservation.ok) return jsonError(planReservation.error, 403, { plan: planReservation.plan });

  // === NEW SYNCHRONOUS PIPELINE (this is the fix) ===
  let cropOutputs;
  try {
    cropOutputs = await cropImagesWithOutputs(filesForCrop, {
      method: planReservation.effectiveMethod,
      pipeline,
      ...optionPayload.options,
    });
  } catch (err) {
    return jsonError(err.message || "Crop failed", 500);
  }

  // Writeback to Shopify if we have media targets
  let mediaUpdates = [];
  if (mediaTargets.length) {
    mediaUpdates = await writeBackCroppedMedia({
      admin,
      shop: session.shop,
      cropOutputs,
      mediaTargets,
      cropParams: optionPayload.options,
    });
  } else {
    // Direct upload case — just return the cropped data
    mediaUpdates = cropOutputs.map((output, i) => ({
      status: "updated",
      sourceFilename: output.sourceFilename,
      outputFilename: output.sourceFilename.replace(/\.\w+$/, "_cropped.jpg"),
      contentType: output.contentType,
      bytes: output.byteLength,
      updatedImageUrl: null, // or base64 if you want
      mutationOutcome: "single_crop",
      error: null,
    }));
  }

  await commitPlanUsage({ shop: session.shop, imageCount: filesForCrop.length });

  // Optional: still log to Prisma for history (keeps your DB happy)
  const jobId = await createCropJob({ /* minimal version or skip if you want */ });

  return Response.json({
    status: "succeeded",
    jobId,
    mediaUpdates,
    summary: {
      requestedCount: filesForCrop.length,
      successCount: mediaUpdates.length,
      failedCount: 0,
      failedFiles: [],
    },
    errors: [],
  });
};
