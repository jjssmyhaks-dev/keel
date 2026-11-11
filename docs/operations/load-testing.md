# Load testing

`scripts/load-test.mjs` is a closed-loop HTTP load test. It reports p50/p95/p99 latency, throughput, status codes and error classes, and exits non-zero when configurable thresholds fail.

## Running

```bash
# Unauthenticated control-plane check
npm run loadtest -- --url http://localhost:3000/api/status --concurrency 16 --duration 15

# Authenticated API-key read path
npm run loadtest -- --url http://localhost:3000/api/v1/me \
  --token "$DEMO_SECRET_KEY" --concurrency 8 --duration 15

# Proxy execution path against the sandbox connector (no provider egress)
npm run loadtest -- --url http://localhost:3000/api/v1/proxy/sandbox --method POST \
  --token "$AGENT_TOKEN" --body '{"action":"sandbox.echo","input":{"message":"load"}}'
```

Options: `--p95-ms` (default 2000), `--error-rate` (default 0.01), `--timeout-ms` (default 10000), `--warmup` (default 5). The JSON report is printed to stdout, so a CI job or operations log can archive it.

## Recorded runs — 11 November 2026

Environment: Windows laptop, `next dev` on localhost, Neon Postgres in `ap-southeast-1` (Singapore), client in India, one Prisma connection pool per server process.

| Target | Concurrency | Requests | RPS | p50 | p95 | p99 | Errors |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `GET /api/status` (DB count + JSON) | 16 | 478 | 31.1 | 486 ms | 610 ms | 1296 ms | 0 |
| `GET /api/v1/me` (API-key auth + DB) | 8 | 138 | 8.8 | 815 ms | 1522 ms | 1712 ms | 0 |
| `POST /api/v1/proxy/sandbox` (agent token, full proxy chain) | 8 | 46 | 2.1 | 3232 ms | 6850 ms | 7436 ms | 0 |
| `POST /api/v1/proxy/sandbox` (agent token, full proxy chain) | 4 | 40 | 1.9 | 2005 ms | 2530 ms | 3145 ms | 0 |

The two proxy runs return `200` with `decision.effect: "allow"` for every request and no HTTP or network errors, but both **fail the 2 s p95 threshold** and the load test exits non-zero (`ok: false`). That is the honest result: one proxied call performs agent authentication (token verify + DB loads), connector resolution, credential lookup, environment settings, grant/policy evaluation, the action itself, and an audit insert — roughly eight to ten sequential database round trips before the response. At ~100–200 ms WAN latency per trip to Singapore and `next dev` compile overhead, p95 lands between 2.5 s and 6.9 s at these concurrencies. The `sandbox.echo` action itself reports `latencyMs: 1`; the time is control-plane and database latency, not provider egress.

These numbers are a regression baseline for the proxy path, not an SLO. A production deployment colocated with Postgres, with a warm build and a sized connection pool, is the configuration that should be measured before publishing any latency target. Re-run both concurrencies after any change to the proxy request path and compare against this table.

The two control-plane runs passed the 2 s p95 and 1% error thresholds. No HTTP or network errors were observed and every response was `200`.

## What these numbers mean — and do not mean

- They are **development-mode measurements**, not capacity numbers. `next dev` compiles on demand, runs with source maps and is not the production server.
- Latitude matters: each database round trip crosses roughly 100–200 ms of WAN latency to Singapore. A production deployment in the same region as Postgres removes most of the p50.
- The authenticated path is slower because it hashes the key, loads the key with its environment/project/organisation chain, and touches Prisma before returning JSON.
- The proxy runs exercise the full control plane including policy evaluation, grant checks and the audit write path, but still no upstream provider egress: the sandbox connector answers locally. Provider egress latency must be measured against real connectors in staging.
- The numbers are not an SLO. They are a baseline to compare future runs against, recorded here so regressions are visible.

## Before testing anything production-like

- Get explicit approval and a traffic window. This is a load generator; it will consume database connections and Neon compute.
- Size concurrency to the deployed connection pool and the plan's compute limits. Neon autoscaling reacts in seconds, but the application pool caps throughput first.
- Prefer staging with production-like data volume. The demo dataset (511 rows) hides query-plan problems that appear at scale.
- Watch the provider SLO dashboards and the database metrics during the run; a passing p95 with saturated connections is still a capacity risk.

## Retained test data

The proxy runs above used a throwaway organisation (`load-proxy-…`) with its own project, environment, agent and sandbox credential. The organisation is marked `planStatus: canceled` and its API keys are revoked, so it can no longer serve traffic. Its audit events are intentionally retained: the audit table is append-only under WORM retention, and deleting the organisation would cascade into that chain, which the database refuses. Do not bypass the guard for cleanup — mark test workspaces non-billing and revoked instead.
