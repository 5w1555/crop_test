export function createCropJobStatusLoader({ authenticateAdmin, findCropJob }) {
  return async ({ request, params }) => {
    const { session } = await authenticateAdmin(request);
    const jobId = params.jobId;

    if (!jobId) {
      return Response.json({ error: "Missing job ID." }, { status: 400 });
    }

    const job = await findCropJob(jobId);
    if (!job || job.shop !== session.shop) {
      return Response.json({ error: "Job not found." }, { status: 404 });
    }

    const resultPayload =
      job.resultPayload && typeof job.resultPayload === "object"
        ? job.resultPayload
        : null;

    if (job.status === "failed") {
      return Response.json({
        status: "failed",
        error: job.error || "Unable to crop image. Please retry.",
      });
    }

    if (job.status === "succeeded") {
      return Response.json({
        status: "succeeded",
        storeUpdateResult: resultPayload?.storeUpdateResult || undefined,
        cropSummary: resultPayload?.cropSummary || undefined,
        auditMetadata: resultPayload?.auditMetadata || undefined,
        error: job.error || undefined,
      });
    }

    return Response.json({ status: job.status });
  };
}
