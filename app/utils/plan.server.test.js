import test from "node:test";
import assert from "node:assert/strict";
import { PLAN_CONFIG, FREE_PLAN_METHOD, buildPlanView } from "./plan.js";

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
