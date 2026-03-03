import test from "node:test";
import assert from "node:assert/strict";
import { PLAN_CONFIG, FREE_PLAN_METHOD, buildPlanView } from "./plan.js";
import prisma from "../db.server.js";
import { reservePlanCapacity } from "./plan.server.js";

function getCurrentMonthStart() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

test("buildPlanView computes remaining quota", () => {
  const view = buildPlanView({
    plan: "free",
    periodStart: new Date("2026-01-01T00:00:00.000Z"),
    imagesProcessed: 40,
  });

  assert.equal(view.monthlyImageLimit, 100);
  assert.equal(view.remaining, 60);
  assert.equal(view.allowsFaceDetection, false);
});

test("buildPlanView clamps remaining quota at zero", () => {
  const view = buildPlanView({
    plan: "pro",
    periodStart: new Date("2026-01-01T00:00:00.000Z"),
    imagesProcessed: 9999,
  });

  assert.equal(view.monthlyImageLimit, 2000);
  assert.equal(view.remaining, 0);
  assert.equal(view.allowsFaceDetection, true);
});

test("plan constants include requested quotas and pricing", () => {
  assert.equal(PLAN_CONFIG.free.monthlyImageLimit, 100);
  assert.equal(PLAN_CONFIG.pro.monthlyImageLimit, 2000);
  assert.equal(PLAN_CONFIG.pro.monthlyPriceEur, 10);
  assert.equal(FREE_PLAN_METHOD, "center_content");
});

test("reservePlanCapacity maps free plan auto method to center_content", async (t) => {
  const originalFindUnique = prisma.shopPlanUsage.findUnique;
  prisma.shopPlanUsage.findUnique = async () => ({
    shop: "free-auto-test.myshopify.com",
    plan: "free",
    periodStart: getCurrentMonthStart(),
    imagesProcessed: 0,
  });
  t.after(() => {
    prisma.shopPlanUsage.findUnique = originalFindUnique;
  });

  const result = await reservePlanCapacity({
    shop: "free-auto-test.myshopify.com",
    imageCount: 1,
    method: "auto",
  });

  assert.deepEqual(
    { ok: result.ok, effectiveMethod: result.effectiveMethod },
    { ok: true, effectiveMethod: FREE_PLAN_METHOD },
  );
});

test("reservePlanCapacity rejects explicit paid-only face detection methods on free plan", async (t) => {
  const originalFindUnique = prisma.shopPlanUsage.findUnique;
  prisma.shopPlanUsage.findUnique = async () => ({
    shop: "free-face-method-test.myshopify.com",
    plan: "free",
    periodStart: getCurrentMonthStart(),
    imagesProcessed: 0,
  });
  t.after(() => {
    prisma.shopPlanUsage.findUnique = originalFindUnique;
  });

  const result = await reservePlanCapacity({
    shop: "free-face-method-test.myshopify.com",
    imageCount: 1,
    method: "frontal",
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /Face detection methods are available on the Pro plan/i);
});
