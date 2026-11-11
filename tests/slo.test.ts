import assert from "node:assert/strict";
import test from "node:test";
import { percentile, sampleFromAudit, summarizeSlo } from "../src/lib/slo";

test("percentile uses nearest-rank and ignores empty input", () => {
  assert.equal(percentile([], 95), null);
  assert.equal(percentile([42], 95), 42);
  assert.equal(percentile([10, 20, 30, 40], 50), 20);
  assert.equal(percentile([10, 20, 30, 40], 95), 40);
  assert.equal(percentile([40, 10, 30, 20], 50), 20);
  assert.equal(percentile([10, Number.NaN, 30], 50), 10);
});

test("a provider with no calls reports no-data instead of a fake availability", () => {
  const summary = summarizeSlo([]);
  assert.equal(summary.status, "no-data");
  assert.equal(summary.calls, 0);
  assert.equal(summary.availability, null);
  assert.equal(summary.p95Ms, null);
});

test("availability, budget and percentile are computed from real samples", () => {
  const samples = Array.from({ length: 100 }, (_, index) => ({
    ok: index !== 0,
    latencyMs: index + 1,
  }));
  const summary = summarizeSlo(samples, 0.99);
  assert.equal(summary.calls, 100);
  assert.equal(summary.errors, 1);
  assert.equal(summary.errorRate, 0.01);
  assert.equal(summary.availability, 0.99);
  assert.ok(Math.abs((summary.budgetUsed ?? 0) - 1) < 1e-9);
  assert.equal(summary.status, "healthy");
  assert.equal(summary.p50Ms, 50);
  assert.equal(summary.p95Ms, 95);
});

test("three percent errors against a 99% target breaches the budget", () => {
  const samples = Array.from({ length: 100 }, (_, index) => ({
    ok: index > 2,
    latencyMs: null,
  }));
  const summary = summarizeSlo(samples, 0.99);
  assert.equal(summary.errors, 3);
  assert.ok(Math.abs((summary.budgetUsed ?? 0) - 3) < 1e-9);
  assert.equal(summary.status, "breaching");
  assert.equal(summary.p95Ms, null);
});

test("budget between one and two times is at risk", () => {
  const samples = Array.from({ length: 1000 }, (_, index) => ({
    ok: index > 14,
    latencyMs: 10,
  }));
  const summary = summarizeSlo(samples, 0.99);
  assert.equal(summary.errors, 15);
  assert.ok(Math.abs((summary.budgetUsed ?? 0) - 1.5) < 1e-9);
  assert.equal(summary.status, "at-risk");
  assert.equal(summary.budgetRemaining, 0);
});

test("audit payloads tolerate errors without an upstream response", () => {
  const timeout = sampleFromAudit(
    JSON.stringify({ action: "messages.send", error: "The operation was aborted due to timeout" }),
    "error",
  );
  assert.deepEqual(timeout, { ok: false, latencyMs: null });

  const rejected = sampleFromAudit(
    JSON.stringify({ action: "messages.send", status: 401, latencyMs: 25 }),
    "error",
  );
  assert.deepEqual(rejected, { ok: false, latencyMs: 25 });

  const allowed = sampleFromAudit(
    JSON.stringify({ action: "messages.send", status: 200, latencyMs: 25 }),
    "allowed",
  );
  assert.deepEqual(allowed, { ok: true, latencyMs: 25 });

  const providerFailure = sampleFromAudit(
    JSON.stringify({ status: 200, latencyMs: 30, providerError: "invalid_grant" }),
    "allowed",
  );
  assert.equal(providerFailure?.ok, false);

  assert.equal(sampleFromAudit("not json", "allowed"), null);
  assert.equal(sampleFromAudit(JSON.stringify({ action: "x" }), "recorded"), null);
});
