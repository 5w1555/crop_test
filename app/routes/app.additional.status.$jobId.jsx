import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getCropJob } from "../utils/cropJobs.server.js";

export const loader = async ({ request, params }) => {
  const { session } = await authenticate.admin(request);
  const jobId = params.jobId;

  if (!jobId) {
    return Response.json({ error: "Missing job ID." }, { status: 400 });
  }

  const job = getCropJob(jobId);
  if (!job || job.shop !== session.shop) {
    return Response.json({ error: "Job not found." }, { status: 404 });
  }

  if (job.status === "pending") {
    return Response.json({ status: "pending" });
  }

  if (job.status === "error") {
    return Response.json({
      status: "error",
      error: job.error || "Unable to crop image. Please retry.",
    });
  }

  return Response.json({
    status: "done",
    downloadUrl: job.downloadUrl || undefined,
    filename: job.filename || undefined,
    expiresIn: job.expiresIn || undefined,
    cropSummary: job.cropSummary || undefined,
    error: job.error || undefined,
  });
};

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
