import { authenticate } from "../shopify.server";
import { resolveSelectedMedia } from "../utils/shopifyMedia.server";

function jsonError(error, status = 400, extra = {}) {
  return Response.json({ error, ...extra }, { status });
}

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON body.");
  }

  const mediaIds = Array.isArray(body?.mediaIds) ? body.mediaIds : [];
  const productIds = Array.isArray(body?.productIds) ? body.productIds : [];

  if (!mediaIds.length && !productIds.length) {
    return jsonError("Please select at least one Shopify media item.");
  }

  const resolved = await resolveSelectedMedia({ admin, mediaIds, productIds });

  if (!resolved.media.length) {
    return jsonError("No valid Shopify media items were found for this shop.", 403, {
      invalidMediaIds: resolved.invalidMediaIds,
    });
  }

  return Response.json(resolved);
};
