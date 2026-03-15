import { randomUUID } from "node:crypto";

import { cropImages, cropImagesWithOutputs } from "./smartCropClient.js";
import { commitPlanUsage } from "./plan.server.js";
import { buildStoreUpdateResultContract } from "./cropRequestContract.js";
import { writeBackCroppedMedia } from "./mediaWriteback.server.js";

const JOB_TTL_MS = 15 * 60 * 1000;

const jobs = new Map();

function scheduleCleanup(jobId) {
  setTimeout(() => {
    jobs.delete(jobId);
  }, JOB_TTL_MS).unref?.();
}

export function createCropJob({
  shop,
  admin,
  files,
  options,
  startedAt,
  mediaTargets = [],
}) {
  const jobId = randomUUID();

  jobs.set(jobId, {
    id: jobId,
    shop,
    status: "pending",
    startedAt,
    finishedAt: null,
    storeUpdateResult: null,
    cropSummary: null,
    auditMetadata: {
      shop,
      mediaMutations: [],
    },
    error: null,
  });

  void runCropJob(jobId, {
    shop,
    admin,
    files,
    options,
    startedAt,
    mediaTargets,
  });
  scheduleCleanup(jobId);

  return jobId;
}

async function runCropJob(
  jobId,
  { shop, admin, files, options, startedAt, mediaTargets },
) {
  const job = jobs.get(jobId);
  if (!job) return;

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

    jobs.set(jobId, {
      ...job,
      status: "done",
      finishedAt: Date.now(),
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
    });
  } catch (error) {
    jobs.set(jobId, {
      ...job,
      status: "error",
      finishedAt: Date.now(),
      error:
        error instanceof Error
          ? error.message
          : "Unable to crop image. Check the FastAPI service.",
    });
  }
}

export function getCropJob(jobId) {
  return jobs.get(jobId) || null;
}
