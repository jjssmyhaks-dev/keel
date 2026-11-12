# Authab

Identity, vault and governance for AI agents. Authab gives every agent a verifiable Ed25519 identity, keeps provider credentials out of agent code, evaluates every outbound call against grants and policy, routes risky calls to a human, and records the whole thing in a tamper-evident audit chain.

Agents do not need long-lived API keys: OAuth-connected credentials refresh automatically, client secrets and RFC 8693 token exchange issue short-lived tokens (optionally DPoP-bound), and SPIFFE/Kubernetes/OIDC workload identities can exchange their own JWT for an agent token. Policies can be dry-run with a full trace, and connectors can be imported from OpenAPI 3 when the built-in catalogue does not cover a provider.

This repository contains the hosted product, the marketing site and documentation, plus TypeScript and Python SDKs, framework integrations, the CLI, the MCP stdio server and the hosted MCP gateway.

Enterprise controls ship in the product: OIDC and SAML single sign-on with per-domain access control and optional enforcement, SCIM 2.0 provisioning, enforced TOTP MFA with recovery codes, and seven roles with capability grants. Audit events are append-only, stream to a webhook or Splunk HEC sink with HMAC-signed envelopes and a resumable cursor, and every proxied call has a trust view showing what was injected, what was redacted and the request ID. Operations includes provider SLO dashboards, request error tracking, optional OpenTelemetry traces, an incident-backed status page and a published subprocessor list. Billing adds one-time trials, tax-aware checkout, dunning and CSV usage statements.

## What is here

| Path | What it is |
| --- | --- |
| `src/` | Next.js 16 app: landing site, docs, dashboard, and the `/api/v1` platform API |
| `prisma/` | Postgres schema and demo seed (Northwind Labs) |
| `sdk/` | `@authab/sdk` — server-side TypeScript client, AI SDK tools and framework-neutral tool specs |
| `python/` | `authab-sdk` — zero-dependency Python client with LangChain/LangGraph, CrewAI and OpenAI Agents adapters |
| `cli/` | `@authab/cli` — terminal client (`authab`) |
| `mcp/` | `@authab/mcp` — MCP stdio server with governed tools |
| `src/app/api/mcp/` | Hosted MCP gateway (Streamable HTTP) and public registry manifest |
| `docs/operations/` | Backup/restore and load-test runbooks, including recorded baselines |
| `scripts/` | Backup, restore and load-test utilities used by the npm scripts |
| `.github/workflows/` | CI: typecheck, unit tests, connector checks, package builds and a production build |
| `.authab/` | Local runtime state (dev secrets, dev server log); never commit |

The app and docs are at `/`, `/docs`, `/pricing`, `/security`, `/status`, `/trust`, `/blog`, `/legal/*`. The dashboard is at `/app`; the platform API is at `/api/v1`, SCIM at `/api/scim/v2` and SSO callbacks under `/api/sso`.

## Quickstart

Requires Node 20+ (Node 22 recommended).

```bash
npm install
cp .env.example .env   # set DATABASE_URL and DATABASE_URL_UNPOOLED to your Neon branch
npm run setup          # prisma generate + migrate deploy
npm run db:seed        # optional demo workspace (Northwind Labs)
npm run dev
```

Or let the Neon CLI create both URLs and pull the rest of the service credentials:

```bash
npx neon@latest login
npx neon@latest init -y --org-id <org> --project-id <project> --branch production
npx neon@latest deploy
```

