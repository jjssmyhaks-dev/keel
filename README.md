# Authab

[![CI](https://github.com/jjssmyhaks-dev/keel/actions/workflows/ci.yml/badge.svg)](https://github.com/jjssmyhaks-dev/keel/actions/workflows/ci.yml)

Authab is identity, vault, and governance for AI agents. Every agent receives a verifiable Ed25519 identity; provider credentials stay in an encrypted vault; each outbound call is evaluated against grants and policy before execution; risky calls route to a human; and the result is appended to an append-only, hash-chained audit log.

Agents do not need long-lived provider keys. OAuth-connected credentials refresh automatically; client secrets and RFC 8693 token exchange issue short-lived tokens, optionally DPoP-bound; and SPIFFE, Kubernetes, or OIDC workload identities can exchange their own JWT for an agent token. Policies can be simulated with a full decision trace, and custom connectors can be imported from OpenAPI 3.0/3.1 when the built-in catalog does not cover a provider.

Beyond the proxy path, Authab implements the enterprise and operational requirements around it: OIDC and SAML single sign-on, SCIM 2.0 provisioning, TOTP MFA, seven roles with capability grants, SIEM audit streaming, provider SLO dashboards, request error tracking, OpenTelemetry traces, an incident-backed status page, and tax-aware subscription billing.

Part 2 adds the multi-party flows: hosted end-user consent with one-time codes and consent-scoped tokens, cross-organization trust built on shadow agents, a repository secret scanner with vault import, and configuration as code with dry runs and transactional apply.

This repository contains the hosted application and documentation site, the TypeScript and Python SDKs, framework integrations, the CLI, the MCP stdio server, and the hosted MCP gateway.

## Repository layout

| Path | Contents |
| --- | --- |
| `src/` | Next.js 16 application: marketing site, documentation, dashboard, and the `/api/v1` platform API |
| `prisma/` | Postgres schema and the Northwind Labs demo seed |
| `sdk/` | `@authab/sdk`: server-side TypeScript client, AI SDK tools, and framework-neutral tool specs |
| `python/` | `authab-sdk`: zero-dependency Python client with LangChain/LangGraph, CrewAI, and OpenAI Agents adapters |
| `cli/` | `@authab/cli`: the `authab` terminal client |
| `mcp/` | `@authab/mcp`: MCP stdio server with governed tools |
| `src/app/api/mcp/` | Hosted MCP gateway (Streamable HTTP) and public registry manifest |
| `docs/operations/` | Backup/restore and load-test runbooks, including recorded baselines |
| `scripts/` | Backup, restore, and load-test utilities used by the npm scripts |
| `.github/workflows/` | CI: typecheck, unit tests, connector checks, package builds, and a production build |
| `.authab/` | Local runtime state (development secrets and logs); never committed |

Public pages are served from `/`, `/docs`, `/pricing`, `/security`, `/status`, `/trust`, `/blog`, and `/legal/*`. The dashboard is at `/app`, the platform API at `/api/v1`, SCIM at `/api/scim/v2`, and SSO callbacks under `/api/sso`.

## Getting started

Node 20 or newer is required; Node 22 is recommended.

```bash
npm install
cp .env.example .env   # set DATABASE_URL and DATABASE_URL_UNPOOLED to a Neon branch
npm run setup          # prisma generate + migrate deploy
npm run db:seed        # optional: Northwind Labs demo workspace
npm run dev
```

Alternatively, create the database and pull the service credentials with the Neon CLI:

```bash
npx neon@latest login
npx neon@latest init -y --org-id <org> --project-id <project> --branch production
npx neon@latest deploy
```

`DATABASE_URL` is the pooled endpoint used by the application; `DATABASE_URL_UNPOOLED` is the direct endpoint Prisma uses for migrations and `db push`.

Open <http://localhost:3000> and sign in with the seeded owner account:

```text
demo@authab.dev
AuthabDemo!2026
```

The seed also creates a development secret key for the demo workspace: `sk_dev_demo_northwind_2026`. Treat it as a local fixture, not a production key.

On first boot, the application writes development-only keys to `.authab/dev-secrets.json` with mode `0600`. Production deployments must supply `MASTER_KEY`, `JWT_SIGNING_PRIVATE_KEY`, and `AUTH_COOKIE_SECRET` through the environment.

## Request lifecycle

```text
agent runtime
  │  1. signs a challenge with its Ed25519 key
  ▼
POST /api/v1/agents/:id/token        → short-lived EdDSA JWT (60–3600 s)
  │
  ▼  2. POST /api/v1/proxy/:connector   Authorization: Bearer <agent JWT>
Authab
  ├─ verifies the token, environment, and revocation status
  ├─ connector → action → agent status → credential → grant → resource → conditions
  ├─ allow             → decrypt credential, execute, audit
  ├─ require_approval  → store redacted request, return 202 + approval URL
  └─ deny              → 403 with the deciding rule
  ▼
audit event appended to the per-environment SHA-256 hash chain
```

Read calls are allowed in development and production when granted. Writes are allowed in development and require approval in production by default. Destructive and financial actions require approval in both environments. Safe launch overrides non-read calls to require approval for the first seven days after promotion.

## Sandbox

`/app/playground` exercises the proxy before a provider key exists. It calls the same `POST /api/v1/proxy/sandbox` endpoint agents use, provisioning a sandbox connection with no stored secret and a sandbox-only grant (`sandbox.*`) on first run. Five actions cover read, write, financial, destructive, and admin risk; agent status, grants, resource patterns, conditions, policy, approvals, and rate limits all run unchanged.

Allowed runs execute in-process and return a synthetic envelope: no secret is decrypted and no network request leaves the application. Financial, destructive, and admin actions open a real approval that executes the stored sandbox call when decided. Sandbox events are recorded as `sandbox.call`, count toward grant call caps, and are excluded from billable usage.

## Enterprise identity and access

### Single sign-on

OIDC (discovery and PKCE) and SAML 2.0 connections are configured per organization at `/app/security/sso`. Each connection is bound to email domains; the start and completion routes reject a mismatched domain, and a connection can be marked enforced so members must use it. SP metadata is served at `/api/sso/:id/metadata`, and the SAML ACS endpoint is `/api/sso/:id/acs`. SSO state is a signed, single-use cookie. First sign-in provisions a membership with the role mapped from IdP groups.

### SCIM provisioning

`/api/scim/v2` supports user creation, filter queries, PATCH, and deprovisioning. `Groups` returns an empty list; roles come from IdP group claims at SSO sign-in rather than SCIM group membership. Bearer tokens use the `scim_` prefix and are stored as SHA-256 hashes with a display prefix. Deprovisioning suspends the membership and revokes its sessions, and the owner role cannot be deprovisioned through SCIM. Every SCIM write is audited.

### MFA and roles

TOTP enrollment at `/mfa/enroll` issues one-time recovery codes stored as hashes. Organizations can require MFA, which is enforced at sign-in and again on every dashboard request. The seven roles are `owner`, `admin`, `developer`, `approver`, `auditor`, `billing`, and `viewer`; optional capability grants narrow what a role may do.

## Audit and observability

### Audit streaming and trust view

Audit sinks deliver HMAC-signed envelopes (`signature = HMAC-SHA256(secret, timestamp + "." + body)`) to a webhook or Splunk HEC endpoint. Each environment advances a persisted cursor, and failed deliveries retry with backoff; sinks are configured and tested at `/app/security/streaming`. For a proxied call, the audit detail page shows the decision, credential source, injected headers, parameters, and body fields, redactions, and the request ID.

### Observability and status

The instrumentation hook records request errors, and `/app/observability` reports open errors, provider p50/p95 latency, and SLO health. Proxy calls and errors are wrapped in OpenTelemetry spans; setting `OTEL_EXPORTER_OTLP_ENDPOINT` exports them, and incoming `traceparent` headers correlate errors. `/status` displays incidents managed at `/app/admin/status` and publishes an RSS feed at `/status/feed.xml`. `/trust` and `/trust/subprocessors.json` publish the subprocessor list; the page states explicitly that no SOC 2 Type II report exists yet.

## Billing

Checkout enables Stripe automatic tax and tax-ID collection. Organizations without a subscription can take a one-time trial, failed payments start a dunning escalation, and `/app/billing/usage` downloads a CSV usage statement, labeled as a statement rather than a tax invoice. Without Stripe configured, the billing page falls back to a plan-change request by email.

## Neon

The application runs on Neon Postgres. `neon.ts` declares the branch policy and the services used by this deployment:

| Service | Status |
| --- | --- |
| Postgres | Wired through Prisma (`DATABASE_URL` pooled, `DATABASE_URL_UNPOOLED` direct) |
| Neon Auth | Provisioned; the application keeps its own database-backed sessions |
| Object Storage | Provisioned for future asset uploads; no upload flow ships yet |
| Functions | `hello` deployed as a smoke-test function |
| Realtime | Provisioned; the dashboard reads through the API, not a live subscription |
| AI Gateway | Removed from `neon.ts`; the Free plan cannot serve gateway requests |

`neon deploy` writes the service credentials to `.env`. Never commit `.env` or `.neon`.

## Provider egress

Every environment calls providers for real. Policy, approvals, rate limits, and audit run first; Authab then decrypts the credential and performs the request. Responses return the provider's own status and body. Calls are capped at 2 MB, restricted to the connector's allowed hosts, and redirects may not leave the credential's origin.

## Platform API

| Group | Endpoints |
| --- | --- |
| Context | `GET /me`, `GET /connectors` (built-in and active custom connectors, plus custom metadata) |
| Agents | `GET/POST /agents`, `GET/PATCH/DELETE /agents/:id`, `POST /agents/:id/{token,pause,resume,suspend,kill,rotate-key,transfer,promote}`, `GET /agents/:id/identity-document`, `GET/POST /agents/:id/client-secrets`, `DELETE /agents/:id/client-secrets/:secretId` |
| Revocations | `GET /revocations` (signed `agent-revocations+jwt` list, `since`/`limit`/`cursor`, ETag/304) |
| Tokens | `POST /tokens/introspect`, `POST /tokens/revoke`, `POST /tokens/client-credentials`, `POST /tokens/exchange`, `POST /tokens/workload-exchange` |
| Workload identity | `GET/POST /workload-identities`, `GET/PATCH/DELETE /workload-identities/:id` |
| Vault | `GET/POST /credentials`, `GET/PATCH/DELETE /credentials/:id`, `POST /credentials/:id/refresh`, `POST /credentials/:id/check` |
| Grants | `GET/POST /grants`, `GET/PATCH/DELETE /grants/:id`, `POST /grants/request` (agent JWT, just-in-time) |
| Policy | `POST /policy/simulate`, `GET/POST /approval-policies`, `GET/PATCH/DELETE /approval-policies/:id` |
| End-user consent | `POST /consent/requests`, `POST /consent/token`, `POST /consent/:id/{token,revoke}`, `GET /end-users`, `GET /end-users/:externalUserId`, `POST /end-users/:externalUserId/control-link` |
| Cross-org trust | `GET/POST /trust-relationships`, `POST /trust-relationships/:id/{accept,decline,revoke}`, `POST /tokens/trust-exchange` (agent JWT) |
| Config | `GET /config/export` (JSON or YAML), `POST /config/apply` (dry run, prune, `x-authab-confirm`) |
| Connectors | `POST /connectors` (OpenAPI 3 import), `GET/DELETE /connectors/:slug`, `POST /connectors/:slug/rollback` |
| Approvals | `GET /approvals`, `GET/POST /approvals/:id` |
| Proxy | `POST /proxy/:connector` (agent JWT; `Idempotency-Key` supported; `sandbox` runs the pipeline with no provider egress) |
| Audit | `GET /audit`, `GET /audit/verify`, `GET /audit/export` |
| SCIM | `GET/POST /api/scim/v2/Users`, `GET/PATCH/DELETE /api/scim/v2/Users/:id`, `GET /api/scim/v2/Groups` (empty list), `GET /api/scim/v2/{Schemas,ServiceProviderConfig}` (SCIM bearer token) |
| SSO | `GET /sso/:connectionId/start`, `GET /api/sso/:id/callback`, `POST /api/sso/:id/acs`, `GET /api/sso/:id/metadata` |
| Webhooks | `GET/POST /webhooks`, `GET/PATCH/DELETE /webhooks/:id` |
| Public | `GET /jwks`, `GET /openapi`, `GET /api/status`, `POST /api/mcp`, `GET /api/mcp/registry` |

Secret keys are environment-scoped and required for management endpoints. Agent tokens are required for the proxy, MCP, and just-in-time grant requests. Errors use `{ error: { code, message, details, requestId } }`; `x-request-id` is always present.

## SDKs, CLI, and MCP

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

`provider:validate` selects a no-argument read action (override with `AUTHAB_ACTION`, `AUTHAB_INPUT`, `AUTHAB_RESOURCE`, and `AUTHAB_CREDENTIAL_ID`) and fails unless the provider returns a 2xx result. It is the only check that requires a real third-party credential; the rest of the suite runs against stubs.

- [TypeScript SDK and AI SDK tools](sdk/README.md)
- [Python SDK and framework integrations](python/README.md)
- [CLI usage](cli/README.md)
- [MCP server and gateway](mcp/README.md)
- [GitOps guide](docs/operations/gitops.md)

## Security properties

- **Agent identity.** Agent identity is Ed25519. Private keys are shown once, and platform-managed keys are sealed with envelope encryption. Signed challenges are single-use; replays are rejected for the life of the challenge record.
- **Agent-native tokens.** Client secrets are stored as SHA-256 hashes and capped at the agent's grant scopes, and token exchange can only narrow scopes. Cross-agent exchanges require an active, revocable delegation whose scopes are a subset of the parent's grants; the RFC 8693 `act` chain and ancestor-token claims record every hop, and revoking the delegation or an ancestor token invalidates descendants immediately. DPoP proofs accept only asymmetric algorithms, enforce `htm`/`htu`/`iat`/`ath`, and reject replayed `jti` values per environment. Workload identity rules are deny-by-default and require an exact issuer and audience match, plus an optional subject glob and required-claims check.
- **OAuth connections.** OAuth connect uses PKCE and a signed, single-use state cookie. Refresh tokens rotate when the provider returns a new one; permanent failures mark the connection broken and notify owners, while transient failures keep the current token usable until it expires.
- **Outbound request safety.** Runtime-configured outbound URLs (OAuth token endpoints, JWKS, OpenAPI connector servers, and webhooks) reject credentials in the URL, require HTTPS in production, and refuse private, loopback, and link-local hosts. Connector and webhook hosts are resolved again at request and redirect time, so DNS rebinding and IPv4-mapped IPv6 literals cannot reach internal services. The localhost escape hatch is disabled whenever `NODE_ENV=production`. Webhook delivery additionally blocks metadata addresses and refuses redirects.
- **Credential protection.** Credentials are AES-256-GCM encrypted with a per-credential data key wrapped by a per-project key, rooted in the deployment master key. No API returns a plaintext secret.
- **Policy and approvals.** Every policy decision is deny-by-default and evaluated server-side. Conditions on CIDR, time window, day, timezone, amount, and call rate fail closed when malformed. `POST /policy/simulate` runs the same pipeline as the proxy without executing or consuming anything. Approval payloads are redacted before storage; approving executes the stored call, and the requester cannot approve its own request. Approval SLAs escalate to a configured role, and the scheduler expires unanswered requests.
- **Custom connectors.** Imports accept OpenAPI 3.0/3.1 only, require HTTPS servers, reject private and link-local base URLs, refuse required header or cookie parameters the proxy cannot forward, cap imports at 100 actions, and stay behind the Scale/Enterprise plan gate.
- **Audit integrity.** Audit events are hash-chained per environment with `SHA-256(prevHash + ":" + canonicalJSON(event))`. Appends take a Postgres advisory lock so concurrent writes cannot fork the chain, and `GET /audit/verify` walks the chain. A database trigger rejects UPDATE, DELETE, and TRUNCATE unless a maintenance or restore job opts in with `SET LOCAL app.audit_maintenance = 'on'`. Streamed envelopes are signed with HMAC-SHA256 over the timestamp and body, queued once per event, and retried with backoff; sink secrets are envelope-encrypted.
- **Human access.** Dashboard sessions are httpOnly and database-backed; API keys and SCIM tokens are stored hashed with a display prefix. Sign-in, sign-up, magic-link, and reset requests are throttled in the database. SSO state is a signed, single-use cookie; SAML responses are validated for signature and assertion conditions by `@node-saml/node-saml`, and OIDC uses discovery, PKCE, and a nonce check. MFA secrets are envelope-encrypted per user, and recovery codes are hashed and consumed once. Roles and capability grants are resolved server-side on every dashboard action; a grant can only narrow its role.
- **End-user consent.** Consent requests are restricted to internal agents, scoped to a project allowlist and a risk ceiling, and bound to registered HTTPS redirect URIs. The one-time code is stored hashed, exchanged once, and expires after five minutes. Consent tokens live one hour, carry `consent` and `end_user` claims, and are re-checked against the consent record on every authenticated request. An end-user token can only reach that end user's connections (`403 credential_not_owned`), while organization tokens cannot see end-user connections at all (`404 credential_not_found`). Revoking a consent expires every grant it created.
- **Cross-organization trust.** Trust relationships require matching environment types and different organizations; private agents cannot be invited. Accepting creates a keyless shadow agent in the owner's environment, and every exchange narrows scopes to grants ∩ `maxScopes` ∩ requested. Shadow tokens are capped at five minutes, carry `act`, `trust` and `x_org` claims, and are re-validated against the active relationship on every call. Revoking from either side revokes the shadow agent and adds it to the signed revocation list.
- **Configuration as code.** Export omits secrets and end-user data. Apply validates first, diffs by natural keys, and commits creates, updates and deletes in one transaction; connections are never created or deleted, prune touches only grants, policies and webhooks, production prune requires an explicit confirmation header, and one-time private keys or webhook secrets are returned only in the apply result. Every apply writes a `config.applied` audit event.
- **Secret scanning.** The CLI scanner and the dashboard importer share one pattern catalogue; findings never print a full value, `--write` refuses a dirty or non-git tree, and the server re-classifies imports so a live key cannot enter a development environment through a tampered browser request.
- **Telemetry.** Proxy calls and request errors are wrapped in OpenTelemetry spans (`proxy.call`), and incoming `traceparent` values correlate errors. Spans are exported only when `OTEL_EXPORTER_OTLP_ENDPOINT` is set; otherwise the tracing API is a no-op.
- **Response headers.** Responses set HSTS, a same-origin Content Security Policy, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, and a same-origin opener policy.

See `/security` and `/docs/concepts/*` for the full model.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Next.js development server |
| `npm run build` | Prisma generate and production build |
| `npm run start` | Production server |
| `npm run typecheck` | Route type generation and TypeScript check (`npm run lint` runs this) |
| `npm test` | Unit tests: policy/CIDR, OpenAPI import and route coverage, DPoP, OAuth refresh, invites, plans, MFA/TOTP, RBAC, SLO, status, sandbox, redaction, billing, MCP gateway, consent, trust, secret patterns, config apply |
| `npm run connectors:check` | Validate connector manifests, action names, risk levels, hosts, and samples |
| `npm run db:seed` | Reseed the demo workspace (blocked in production unless `ALLOW_DEMO_SEED=1`) |
| `npm run db:migrate` | Apply pending Prisma migrations to Neon |
| `npm run db:reset` | Destructive: reset the schema and reseed |
| `npm run db:backup` | Checksummed logical backup of every table over the direct connection |
| `npm run db:restore` | Guarded, single-transaction restore; `--target` is mandatory |
| `npm run loadtest` | Closed-loop HTTP load test with p50/p95/p99 latency and thresholds |
| `npm run sdk:build` | Compile the TypeScript SDK |
| `npm run sdk:test` | SDK crypto, webhook signature, and AI SDK tool-loop checks |
| `npm run python:test` | Python SDK and framework integration tests |
| `npm run cli:build` | Bundle the CLI into `cli/dist` |
| `npm run mcp:build` | Bundle the MCP server into `mcp/dist` |
| `npm run cli:typecheck` | Typecheck the CLI against SDK source |
| `npm run mcp:typecheck` | Typecheck the MCP server against SDK source |

## Deployment

1. Set `DATABASE_URL`, `APP_URL`, and strong values for `MASTER_KEY`, `JWT_SIGNING_PRIVATE_KEY`, and `AUTH_COOKIE_SECRET` from a secret manager.
2. Run `npx prisma migrate deploy` (or `db push` for a disposable install), then `npm run build`.
3. Terminate TLS in front of the application; the dashboard session cookie is httpOnly and same-site.
4. Point `DATABASE_URL` at the pooled Neon endpoint and `DATABASE_URL_UNPOOLED` at the direct endpoint. Run schema changes in a Neon branch before applying them to production.
5. Set `CRON_SECRET` and schedule `POST /api/cron/webhooks` (for example, every five minutes) so failed webhooks and audit-sink deliveries retry, approvals and credentials expire, alert rules evaluate, and old challenge and rate-limit rows are pruned. `vercel.json` declares a five-minute cron for Vercel deployments that also drains audit sinks. The dedicated `POST /api/cron/audit-sinks` route runs the same drain when a separate job is preferred.
6. Add provider credentials through the vault API or dashboard. Self-serve sign-up always starts on Free. For one-click OAuth connect, configure an OAuth app in the dashboard or set `CONNECT_<PROVIDER>_CLIENT_ID`, `_CLIENT_SECRET`, and optional `_SCOPES` (for example, `CONNECT_GOOGLE_CLIENT_ID`). The scheduler refreshes OAuth tokens before the five-minute expiry margin.
7. To enable card checkout, set `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and price IDs for each plan and currency (`STRIPE_PRICE_PRO`, `STRIPE_PRICE_PRO_INR`, `STRIPE_PRICE_SCALE`, `STRIPE_PRICE_SCALE_INR`), then register `${APP_URL}/api/stripe/webhook` for `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, and `invoice.payment_failed`. Without Stripe, the billing page falls back to a plan-change request by email.
8. Leave `ALLOW_DEMO_LOGIN` and `ALLOW_DEMO_SEED` unset in production; demo access is disabled unless explicitly enabled.
9. Monitor `/api/status` and schedule `GET /api/v1/audit/verify` with a secret key.
10. Schedule `npm run db:backup` daily to storage outside the database provider, keep the three secrets recoverable from a secret manager, and rehearse a restore monthly. See `docs/operations/backup-restore.md` for the measured RPO/RTO and procedure.
11. To enable enterprise SSO, create a connection at `/app/security/sso` with an OIDC issuer and client or SAML IdP details. Give the IdP `/api/sso/:id/metadata` (SAML SP metadata) or `/api/sso/:id/callback` (OIDC redirect), and test a sign-in before enabling enforcement. The organization MFA requirement is set on the same page.
12. To enable SCIM, create a bearer token at `/app/security/sso` and give the IdP the base URL `${APP_URL}/api/scim/v2`. Tokens are shown once and stored hashed.
13. Configure audit streaming at `/app/security/streaming` and send a test delivery before enabling a sink. Publish incidents from `/app/admin/status` so `/status` reflects reality, keep `/trust` subprocessors current, and set `OTEL_EXPORTER_OTLP_ENDPOINT` to collect traces.
14. Record post-deployment load-test runs in `docs/operations/load-testing.md`. The checked-in numbers are a development baseline, not an SLO.

## Demo workspace

The seed creates six development agents, a production environment, connectors, grants, pending approvals, audit history, and billing fixtures for Northwind Labs. Seeded credentials are placeholders: provider calls execute for real and fail authentication until the credentials are replaced in the vault. `npm run db:reset` returns the demo to a clean state. The seed refuses to run with `NODE_ENV=production` unless `ALLOW_DEMO_SEED=1`, so demo credentials cannot leak into a real deployment.

## License

MIT. See [LICENSE](LICENSE).
