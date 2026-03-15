import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return null;
};

export default function Index() {
  return (
    <s-page heading="Smart Crop app home">
      <s-section heading="Start with Crop Image">
        <s-paragraph>
          Use <s-link href="/app/additional">Crop Image</s-link> to choose media
          from your Shopify library, crop it, and save the updated media directly
          back to your store.
        </s-paragraph>
      </s-section>

      <s-section heading="Deployment checklist">
        <s-unordered-list>
          <s-list-item>
            Set <code>SMARTCROP_API_URL</code> on the Node app service.
          </s-list-item>
          <s-list-item>
            Set <code>SMARTCROP_FRONTEND_ORIGINS</code> on the FastAPI service
            to your production app URL(s).
          </s-list-item>
          <s-list-item>
            Keep Shopify app URLs in sync with <code>shopify app deploy</code>{" "}
            after URL updates.
          </s-list-item>
        </s-unordered-list>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
