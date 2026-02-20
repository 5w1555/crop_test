import prisma from "../db.server";
import {
  buildPlanView,
  FACE_DETECTION_METHODS,
  FREE_PLAN_METHOD,
  PLAN_CONFIG,
} from "./plan.js";

function getPeriodStart(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function getPaidShopsFromEnv() {
  return new Set(
    String(process.env.PAID_PLAN_SHOPS || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

function resolvePlanKey(shop, persistedPlan) {
  if (persistedPlan && PLAN_CONFIG[persistedPlan]) {
    return persistedPlan;
  }

  if (getPaidShopsFromEnv().has(shop)) {
    return "pro";
  }

  return "free";
}

export async function getShopPlanUsage(shop) {
  const monthStart = getPeriodStart();
  const existing = await prisma.shopPlanUsage.findUnique({ where: { shop } });

  if (!existing) {
    const plan = resolvePlanKey(shop);
    return prisma.shopPlanUsage.create({
      data: {
        shop,
        plan,
        periodStart: monthStart,
      },
    });
  }

  const nextPlan = resolvePlanKey(shop, existing.plan);
  const shouldResetMonth = existing.periodStart.getTime() !== monthStart.getTime();
  if (!shouldResetMonth && nextPlan === existing.plan) {
    return existing;
  }

  return prisma.shopPlanUsage.update({
    where: { shop },
    data: {
      plan: nextPlan,
      periodStart: shouldResetMonth ? monthStart : existing.periodStart,
      imagesProcessed: shouldResetMonth ? 0 : existing.imagesProcessed,
    },
  });
}

export async function reservePlanCapacity({ shop, imageCount, method }) {
  const usage = await getShopPlanUsage(shop);
  const planView = buildPlanView(usage);

  if (!planView.allowsFaceDetection && FACE_DETECTION_METHODS.has(method)) {
    return {
      ok: false,
      error: `Face detection methods are available on the ${PLAN_CONFIG.pro.label} plan. Free plan uses ${FREE_PLAN_METHOD}.`,
      plan: planView,
    };
  }

  if (imageCount > planView.remaining) {
    return {
      ok: false,
      error: `This request exceeds your monthly image quota. Remaining: ${planView.remaining}/${planView.monthlyImageLimit}.`,
      plan: planView,
    };
  }

  return {
    ok: true,
    effectiveMethod: planView.allowsFaceDetection ? method : FREE_PLAN_METHOD,
    plan: planView,
  };
}

export async function commitPlanUsage({ shop, imageCount }) {
  const usage = await getShopPlanUsage(shop);
  return prisma.shopPlanUsage.update({
    where: { shop },
    data: {
      imagesProcessed: usage.imagesProcessed + imageCount,
    },
  });
}
