import { useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getBillingState, requestProPlan } from "../utils/billing.server";

export const loader = async ({ request }) => {
  const { billing } = await authenticate.admin(request);
  const billingState = await getBillingState({ billing });
  return {
    hasActivePayment: billingState.hasActivePayment,
    activeSubscription: billingState.activeSubscription,
  };
};

export const action = async ({ request }) => {
  const { billing } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");

  const billingState = await getBillingState({ billing });

  if (intent === "start" && !billingState.hasActivePayment) {
    return requestProPlan({ billing, request });
  }

  if (intent === "cancel" && billingState.activeSubscription) {
    await billing.cancel({
      subscriptionId: billingState.activeSubscription.id,
      isTest: true,
      prorate: true,
    });
  }

  return null;
};

export default function BillingPage() {
  const { hasActivePayment, activeSubscription } = useLoaderData();

  return (
    <s-page heading="Billing">
      <s-section heading="Pro subscription">
        <s-stack direction="block" gap="small">
          <s-text>
            Status: {hasActivePayment ? "Active" : "Not active"}
          </s-text>
          {activeSubscription && (
            <s-text tone="subdued">
              Subscription ID: <code>{activeSubscription.id}</code>
            </s-text>
          )}
          <s-text>
            Pro includes 2,000 images/month and all face-detection crop methods for €10/month.
          </s-text>

          <form method="post">
            <s-stack direction="inline" gap="small">
              {!hasActivePayment && (
                <s-button type="submit" name="intent" value="start">
                  Start Pro subscription
                </s-button>
              )}
              {hasActivePayment && (
                <s-button type="submit" name="intent" value="cancel" variant="secondary">
                  Cancel Pro subscription
                </s-button>
              )}
            </s-stack>
          </form>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
