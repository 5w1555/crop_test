import { PRO_PLAN } from "./billing";

function getBillingReturnUrl(request) {
  const url = new URL(request.url);
  return `${url.origin}/app/billing`;
}

export async function getBillingState({ billing }) {
  const result = await billing.check({ plans: [PRO_PLAN], isTest: true });
  return {
    ...result,
    activeSubscription: result.appSubscriptions[0] || null,
  };
}

export async function requestProPlan({ billing, request }) {
  return billing.request({
    plan: PRO_PLAN,
    isTest: true,
    returnUrl: getBillingReturnUrl(request),
  });
}
