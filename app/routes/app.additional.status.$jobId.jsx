import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getCropJob } from "../utils/cropJobs.server.js";
import { createCropJobStatusLoader } from "./app.additional.status.$jobId.server.js";

export const loader = createCropJobStatusLoader({
  authenticateAdmin: authenticate.admin,
  findCropJob: getCropJob,
});

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
