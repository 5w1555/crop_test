import { redirect } from "react-router";
import { login } from "../shopify.server";

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }
  return { showForm: Boolean(login) };
};

export default function Index() {
  return (
    <s-page heading="Smart Crop App">
      <s-stack gap="base">
        <s-paragraph>
          Welcome! The app has been cleaned up and is now running a minimal, working crop flow.
        </s-paragraph>
        <s-link to="/app/crop">
          → Go to the Crop Images tool (this is the only page you need right now)
        </s-link>

        <s-paragraph>
          <strong>Next steps after testing:</strong><br />
          • Add Shopify media selector<br />
          • Add billing + writeback<br />
          • Restore full marketing page (optional)
        </s-paragraph>
      </s-stack>
    </s-page>
  );
}