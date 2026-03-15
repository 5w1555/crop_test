import { randomUUID } from "node:crypto";

import prisma from "../db.server.js";
import { cropImages, cropImagesWithOutputs } from "./smartCropClient.js";
import { commitPlanUsage } from "./plan.server.js";
import { buildStoreUpdateResultContract } from "./cropRequestContract.js";
import { writeBackCroppedMedia } from "./mediaWriteback.server.js";

const CROP_JOB_RETENTION_DAYS = 14;
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

let cleanupTimerStarted = false;

function getCropJobCleanupCutoff(retentionDays = CROP_JOB_RETENTION_DAYS) {
  return new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
}

export async function cleanupExpiredCropJobs(retentionDays = CROP_JOB_RETENTION_DAYS) {
  return prisma.cropJob.deleteMany({
    where: {
      createdAt: {
        lt: getCropJobCleanupCutoff(retentionDays),
      },
    },
  });
}

function scheduleCleanup() {
  if (cleanupTimerStarted) {
    return;
  }

  cleanupTimerStarted = true;
  setInterval(() => {
    void cleanupExpiredCropJobs().catch((error) => {
      console.warn("Unable to clean up expired crop jobs", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, CLEANUP_INTERVAL_MS).unref?.();
}

export async function createCropJob({
  shop,
  admin,
  files,
  options,
  startedAt,
  mediaTargets = [],
}) {
  scheduleCleanup();

  const jobId = randomUUID();

  await prisma.cropJob.create({
    data: {
      id: jobId,
      shop,
      status: "pending",
      requestPayload: {
        files: files.map((file) => ({
          name: file?.name || null,
          type: file?.type || null,
          size: typeof file?.size === "number" ? file.size : null,
        })),
        options,
        mediaTargets,
        startedAt,
      },
    },
  });

  void runCropJob(jobId, {
    shop,
    admin,
    files,
    options,
    startedAt,
    mediaTargets,
  });

  return jobId;
}

async function runCropJob(
  jobId,
  { shop, admin, files, options, startedAt, mediaTargets },
) {
  await prisma.cropJob.update({
    where: { id: jobId },
    data: { status: "running", error: null },
  });

  try {
    const elapsedMs = Date.now() - startedAt;
    let storeUpdateResult;

    if (Array.isArray(mediaTargets) && mediaTargets.length) {
      const cropOutputs = await cropImagesWithOutputs(files, options);
      const writeBackResults = await writeBackCroppedMedia({
        admin,
        shop,
        cropOutputs,
        mediaTargets,
        cropParams: options,
      });

      storeUpdateResult = buildStoreUpdateResultContract(
        { storeUpdatedResults: writeBackResults },
        { files },
      );
    } else {
      const response = await cropImages(files, options);
      const payload = await response.json();
      storeUpdateResult = buildStoreUpdateResultContract(payload, { files });
    }

    if (!storeUpdateResult) {
      throw new Error("Crop API response is missing store update results.");
    }

    await commitPlanUsage({
      shop,
      imageCount: files.length,
    });

    const resultPayload = {
      storeUpdateResult,
      auditMetadata: {
        shop,
        mediaMutations: (storeUpdateResult.mediaUpdates || []).map((item) => ({
          shop,
          sourceMediaId: item.sourceMediaId || item.mediaId || null,
          destinationMediaId: item.destinationMediaId || null,
          status: item.status,
          mutationOutcome: item.mutationOutcome || null,
          error: item.error || null,
        })),
      },
      cropSummary: {
        ...storeUpdateResult.cropSummary,
        elapsedSeconds: Number((elapsedMs / 1000).toFixed(2)),
      },
      finishedAt: Date.now(),
    };

    await prisma.cropJob.update({
      where: { id: jobId },
      data: {
        status: "succeeded",
        resultPayload,
        error: null,
      },
    });
  } catch (error) {
    await prisma.cropJob.update({
      where: { id: jobId },
      data: {
        status: "failed",
        error:
          error instanceof Error
            ? error.message
            : "Unable to crop image. Check the FastAPI service.",
      },
    });
  }
}

export async function getCropJob(jobId) {
  return prisma.cropJob.findUnique({ where: { id: jobId } });
}
