import { cropImagesWithOutputs } from "../lib/crop/client.server.js";
import { createCropAction } from "../lib/crop/route-action.server.js";
import { authenticate } from "../shopify.server";
import { isPreviewRequest } from "../lib/shopify-auth.server";

export const action = createCropAction({
  cropImagesWithOutputs,
  authenticateAdmin: authenticate.admin,
  isPreviewRequest,
});
