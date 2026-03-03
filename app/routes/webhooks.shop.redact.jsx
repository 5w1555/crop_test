import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }) => {
  const requestId =
    request.headers.get("x-request-id") ??
    request.headers.get("x-shopify-webhook-id") ??
    "unknown";

  const { payload, topic, shop } = await authenticate.webhook(request);

  const shopRedaction = payload && typeof payload === "object" ? payload : {};

  await Promise.all([
    db.session.deleteMany({ where: { shop } }),
    db.shopPlanUsage.deleteMany({ where: { shop } }),
  ]);

  console.log(
    `[webhook][${requestId}] Received ${topic} for ${shop} (shopId=${shopRedaction.shop_id ?? "n/a"}) and deleted local records`,
  );

  return new Response(null, { status: 200 });
};
