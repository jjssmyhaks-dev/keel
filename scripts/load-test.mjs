#!/usr/bin/env node
// Closed-loop HTTP load test with latency percentiles and honest pass/fail
// thresholds. Intended for a controlled run against a dev or staging server,
// never against production without explicit capacity planning.

import { parseArgs } from "node:util";

const { values: args } = parseArgs({
  options: {
    url: { type: "string", default: "http://localhost:3000/api/status" },
    method: { type: "string", default: "GET" },
    token: { type: "string" },
    body: { type: "string" },
    concurrency: { type: "string", default: "16" },
    duration: { type: "string", default: "15" },
    warmup: { type: "string", default: "5" },
    "p95-ms": { type: "string", default: "2000" },
    "error-rate": { type: "string", default: "0.01" },
    "timeout-ms": { type: "string", default: "10000" },
    help: { type: "boolean", short: "h" },
  },
});

if (args.help) {
  console.log(`Usage: node scripts/load-test.mjs [options]

  --url <url>            Target (default http://localhost:3000/api/status)
  --method <verb>        HTTP method (default GET)
  --token <token>        Bearer token, e.g. a demo secret key
  --body <json>          Request body for POST/PUT
  --concurrency <n>      Closed-loop workers (default 16)
  --duration <seconds>   Measured window after warmup (default 15)
  --warmup <n>           Sequential warmup requests (default 5)
  --p95-ms <ms>          Fail when p95 exceeds this (default 2000)
  --error-rate <0..1>    Fail when HTTP/network error rate exceeds this (default 0.01)
  --timeout-ms <ms>      Per-request timeout (default 10000)

Exits 0 when thresholds pass, 1 when they fail. Report JSON on stdout.`);
  process.exit(0);
}

const url = args.url;
const concurrency = Math.max(1, Number.parseInt(args.concurrency, 10) || 16);
const durationSeconds = Math.max(1, Number.parseInt(args.duration, 10) || 15);
const warmupRequests = Math.max(0, Number.parseInt(args.warmup, 10) || 0);
const p95Limit = Math.max(1, Number.parseInt(args["p95-ms"], 10) || 2000);
const errorRateLimit = Math.min(1, Math.max(0, Number.parseFloat(args["error-rate"]) || 0.01));
const timeoutMs = Math.max(100, Number.parseInt(args["timeout-ms"], 10) || 10000);

const headers = { "user-agent": "authab-load-test/1.0" };
if (args.token) headers.authorization = `Bearer ${args.token}`;
if (args.body) headers["content-type"] = "application/json";
if (args.method !== "GET" && args.method !== "HEAD" && !args.body) {
  console.error(`${args.method} requires --body`);
  process.exit(1);
}

const requestInit = {
  method: args.method.toUpperCase(),
  headers,
  body: args.body,
  redirect: "manual",
  signal: undefined,
};

const latencies = [];
const statuses = new Map();
let httpErrors = 0;
let networkErrors = 0;
let errorSamples = [];

async function once() {
  const started = performance.now();
  try {
    const response = await fetch(url, { ...requestInit, signal: AbortSignal.timeout(timeoutMs) });
    await response.arrayBuffer();
    const elapsed = performance.now() - started;
    latencies.push(elapsed);
    const key = String(response.status);
    statuses.set(key, (statuses.get(key) ?? 0) + 1);
    if (!response.ok) {
      httpErrors += 1;
      if (errorSamples.length < 5) errorSamples.push(`${response.status} ${response.statusText}`);
    }
    return elapsed;
  } catch (error) {
    const elapsed = performance.now() - started;
    latencies.push(elapsed);
    networkErrors += 1;
    if (errorSamples.length < 5) errorSamples.push(error.name || error.message);
    return elapsed;
  }
}

function percentile(values, fraction) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return Math.round(sorted[index] * 100) / 100;
}

async function main() {
  for (let i = 0; i < warmupRequests; i += 1) await once();
  latencies.length = 0;
  statuses.clear();
  httpErrors = 0;
  networkErrors = 0;
  errorSamples = [];

  const startedAt = performance.now();
  const deadline = startedAt + durationSeconds * 1000;
  let requests = 0;

  async function worker() {
    while (performance.now() < deadline) {
      await once();
      requests += 1;
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  const elapsedMs = performance.now() - startedAt;

  const errors = httpErrors + networkErrors;
  const errorRate = requests ? errors / requests : 0;
  const p95 = percentile(latencies, 0.95);
  const passed = errorRate <= errorRateLimit && p95 <= p95Limit;

  const report = {
    ok: passed,
    target: { url, method: requestInit.method, authenticated: Boolean(args.token) },
    concurrency,
    durationMs: Math.round(elapsedMs),
    requests,
    requestsPerSecond: Math.round((requests / (elapsedMs / 1000)) * 100) / 100,
    latencyMs: {
      p50: percentile(latencies, 0.5),
      p95,
      p99: percentile(latencies, 0.99),
      max: Math.round(Math.max(0, ...latencies) * 100) / 100,
    },
    statuses: Object.fromEntries([...statuses.entries()].sort()),
    errors: { total: errors, http: httpErrors, network: networkErrors, rate: Math.round(errorRate * 10000) / 10000, samples: errorSamples },
    thresholds: { p95Ms: p95Limit, errorRate: errorRateLimit },
    ranAt: new Date().toISOString(),
  };

  console.log(JSON.stringify(report, null, 2));
  if (!passed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`Load test failed: ${error.message}`);
  process.exit(1);
});
