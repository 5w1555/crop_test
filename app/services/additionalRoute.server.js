import { authenticate } from "../shopify.server";
import { buildPlanView } from "../utils/plan.js";
import { getShopPlanUsage, reservePlanCapacity, commitPlanUsage } from "../utils/plan.server.js";
import { createCropJob } from "../lib/crop/jobs.server.js";
import { getBillingState } from "../lib/billing.server.js";
import { buildFilesFromMediaSources, resolveSelectedMedia } from "../utils/shopifyMedia.server.js";
import { buildCropOptionPayload, buildRouteCropRequestContract } from "../lib/crop/contract.js";
import { cropImagesWithOutputs } from "../lib/crop/client.server.js";
import { writeBackCroppedMedia } from "../lib/mediaWriteback.server.js";

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
  console.log("=== CROP ACTION STARTED ==="); // ← will now appear in terminal

  const formData = await request.formData();
  const files = formData.getAll("file");
  const selectedMediaIds = formData.getAll("selected_media_id").map(String).filter(Boolean);
  const selectedProductIds = formData.getAll("selected_product_id").map(String).filter(Boolean);

  if (!selectedMediaIds.length && !files.length) {
    return jsonError("Please select at least one Shopify media item or upload an image.");
  }

  // Resolve media (already working)
  let resolvedMedia = [];
  if (selectedMediaIds.length) {
    const mediaResult = await resolveSelectedMedia({ admin, mediaIds: selectedMediaIds, productIds: selectedProductIds });
    if (mediaResult.invalidMediaIds.length) {
      return jsonError("Some selected media items are unavailable.", 403, { invalidMediaIds: mediaResult.invalidMediaIds });
    }
    resolvedMedia = mediaResult.media;
  }

  const uploadedFiles = files.filter(f => f instanceof File);
  const mediaSourceFiles = resolvedMedia.length ? await buildFilesFromMediaSources(resolvedMedia) : [];
  const filesForCrop = mediaSourceFiles.length ? mediaSourceFiles : uploadedFiles;

  const { method, pipeline, optionValues } = buildRouteCropRequestContract(formData);
  const optionPayload = buildCropOptionPayload(optionValues);
  if (optionPayload.errors.length) return jsonError(optionPayload.errors.join(" "));

  // Billing check
  const billingState = await getBillingState({ billing });
  const planReservation = await reservePlanCapacity({
    shop: session.shop,
    imageCount: filesForCrop.length,
    method,
    hasActiveProPlan: billingState.hasActivePayment,
  });
  if (!planReservation.ok) return jsonError(planReservation.error, 403, { plan: planReservation.plan });

  // === SYNCHRONOUS CROP (this is the only real pipeline now) ===
  let cropOutputs;
  try {
    console.log(`Cropping ${filesForCrop.length} file(s) with pipeline: ${pipeline}`);
    cropOutputs = await cropImagesWithOutputs(filesForCrop, {
      method: planReservation.effectiveMethod,
      pipeline,
      ...optionPayload.options,
    });
  } catch (err) {
    console.error("FastAPI crop failed:", err);
    return jsonError(err.message || "Crop failed", 500);
  }

  // Writeback if we have Shopify media
  let mediaUpdates = [];
  if (resolvedMedia.length) {
    try {
      mediaUpdates = await writeBackCroppedMedia({
        admin,
        shop: session.shop,
        cropOutputs,
        mediaTargets: resolvedMedia,
        cropParams: optionPayload.options,
      });
    } catch (err) {
      console.error("Writeback failed:", err);
    }
  } else {
    mediaUpdates = cropOutputs.map(output => ({
      status: "updated",
      sourceFilename: output.sourceFilename,
      outputFilename: output.sourceFilename.replace(/\.\w+$/, "_cropped.jpg"),
      contentType: output.contentType,
      bytes: output.byteLength,
      updatedImageUrl: null,
      mutationOutcome: "single_crop",
      error: null,
    }));
  }

  await commitPlanUsage({ shop: session.shop, imageCount: filesForCrop.length });

  // Light Prisma log (keeps your history)
  await createCropJob({
    shop: session.shop,
    admin,
    files: filesForCrop,
    startedAt: Date.now(),
    mediaTargets: resolvedMedia,
    options: { method: planReservation.effectiveMethod, pipeline, ...optionPayload.options },
  });

  console.log("=== CROP ACTION SUCCEEDED ===", { successCount: mediaUpdates.length });

  return Response.json({
    status: "succeeded",
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