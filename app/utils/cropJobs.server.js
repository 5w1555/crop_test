import { randomUUID } from "node:crypto";

import { cropImages } from "./smartCropClient.js";
import { commitPlanUsage } from "./plan.server.js";

const JOB_TTL_MS = 15 * 60 * 1000;

const jobs = new Map();

function scheduleCleanup(jobId) {
  setTimeout(() => {
    jobs.delete(jobId);
  }, JOB_TTL_MS).unref?.();
}

export function createCropJob({ shop, files, options, startedAt }) {
  const jobId = randomUUID();

  jobs.set(jobId, {
    id: jobId,
    shop,
    status: "pending",
    startedAt,
    finishedAt: null,
    downloadUrl: null,
    filename: null,
    expiresIn: null,
    cropSummary: null,
    error: null,
  });

  void runCropJob(jobId, { shop, files, options, startedAt });
  scheduleCleanup(jobId);

  return jobId;
}

async function runCropJob(jobId, { shop, files, options, startedAt }) {
  const job = jobs.get(jobId);
  if (!job) return;

  try {
    const response = await cropImages(files, options);
    const elapsedMs = Date.now() - startedAt;
    const payload = await response.json();

    if (!payload?.downloadUrl) {
      throw new Error("Crop API response is missing downloadUrl.");
    }

    await commitPlanUsage({
      shop,
      imageCount: files.length,
    });

    jobs.set(jobId, {
      ...job,
      status: "done",
      finishedAt: Date.now(),
      downloadUrl: payload.downloadUrl,
      filename: payload.filename || "cropped_batch.zip",
      expiresIn: payload.expiresIn || 600,
      cropSummary: {
        requestedCount: files.length,
        successCount: files.length,
        failedCount: 0,
        failedFiles: [],
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
