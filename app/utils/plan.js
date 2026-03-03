export const PLAN_CONFIG = {
  free: {
    key: "free",
    label: "Free",
    monthlyImageLimit: 100,
    allowsFaceDetection: false,
    monthlyPriceEur: 0,
  },
  pro: {
    key: "pro",
    label: "Pro",
    monthlyImageLimit: 2000,
    allowsFaceDetection: true,
    monthlyPriceEur: 10,
  },
};

export const FACE_DETECTION_METHODS = new Set([
  "head_bust",
  "frontal",
  "profile",
  "chin",
  "nose",
  "below_lips",
]);

export const FREE_PLAN_METHOD = "center_content";

export function buildPlanView(usage) {
  const plan = PLAN_CONFIG[usage.plan] || PLAN_CONFIG.free;
  const remaining = Math.max(plan.monthlyImageLimit - usage.imagesProcessed, 0);

  return {
    ...plan,
    periodStart: usage.periodStart,
    imagesProcessed: usage.imagesProcessed,
    remaining,
  };
}
