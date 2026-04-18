import CropControlCenter from "../components/CropControlCenter.jsx";
import { cropImagesWithOutputs } from "../lib/crop/client.server.js";
import { createCropAction } from "../lib/crop/route-action.server.js";
import { authenticate } from "../shopify.server";
import { isPreviewRequest } from "../lib/shopify-auth.server";

export const loader = async ({ request }) => {
  if (!isPreviewRequest(request)) {
    await authenticate.admin(request);
  }

  return {};
};

export const action = createCropAction({
  cropImagesWithOutputs,
  authenticateAdmin: authenticate.admin,
  isPreviewRequest,
});

export default function CropRoute() {
  return <CropControlCenter />;
}
