import assert from "node:assert/strict";
import test from "node:test";
import { PLANS, planFor, formatPrice } from "../src/lib/plans";
import { monthPeriod, productionAccess } from "../src/lib/limits";

test("planFor falls back to free for unknown plans", () => {
  assert.equal(planFor("not-a-plan").key, "free");
  assert.equal(planFor("").key, "free");
  assert.equal(planFor("pro").key, "pro");
});

test("only paid plans unlock production", () => {
  assert.equal(planFor("free").production, false);
  for (const key of ["pro", "scale", "enterprise"]) {
    assert.equal(planFor(key).production, true, `${key} should allow production`);
  }
  assert.equal(productionAccess("free").allowed, false);
  assert.equal(productionAccess("pro").allowed, true);
});

test("plan limits increase with plan tier", () => {
  const ordered = ["free", "pro", "scale"].map(planFor);
  for (const metric of ["agents", "callsPerMonth", "credentials", "retentionDays", "members"] as const) {
    for (let i = 1; i < ordered.length; i += 1) {
      assert.ok(
        ordered[i].limits[metric] > ordered[i - 1].limits[metric],
        `${metric} should grow from ${ordered[i - 1].key} to ${ordered[i].key}`,
      );
    }
  }
  assert.equal(planFor("enterprise").limits.agents, -1);
});

test("plan keys are unique and every plan has a name and CTA", () => {
  const keys = new Set(PLANS.map((plan) => plan.key));
  assert.equal(keys.size, PLANS.length);
  for (const plan of PLANS) {
    assert.ok(plan.name.length > 0);
    assert.ok(plan.cta.length > 0);
    assert.ok(plan.features.length > 0);
  }
});

test("formatPrice renders both currencies", () => {
  const pro = planFor("pro");
  assert.equal(formatPrice(pro, "USD"), "$49");
  assert.equal(formatPrice(pro, "INR"), "₹3,999");
  assert.equal(formatPrice(planFor("free"), "INR"), "₹0");
  assert.equal(formatPrice(planFor("enterprise"), "USD"), "Custom");
});

test("monthPeriod is calculated in UTC", () => {
  assert.equal(monthPeriod(new Date(Date.UTC(2026, 0, 31, 20, 0, 0))), "2026-01");
  assert.equal(monthPeriod(new Date(Date.UTC(2026, 10, 1, 0, 0, 0))), "2026-11");
  assert.equal(monthPeriod(new Date(Date.UTC(2026, 8, 9, 12, 0, 0))), "2026-09");
});
