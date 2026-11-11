export type SloSample = {
  ok: boolean;
  latencyMs: number | null;
};

export type SloStatus = "no-data" | "healthy" | "at-risk" | "breaching";

export type SloSummary = {
  calls: number;
  errors: number;
  availability: number | null;
  errorRate: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  target: number;
  budgetUsed: number | null;
  budgetRemaining: number | null;
  status: SloStatus;
};

/** Nearest-rank percentile; returns null for an empty sample. */
export function percentile(values: number[], p: number): number | null {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const rank = Math.ceil((Math.min(Math.max(p, 0), 100) / 100) * sorted.length) - 1;
  return sorted[Math.min(Math.max(rank, 0), sorted.length - 1)];
}

export function summarizeSlo(samples: SloSample[], target = 0.995): SloSummary {
  const calls = samples.length;
  const latencies = samples
    .map((sample) => sample.latencyMs)
    .filter((value): value is number => value !== null && Number.isFinite(value));

  if (!calls) {
    return {
      calls: 0,
      errors: 0,
      availability: null,
      errorRate: null,
      p50Ms: null,
      p95Ms: null,
      target,
      budgetUsed: null,
      budgetRemaining: null,
      status: "no-data",
    };
  }

  const errors = samples.filter((sample) => !sample.ok).length;
  const errorRate = errors / calls;
  const availability = 1 - errorRate;
  const allowed = Math.max(1 - target, 0.000001);
  const budgetUsed = errorRate / allowed;
  // Boundaries are tolerant so exact-ratio cases are not decided by float noise.
  const status: SloStatus = budgetUsed <= 1 + 1e-9 ? "healthy" : budgetUsed <= 2 + 1e-9 ? "at-risk" : "breaching";
  return {
    calls,
    errors,
    availability,
    errorRate,
    p50Ms: percentile(latencies, 50),
    p95Ms: percentile(latencies, 95),
    target,
    budgetUsed,
    budgetRemaining: Math.max(0, 1 - budgetUsed),
    status,
  };
}

/** Reads a provider sample from the audit payload written by the proxy. */
export function sampleFromAudit(payloadSummary: string, outcome: string): SloSample | null {
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(payloadSummary || "{}") as Record<string, unknown>;
  } catch {
    return null;
  }
  const status = typeof payload.status === "number" && Number.isFinite(payload.status) ? payload.status : null;
  const latency =
    typeof payload.latencyMs === "number" && Number.isFinite(payload.latencyMs) ? payload.latencyMs : null;
  if (status === null && outcome !== "error") return null;
  return {
    ok: outcome === "allowed" && status !== null && status < 400 && !payload.providerError,
    latencyMs: latency,
  };
}
