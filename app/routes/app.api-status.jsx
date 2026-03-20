import { data } from "react-router";
import { testSmartCropApi } from "../lib/crop/client.server.js";
 
// No authenticate.admin here — this is called by useFetcher from the browser
// and Shopify's auth redirect breaks fetcher JSON responses silently.
// The route is internal-only (no sensitive data, just a health probe).
 
export const loader = async () => {
  const result = await testSmartCropApi();
  const status = result.ok ? 200 : 503;
  return data(result, { status });
};
 