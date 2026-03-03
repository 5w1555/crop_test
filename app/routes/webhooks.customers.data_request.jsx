import { authenticate } from "../shopify.server";

export const action = async ({ request }) => {
  const requestId =
    request.headers.get("x-request-id") ??
    request.headers.get("x-shopify-webhook-id") ??
    "unknown";

  const { payload, topic, shop } = await authenticate.webhook(request);

  const dataRequest = payload && typeof payload === "object" ? payload : {};

  console.log(
    `[webhook][${requestId}] Received ${topic} for ${shop} (customerId=${dataRequest.customer?.id ?? "n/a"}, ordersRequested=${Array.isArray(dataRequest.orders_requested) ? dataRequest.orders_requested.length : 0})`,
  );

  return new Response(null, { status: 200 });
};
