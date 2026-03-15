export function createCropJobStatusLoader({ authenticateAdmin, findCropJob }) {
  return async ({ request, params }) => {
    const { session } = await authenticateAdmin(request);
    const jobId = params.jobId;

    if (!jobId) {
      return Response.json(
        {
          status: "failed",
          jobId: null,
          mediaUpdates: [],
          summary: {
            requestedCount: 0,
            successCount: 0,
            failedCount: 0,
            failedFiles: [],
          },
          errors: [{ code: "validation_error", message: "Missing job ID." }],
        },
        { status: 400 },
      );
    }

    const job = await findCropJob(jobId);
    if (!job || job.shop !== session.shop) {
      return Response.json(
        {
          status: "failed",
          jobId,
          mediaUpdates: [],
          summary: {
            requestedCount: 0,
            successCount: 0,
            failedCount: 0,
            failedFiles: [],
          },
          errors: [{ code: "not_found", message: "Job not found." }],
        },
        { status: 404 },
      );
    }

    const resultPayload =
      job.resultPayload && typeof job.resultPayload === "object"
        ? job.resultPayload
        : null;

    if (job.status === "failed") {
      return Response.json({
        status: "failed",
        jobId,
        mediaUpdates: [],
        summary: {
          requestedCount: 0,
          successCount: 0,
          failedCount: 1,
          failedFiles: [],
        },
        errors: [
          {
            code: "job_failed",
            message: job.error || "Unable to crop image. Please retry.",
          },
        ],
      });
    }

    if (job.status === "succeeded") {
      return Response.json({
        status:
          resultPayload?.storeUpdateResult?.cropSummary?.failedCount > 0
            ? "partial_failure"
            : "succeeded",
        jobId,
        mediaUpdates: resultPayload?.storeUpdateResult?.mediaUpdates || [],
        summary: resultPayload?.cropSummary || resultPayload?.storeUpdateResult?.cropSummary || {
          requestedCount: 0,
          successCount: 0,
          failedCount: 0,
          failedFiles: [],
        },
        errors: resultPayload?.storeUpdateResult?.errors || [],
      });
    }

    return Response.json({
      status: job.status,
      jobId,
      mediaUpdates: [],
      summary: {
        requestedCount: 0,
        successCount: 0,
        failedCount: 0,
        failedFiles: [],
      },
      errors: [],
    });
  };
}
