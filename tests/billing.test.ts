import assert from "node:assert/strict";
import test from "node:test";
import {
  DUNNING_GRACE_DAYS,
  TRIAL_DAYS,
  billingAddressLines,
  daysUntil,
  dunningEscalationDue,
  invoiceDisplayStatus,
  parseBillingAddress,
  trialEligible,
  usageStatementCsv,
} from "../src/lib/billing-rules";

test("trials are offered once per organisation", () => {
  assert.equal(trialEligible({ stripeSubscriptionId: null, trialEndsAt: null }), true);
  assert.equal(trialEligible({ stripeSubscriptionId: "sub_123", trialEndsAt: null }), false);
  assert.equal(trialEligible({ stripeSubscriptionId: null, trialEndsAt: new Date() }), false);
  assert.ok(TRIAL_DAYS > 0);
});

test("daysUntil rounds up and never goes negative", () => {
  const now = new Date("2026-11-11T00:00:00Z");
  assert.equal(daysUntil(new Date("2026-11-12T12:00:00Z"), now), 2);
  assert.equal(daysUntil(new Date("2026-11-17T23:59:00Z"), now), 7);
  assert.equal(daysUntil(new Date("2026-11-01T00:00:00Z"), now), 0);
  assert.equal(daysUntil(null, now), null);
});

test("dunning escalates after the grace window", () => {
  const now = new Date("2026-11-11T00:00:00Z");
  assert.equal(dunningEscalationDue(null, now), false);
  assert.equal(dunningEscalationDue(new Date("2026-11-05T00:00:00Z"), now), false);
  assert.equal(
    dunningEscalationDue(new Date(now.getTime() - DUNNING_GRACE_DAYS * 86_400_000), now),
    true,
  );
  assert.equal(dunningEscalationDue(new Date("2026-10-01T00:00:00Z"), now), true);
});

test("invoice statuses map to display labels", () => {
  assert.deepEqual(invoiceDisplayStatus("paid"), { label: "Paid", badge: "approved" });
  assert.deepEqual(invoiceDisplayStatus("open"), { label: "Open", badge: "pending" });
  assert.deepEqual(invoiceDisplayStatus("void"), { label: "Void", badge: "revoked" });
  assert.deepEqual(invoiceDisplayStatus("uncollectible"), { label: "Uncollectible", badge: "failed" });
  assert.deepEqual(invoiceDisplayStatus("PAID"), { label: "Paid", badge: "approved" });
  assert.deepEqual(invoiceDisplayStatus("custom"), { label: "custom", badge: "recorded" });
});

test("usage statement is honest about overage and invoices", () => {
  const csv = usageStatementCsv({
    organization: "Northwind Labs",
    plan: "Pro",
    allowance: 100,
    generatedAt: new Date("2026-11-11T09:00:00Z"),
    rows: [
      { period: "2026-11", calls: 120 },
      { period: "2026-10", calls: 40 },
    ],
  });
  assert.match(csv, /# Authab usage statement/);
  assert.match(csv, /# Organization: Northwind Labs/);
  assert.match(csv, /# This is a usage statement, not a tax invoice/);
  assert.match(csv, /period,calls,included_calls,overage_calls,note/);
  assert.match(csv, /2026-11,120,100,20,"Calls over the allowance were refused, not billed"/);
  assert.match(csv, /2026-10,40,100,0,\n/);
});

test("usage statement marks unlimited allowances", () => {
  const csv = usageStatementCsv({
    organization: "Scale Co",
    plan: "Scale",
    allowance: -1,
    generatedAt: new Date("2026-11-11T09:00:00Z"),
    rows: [{ period: "2026-11", calls: 9000 }],
  });
  assert.match(csv, /2026-11,9000,unlimited,0,/);
});

test("usage statement escapes commas in organisation names", () => {
  const csv = usageStatementCsv({
    organization: "Acme, Inc.\nSecond line",
    plan: "Pro",
    allowance: 10,
    generatedAt: new Date("2026-11-11T09:00:00Z"),
    rows: [],
  });
  assert.match(csv, /# Organization: Acme, Inc\. Second line/);
});

test("billing addresses parse defensively", () => {
  const parsed = parseBillingAddress(
    JSON.stringify({ line1: " 1 Main St ", city: "Pune", postalCode: "411001", country: "in" }),
  );
  assert.deepEqual(parsed, { line1: "1 Main St", city: "Pune", postalCode: "411001", country: "IN" });
  assert.deepEqual(parseBillingAddress(""), { line1: "", city: "", postalCode: "", country: "" });
  assert.deepEqual(parseBillingAddress("not-json"), { line1: "", city: "", postalCode: "", country: "" });
  assert.deepEqual(parseBillingAddress("[1,2]"), { line1: "", city: "", postalCode: "", country: "" });
  assert.deepEqual(billingAddressLines(parsed), ["1 Main St", "411001 Pune", "IN"]);
  assert.deepEqual(billingAddressLines(parseBillingAddress(null)), []);
});