`DATABASE_URL` is the pooled endpoint the app uses; `DATABASE_URL_UNPOOLED` is the direct endpoint Prisma uses for `db push` and migrations. The schema is Postgres — see [Neon](#neon) below.

Open http://localhost:3000 and sign in with the seeded owner after running the seed step:

```
demo@authab.dev
AuthabDemo!2026
```

The seed also creates a development secret key for the demo workspace: `sk_dev_demo_northwind_2026`. Treat it as a local demo fixture, not a production key.

On first boot the app writes development-only keys to `.authab/dev-secrets.json` (mode `0600`). Production must supply `MASTER_KEY`, `JWT_SIGNING_PRIVATE_KEY` and `AUTH_COOKIE_SECRET` through the environment.

## How a call flows

```
agent runtime
  │  1. signs a challenge with its Ed25519 key
  ▼
POST /api/v1/agents/:id/token        → short-lived EdDSA JWT (60–3600s)
  │
  ▼  2. POST /api/v1/proxy/:connector   Authorization: Bearer <agent JWT>
Authab
  ├─ verifies token, environment and revocation
  ├─ connector → action → agent status → credential → grant → resource → conditions
  ├─ allow             → decrypt credential, execute, audit
  ├─ require_approval  → store redacted request, return 202 + approval URL
  └─ deny              → 403 with the deciding rule
  ▼
audit event with per-environment SHA-256 hash chain
```

Read calls are allowed in development and production when granted. Writes are allowed in development but require approval in production by default. Destructive and financial actions require approval in both. **Safe launch** overrides non-read calls to require approval for the first seven days after promotion.

## Sandbox playground

`/app/playground` exercises the proxy before a provider key exists. It calls the same `POST /api/v1/proxy/sandbox` endpoint agents use, provisioning a sandbox connection row with no stored secret and a sandbox-only grant (`sandbox.*`) on first run. Five actions cover read, write, financial, destructive and admin risk; agent status, grants, resource patterns, conditions, policy, approvals and rate limits all run unchanged.

Allowed runs execute in-process and return a synthetic envelope — no secret is decrypted and no network request leaves the app. Financial, destructive and admin actions open a real approval that executes the stored sandbox call when decided. Sandbox events land in the audit chain as `sandbox.call`, count toward grant call caps, and are excluded from billable proxy usage.

## Enterprise controls

**Single sign-on.** OIDC (discovery + PKCE) and SAML 2.0 connections are configured per organisation at `/app/security/sso`. Each connection is bound to email domains; the start and completion routes reject a mismatched domain, and a connection can be marked enforced so members must use it. SP metadata is served at `/api/sso/:id/metadata` and the SAML ACS at `/api/sso/:id/acs`; SSO state is a signed, single-use cookie. First sign-in provisions a membership with the role mapped from IdP groups.

**SCIM 2.0.** `/api/scim/v2` supports Users: create, filter queries, PATCH and deprovisioning. `Groups` is served as an empty list — roles come from IdP group claims at SSO sign-in, not from SCIM group membership. Bearer tokens use the `scim_` prefix and are stored as SHA-256 hashes with a display prefix. Deprovisioning suspends the membership and revokes its sessions; the owner role cannot be deprovisioned through SCIM. Every SCIM write is audited.

**MFA and roles.** TOTP enrolment at `/mfa/enroll` issues one-time recovery codes stored as hashes. An organisation can require MFA; the requirement is enforced at sign-in and again on each dashboard request. Roles are `owner`, `admin`, `developer`, `approver`, `auditor`, `billing` and `viewer`, with optional capability grants that narrow what a role can do.

**Audit streaming and the trust view.** Audit sinks deliver HMAC-signed envelopes (`signature = HMAC-SHA256(secret, timestamp + "." + body)`) to a webhook or Splunk HEC endpoint. Each environment advances a persisted cursor, and failed deliveries retry with backoff; `/app/security/streaming` configures and sends a test delivery. The audit detail page for a call shows its decision, credential source, injected headers/params/body fields, redactions and request ID.

**Observability and status.** The instrumentation hook records request errors; `/app/observability` shows open errors, provider p50/p95 latency and SLO health. Proxy calls and errors are wrapped in OpenTelemetry spans, and setting `OTEL_EXPORTER_OTLP_ENDPOINT` exports them (incoming `traceparent` headers are used to correlate errors). `/status` renders real incidents managed at `/app/admin/status`, with an RSS feed at `/status/feed.xml`. `/trust` and `/trust/subprocessors.json` publish the subprocessor list; the page states plainly that no SOC 2 Type II report exists yet.

**Billing maturity.** Checkout enables Stripe automatic tax and tax-ID collection, organisations without a subscription can take a one-time trial, failed payments start a dunning escalation, and `/app/billing/usage` downloads a CSV usage statement (labelled a statement, not a tax invoice).

## Neon

The app runs on Neon Postgres. `neon.ts` declares the branch policy and the services used by this deployment:

| Service | Status |
| --- | --- |
| Postgres | Wired through Prisma (`DATABASE_URL` pooled, `DATABASE_URL_UNPOOLED` direct) |
| Neon Auth | Provisioned; the app keeps its own database-backed sessions |
| Object Storage | Provisioned for future asset uploads; no upload flow ships yet |
| Functions | `hello` deployed as a smoke-test function |
| Realtime | Provisioned; the dashboard reads through the API, not a live subscription |
| AI Gateway | Removed from `neon.ts`; the Free plan cannot serve gateway requests |

`neon deploy` writes the service credentials to `.env`. Never commit `.env` or `.neon`.

## Provider egress

Every environment calls providers for real. Policy, approvals, rate limits and audit run first; then Authab decrypts the credential and performs the request. Responses return the provider's own status and body. Calls are capped at 2 MB, restricted to the connector's allowed hosts, and redirects may not leave the credential's origin.

## API at a glance

| Group | Endpoints |
| --- | --- |
| Context | `GET /me`, `GET /connectors` (built-in and active custom connectors, plus custom metadata) |
| Agents | `GET/POST /agents`, `GET/PATCH/DELETE /agents/:id`, `POST /agents/:id/{token,pause,resume,suspend,kill,rotate-key,transfer,promote}`, `GET/POST /agents/:id/client-secrets`, `DELETE /agents/:id/client-secrets/:secretId` |
| Tokens | `POST /tokens/introspect`, `POST /tokens/revoke`, `POST /tokens/client-credentials`, `POST /tokens/exchange`, `POST /tokens/workload-exchange` |
| Workload identity | `GET/POST /workload-identities`, `GET/PATCH/DELETE /workload-identities/:id` |
| Vault | `GET/POST /credentials`, `GET/PATCH/DELETE /credentials/:id`, `POST /credentials/:id/refresh`, `POST /credentials/:id/check` |
| Grants | `GET/POST /grants`, `GET/PATCH/DELETE /grants/:id`, `POST /grants/request` (agent JWT, just-in-time) |
| Policy | `POST /policy/simulate`, `GET/POST /approval-policies`, `GET/PATCH/DELETE /approval-policies/:id` |
| Connectors | `POST /connectors` (OpenAPI 3 import), `GET/DELETE /connectors/:slug`, `POST /connectors/:slug/rollback` |
| Approvals | `GET /approvals`, `GET/POST /approvals/:id` |
| Proxy | `POST /proxy/:connector` (agent JWT; `Idempotency-Key` supported; `sandbox` runs the pipeline with no provider egress) |
| Audit | `GET /audit`, `GET /audit/verify`, `GET /audit/export` |
| SCIM | `GET/POST /api/scim/v2/Users`, `GET/PATCH/DELETE /api/scim/v2/Users/:id`, `GET /api/scim/v2/Groups` (empty list), `GET /api/scim/v2/{Schemas,ServiceProviderConfig}` (SCIM bearer token) |
| SSO | `GET /sso/:connectionId/start`, `GET /api/sso/:id/callback`, `POST /api/sso/:id/acs`, `GET /api/sso/:id/metadata` |
| Webhooks | `GET/POST /webhooks`, `GET/PATCH/DELETE /webhooks/:id` |
| Public | `GET /jwks`, `GET /openapi`, `GET /api/status`, `POST /api/mcp`, `GET /api/mcp/registry` |

Secret keys are environment-scoped and required for management endpoints. Agent tokens are required for the proxy, MCP and just-in-time grant requests. Responses use `{ error: { code, message, details, requestId } }` on failure; `x-request-id` is always present.

## SDKs, CLI and MCP

The npm and PyPI packages are not published yet. Build and install them from this repository:

```bash
# TypeScript SDK
npm ci
npm --prefix sdk ci && npm run sdk:build
npm install ./sdk

# Python SDK
pip install "./python"
python -m unittest discover -s python/tests -v

# CLI
npm run cli:build
./cli/dist/authab.js --help
AUTHAB_API_KEY=sk_dev_... AUTHAB_BASE_URL=http://localhost:3000/api/v1 ./cli/dist/authab.js agents list

# MCP stdio server
npm run mcp:build
AUTHAB_API_KEY=sk_dev_... AUTHAB_AGENT_ID=agt_atlas AUTHAB_BASE_URL=http://localhost:3000/api/v1 node mcp/dist/server.js

# Hosted MCP gateway
curl -s http://localhost:3000/api/mcp/registry
curl -s http://localhost:3000/api/mcp \
  -H "Authorization: Bearer $AUTHAB_AGENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# Validate a live provider call once a real credential is in the vault and granted
AUTHAB_API_KEY=sk_dev_... AUTHAB_AGENT_ID=agt_atlas AUTHAB_CONNECTOR=slack AUTHAB_RESOURCE=research-validation npm run provider:validate
```

`provider:validate` picks a no-argument read action (override with `AUTHAB_ACTION`, `AUTHAB_INPUT`, `AUTHAB_RESOURCE` and `AUTHAB_CREDENTIAL_ID`) and fails unless the provider returns a 2xx result. It is the only check that needs a real third-party credential; the rest of the suite runs against stubs.

- [TypeScript SDK and AI SDK tools](sdk/README.md)
- [Python SDK and framework integrations](python/README.md)
- [CLI usage](cli/README.md)
- [MCP server and gateway](mcp/README.md)

## Security properties

- Agent identity is Ed25519. Private keys are shown once; platform-managed keys are sealed with envelope encryption. Signed challenges are single-use — replays are rejected for the life of the challenge record.
- Agent-native auth never relies on a long-lived provider key: client secrets are stored as SHA-256 hashes and capped at the agent's grant scopes, and token exchange can only narrow scopes (never widen). Cross-agent exchanges require an active, revocable delegation whose scopes are a subset of the parent's grants; the RFC 8693 `act` chain and ancestor-token claims record every hop, and revoking the delegation or an ancestor token invalidates descendants immediately. DPoP proofs accept only asymmetric algorithms, enforce `htm`/`htu`/`iat`/`ath`, and reject replayed `jti` values per environment. Workload identity rules are deny-by-default and require an exact issuer and audience match, plus an optional subject glob and required-claims check.
- OAuth connect uses PKCE and a signed, single-use state cookie. Refresh tokens are rotated when the provider returns a new one; permanent failures mark the connection broken and notify owners, transient failures keep the current token usable until it expires.
- Runtime-configured outbound URLs (OAuth token endpoints, JWKS, OpenAPI connector servers and webhooks) reject credentials in the URL, require HTTPS in production, and refuse hosts that are private, loopback or link-local. Connector and webhook hosts are resolved again at request and redirect time, so DNS rebinding and IPv4-mapped IPv6 literals cannot reach internal services. The localhost escape hatch is disabled whenever `NODE_ENV=production`.
- Credentials are AES-256-GCM encrypted with a per-credential data key wrapped by a per-project key, rooted in the deployment master key. No API returns a plaintext secret.
- Every policy decision is deny-by-default and evaluated server-side. Conditions on CIDR, time window, day, timezone, amount and call rate fail closed when malformed. `POST /policy/simulate` runs the same pipeline as the proxy without executing or consuming anything.
- Custom connectors compile from OpenAPI 3.0/3.1 only, require HTTPS servers, reject private and link-local base URLs, refuse required header/cookie parameters the proxy cannot forward, cap imports at 100 actions, and stay behind the Scale/Enterprise plan gate.
- Approval payloads are redacted before storage. Approving executes the stored call; the requester cannot approve its own request. Approval SLAs escalate to a configured role and the scheduler expires unanswered requests.
- Audit events are chained per environment with `SHA-256(prevHash + ":" + canonicalJSON(event))`. Appends take a Postgres advisory lock so concurrent writes cannot fork the chain; `GET /audit/verify` walks the chain. A database trigger rejects UPDATE, DELETE and TRUNCATE unless a maintenance or restore job opts in with `SET LOCAL app.audit_maintenance = 'on'`.
- SSO state is a signed, single-use cookie bound to the connection. SAML responses are validated (signature and assertion conditions) by `@node-saml/node-saml`; OIDC uses discovery, PKCE and a nonce check. A connection can be enforced for its email domains, and new SSO members receive only the mapped role.
- SCIM tokens are stored hashed with a display prefix and can be revoked. Deprovisioning suspends the member and revokes their sessions; owners cannot be deprovisioned through SCIM.
- MFA secrets are envelope-encrypted per user, recovery codes are hashed and consumed once, and an organisation-wide MFA requirement is enforced at sign-in and on every dashboard request.
- Roles and capability grants are resolved server-side on every dashboard action; a grant can only narrow its role, never widen it.
- Audit streaming signs each envelope with HMAC-SHA256 over the timestamp and body, queues one delivery row per event (duplicates skipped), and retries failures with backoff. Sink secrets are envelope-encrypted.
- Proxy execution and request errors are wrapped in OpenTelemetry spans (`proxy.call`); incoming `traceparent` values are used to correlate errors. Spans are only exported when `OTEL_EXPORTER_OTLP_ENDPOINT` is set — otherwise the tracing API is a no-op.
- Dashboard sessions are httpOnly and database-backed; API keys are stored hashed with a prefix retained for display. Sign-in, sign-up, magic-link and reset requests are throttled in the database.
- Webhook delivery blocks loopback, private, link-local and metadata addresses, refuses redirects, and retries failed deliveries with exponential backoff.
- Responses set HSTS, a same-origin Content Security Policy, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` and a same-origin opener policy.

See `/security` and `/docs/concepts/*` for the full model.

## Scripts

```bash
npm run dev             # Next dev server
npm run build           # prisma generate + next build
npm run start           # production server
npm run typecheck       # next typegen + tsc --noEmit (npm run lint runs this)
npm test                # server unit tests: policy/CIDR, OpenAPI import, DPoP, OAuth refresh, invites, plans, MFA/TOTP, RBAC, SLO, status, sandbox, redaction, billing, MCP gateway
npm run connectors:check # validate connector manifests, action names, risks, hosts and samples
npm run db:seed         # reseed demo workspace (blocked in production unless ALLOW_DEMO_SEED=1)
npm run db:migrate      # apply pending Prisma migrations to Neon
npm run db:reset        # destructive: reset schema and reseed
npm run db:backup       # checksummed logical backup of every table (direct connection)
npm run db:restore      # guarded, single-transaction restore; --target is mandatory
npm run loadtest        # closed-loop HTTP load test with p50/p95/p99 and thresholds
npm run sdk:build       # compile the SDK
npm run sdk:test        # SDK crypto, webhook signature and AI SDK tool-loop checks
npm run python:test     # Python SDK and framework integration tests
npm run cli:build       # bundle the CLI into cli/dist
npm run mcp:build       # bundle the MCP server into mcp/dist
npm run cli:typecheck   # typecheck CLI against SDK source
npm run mcp:typecheck   # typecheck MCP server against SDK source
```

## Deployment checklist

1. Set `DATABASE_URL`, `APP_URL`, and strong values for `MASTER_KEY`, `JWT_SIGNING_PRIVATE_KEY` and `AUTH_COOKIE_SECRET` from a secret manager.
2. Run `npx prisma migrate deploy` (or `db push` for a disposable install) and `npm run build`.
3. Terminate TLS in front of the app; the dashboard session cookie is httpOnly and same-site.
4. Point `DATABASE_URL` at the pooled Neon endpoint and `DATABASE_URL_UNPOOLED` at the direct endpoint. Run schema changes in a Neon branch first, then apply them to production.
5. Set `CRON_SECRET` and schedule `POST /api/cron/webhooks` (for example every five minutes) so failed webhooks and audit-sink deliveries retry, approvals and credentials expire, alert rules evaluate, and old challenge/rate-limit rows are pruned. `vercel.json` already declares a five-minute cron for Vercel deployments; it also drains audit sinks. The separate `POST /api/cron/audit-sinks` route runs the same drain when you prefer a dedicated job.
6. Add provider credentials through the vault with the secret key API or dashboard. Self-serve sign-up always starts on Free. For one-click OAuth connect, either configure an OAuth app in the dashboard or set `CONNECT_<PROVIDER>_CLIENT_ID` / `_CLIENT_SECRET` / optional `_SCOPES` (for example `CONNECT_GOOGLE_CLIENT_ID`). The scheduler refreshes OAuth tokens before the five-minute expiry margin.
7. To enable card checkout, set `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and price IDs for each plan and currency (`STRIPE_PRICE_PRO`, `STRIPE_PRICE_PRO_INR`, `STRIPE_PRICE_SCALE`, `STRIPE_PRICE_SCALE_INR`), then register `${APP_URL}/api/stripe/webhook` for `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid` and `invoice.payment_failed`. Checkout enables Stripe automatic tax and tax-ID collection, and organisations without a subscription can take a one-time trial. Failed payments start a dunning escalation, and `/app/billing/usage` downloads a CSV usage statement. Without Stripe, the billing page falls back to emailing a plan-change request.
8. Leave `ALLOW_DEMO_LOGIN` and `ALLOW_DEMO_SEED` unset in production. Demo access is disabled there unless explicitly enabled.
9. Put `/api/status` behind your uptime monitor, and run `GET /api/v1/audit/verify` as a scheduled check with a secret key.
10. Schedule `npm run db:backup` daily to storage outside the database provider, keep `MASTER_KEY`, `JWT_SIGNING_PRIVATE_KEY` and `AUTH_COOKIE_SECRET` recoverable from a secret manager, and run a restore rehearsal monthly. See `docs/operations/backup-restore.md` for the measured RPO/RTO and the procedure.
11. To enable enterprise SSO, create a connection at `/app/security/sso` with an OIDC issuer/client or SAML IdP details. Give the IdP `/api/sso/:id/metadata` (SAML SP metadata) or `/api/sso/:id/callback` (OIDC redirect); test a sign-in before enabling enforcement. The organisation MFA requirement is set on the same page.
12. To enable SCIM, create a bearer token on `/app/security/sso` and give the IdP the base URL `${APP_URL}/api/scim/v2`. Tokens are shown once and stored hashed.
13. Configure audit streaming at `/app/security/streaming` and send a test delivery before enabling the sink. Publish incidents from `/app/admin/status` so `/status` reflects reality, keep `/trust` subprocessors current, and set `OTEL_EXPORTER_OTLP_ENDPOINT` if you collect traces.
14. Record post-deploy load-test runs in `docs/operations/load-testing.md`. The checked-in numbers are a development baseline, not an SLO.

## Demo data

The seed creates six development agents, a production environment, connectors, grants, pending approvals, audit history and billing fixtures for Northwind Labs. Seeded credentials are placeholders: any provider call is executed for real and will fail authentication until you replace them in the vault. Re-run `npm run db:reset` to return to a clean demo state. `npm run setup` no longer seeds automatically, and the seed refuses to run with `NODE_ENV=production` unless `ALLOW_DEMO_SEED=1` is set, so demo credentials cannot leak into a real deployment.
