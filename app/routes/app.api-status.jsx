import { json } from "react-router";
import { authenticate } from "../shopify.server";
import { testSmartCropApi } from "../lib/crop/client.server.js";

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  const result = await testSmartCropApi();
  const status = result.ok ? 200 : 503;

  return json(result, { status });
};
