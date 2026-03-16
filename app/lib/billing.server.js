export const PRO_PLAN = "Pro plan";

export const isBillingTestMode = process.env.SHOPIFY_BILLING_TEST_MODE === "true";

function getBillingReturnUrl(request) {
  const url = new URL(request.url);
  return `${url.origin}/app/billing`;
}

export async function getBillingState({ billing }) {
  const result = await billing.check({
    plans: [PRO_PLAN],
    isTest: isBillingTestMode,
  });
  return {
    ...result,
    activeSubscription: result.appSubscriptions[0] || null,
  };
}

export async function requestProPlan({ billing, request }) {
  return billing.request({
    plan: PRO_PLAN,
    isTest: isBillingTestMode,
    returnUrl: getBillingReturnUrl(request),
  });
}

export async function cancelProPlan({ billing, subscriptionId }) {
  return billing.cancel({
    subscriptionId,
    isTest: isBillingTestMode,
    prorate: true,
  });
}
