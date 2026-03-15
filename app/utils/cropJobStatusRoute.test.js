import test from "node:test";
import assert from "node:assert/strict";

import { createCropJobStatusLoader } from "../routes/app.additional.status.$jobId.server.js";

test("status route can poll a submitted job after simulated process restart", async () => {
  const persistedJobs = new Map();
  const jobId = "job-restart-pending";

  persistedJobs.set(jobId, {
    id: jobId,
    shop: "restart-test.myshopify.com",
    status: "pending",
    error: null,
    resultPayload: null,
  });

  const authenticateAdmin = async () => ({
    session: { shop: "restart-test.myshopify.com" },
  });

  const findCropJob = async (id) => persistedJobs.get(id) ?? null;

  const loaderAfterRestart = createCropJobStatusLoader({
    authenticateAdmin,
    findCropJob,
  });

  const response = await loaderAfterRestart({
    request: new Request("https://example.com/status/job-restart-pending"),
    params: { jobId },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    status: "pending",
    jobId,
    mediaUpdates: [],
    summary: { requestedCount: 0, successCount: 0, failedCount: 0, failedFiles: [] },
    errors: [],
  });
});

test("status route returns persisted succeeded payload after simulated restart", async () => {
  const persistedJobs = new Map();
  const jobId = "job-restart-succeeded";

  persistedJobs.set(jobId, {
    id: jobId,
    shop: "restart-test.myshopify.com",
    status: "succeeded",
    error: null,
    resultPayload: {
      storeUpdateResult: {
        mediaUpdates: [{ status: "updated", sourceFilename: "image.jpg" }],
        cropSummary: { requestedCount: 1, successCount: 1, failedCount: 0, failedFiles: [] },
        errors: [],
      },
      cropSummary: { requestedCount: 1, successCount: 1, failedCount: 0, failedFiles: [], elapsedSeconds: 1.2 },
    },
  });

  const loader = createCropJobStatusLoader({
    authenticateAdmin: async () => ({
      session: { shop: "restart-test.myshopify.com" },
    }),
    findCropJob: async (id) => persistedJobs.get(id) ?? null,
  });

  const response = await loader({
    request: new Request("https://example.com/status/job-restart-succeeded"),
    params: { jobId },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    status: "succeeded",
    jobId,
    mediaUpdates: [{ status: "updated", sourceFilename: "image.jpg" }],
    summary: { requestedCount: 1, successCount: 1, failedCount: 0, failedFiles: [], elapsedSeconds: 1.2 },
    errors: [],
  });
});
