import { boundary } from "@shopify/shopify-app-react-router/server";

export const loader = async (loaderArgs) => {
  const { authenticate } = await import("../shopify.server");
  const { getCropJob } = await import("../utils/cropJobs.server.js");
  const { createCropJobStatusLoader } = await import("../services/cropJobStatusRoute.server.js");

  return createCropJobStatusLoader({
    authenticateAdmin: authenticate.admin,
    findCropJob: getCropJob,
  })(loaderArgs);
};

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
