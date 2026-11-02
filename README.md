# Keel

Identity, vault and governance for AI agents. Keel gives every agent a verifiable Ed25519 identity, keeps provider credentials out of agent code, evaluates every outbound call against grants and policy, routes risky calls to a human, and records the whole thing in a tamper-evident audit chain.

This repository contains the hosted product, the marketing site and documentation, plus the SDK, CLI and MCP server.

## What is here

| Path | What it is |
| --- | --- |
| `src/` | Next.js 16 app: landing site, docs, dashboard, and the `/api/v1` platform API |
| `prisma/` | Postgres schema and demo seed (Northwind Labs) |
| `sdk/` | `@keel/sdk` — server-side TypeScript client |
| `cli/` | `@keel/cli` — terminal client (`keel`) |
| `mcp/` | `@keel/mcp` — MCP stdio server with governed tools |
| `.keel/` | Local runtime state (dev secrets, dev server log); never commit |

The app and docs are at `/`, `/docs`, `/pricing`, `/security`, `/status`, `/blog`, `/legal/*`. The dashboard is at `/app`; the platform API is at `/api/v1`.

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
demo@keel.dev
KeelDemo!2026
```

The seed also creates a development secret key for the demo workspace: `sk_dev_demo_northwind_2026`. Treat it as a local demo fixture, not a production key.

On first boot the app writes development-only keys to `.keel/dev-secrets.json` (mode `0600`). Production must supply `MASTER_KEY`, `JWT_SIGNING_PRIVATE_KEY` and `AUTH_COOKIE_SECRET` through the environment.

## How a call flows

```
agent runtime
  │  1. signs a challenge with its Ed25519 key
  ▼
POST /api/v1/agents/:id/token        → short-lived EdDSA JWT (60–3600s)
  │
  ▼  2. POST /api/v1/proxy/:connector   Authorization: Bearer <agent JWT>
Keel
  ├─ verifies token, environment and revocation
  ├─ connector → action → agent status → credential → grant → resource → conditions
  ├─ allow             → decrypt credential, execute, audit
  ├─ require_approval  → store redacted request, return 202 + approval URL
  └─ deny              → 403 with the deciding rule
  ▼
audit event with per-environment SHA-256 hash chain
```

Read calls are allowed in development and production when granted. Writes are allowed in development but require approval in production by default. Destructive and financial actions require approval in both. **Safe launch** overrides non-read calls to require approval for the first seven days after promotion.

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

Every environment calls providers for real. Policy, approvals, rate limits and audit run first; then Keel decrypts the credential and performs the request. Responses return the provider's own status and body. Calls are capped at 2 MB, restricted to the connector's allowed hosts, and redirects may not leave the credential's origin.

## API at a glance

| Group | Endpoints |
| --- | --- |
| Context | `GET /me`, `GET /connectors` |
| Agents | `GET/POST /agents`, `GET/PATCH/DELETE /agents/:id`, `POST /agents/:id/{token,pause,resume,suspend,kill,rotate-key,transfer,promote}` |
| Tokens | `POST /tokens/introspect`, `POST/GET /tokens/revoke` |
| Vault | `GET/POST /credentials`, `GET/PATCH/DELETE /credentials/:id` |
| Grants | `GET/POST /grants`, `GET/PATCH/DELETE /grants/:id` |
| Policy | `GET/POST /approval-policies`, `GET/PATCH/DELETE /approval-policies/:id` |
| Approvals | `GET /approvals`, `GET/POST /approvals/:id` |
| Proxy | `POST /proxy/:connector` (agent JWT; `Idempotency-Key` supported) |
| Audit | `GET /audit`, `GET /audit/verify`, `GET /audit/export` |
| Webhooks | `GET/POST /webhooks`, `GET/PATCH/DELETE /webhooks/:id` |
| Public | `GET /jwks`, `GET /openapi`, `GET /api/status` |

Secret keys are environment-scoped and required for management endpoints. Agent tokens are required for the proxy. Responses use `{ error: { code, message, details, requestId } }` on failure; `x-request-id` is always present.

## SDK, CLI and MCP

```bash
# SDK
cd sdk && npm run build
npm install ../sdk          # or publish @keel/sdk

# CLI
cd cli && npm run build
./dist/keel.js --help
KEEL_API_KEY=sk_dev_... KEEL_BASE_URL=http://localhost:3000/api/v1 ./dist/keel.js agents list

# MCP
cd mcp && npm run build
KEEL_API_KEY=sk_dev_... KEEL_AGENT_ID=agt_atlas KEEL_BASE_URL=http://localhost:3000/api/v1 node dist/server.js
```

- [SDK usage](sdk/README.md)
- [CLI usage](cli/README.md)
- [MCP server](mcp/README.md)

## Security properties

- Agent identity is Ed25519. Private keys are shown once; platform-managed keys are sealed with envelope encryption. Signed challenges are single-use — replays are rejected for the life of the challenge record.
- Credentials are AES-256-GCM encrypted with a per-credential data key wrapped by a per-project key, rooted in the deployment master key. No API returns a plaintext secret.
- Every policy decision is deny-by-default and evaluated server-side. A grant with a resource pattern requires the caller to supply a matching resource; omitting it is denied.
- Approval payloads are redacted before storage. Approving executes the stored call; the requester cannot approve its own request.
- Audit events are chained per environment with `SHA-256(prevHash + ":" + canonicalJSON(event))`. Appends take a Postgres advisory lock so concurrent writes cannot fork the chain; `GET /audit/verify` walks the chain.
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
npm test                # unit tests for plan limits, policy, invites and signed approvals
npm run connectors:check # validate connector manifests, action names, risks, hosts and samples
npm run db:seed         # reseed demo workspace (blocked in production unless ALLOW_DEMO_SEED=1)
npm run db:migrate      # apply pending Prisma migrations to Neon
npm run db:reset        # destructive: reset schema and reseed
npm run sdk:build       # compile the SDK
npm run sdk:test        # SDK crypto and webhook signature checks
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
5. Set `CRON_SECRET` and schedule `POST /api/cron/webhooks` (for example every five minutes) so failed webhooks retry, approvals and credentials expire, alert rules evaluate, and old challenge/rate-limit rows are pruned. `vercel.json` already declares a five-minute cron for Vercel deployments.
6. Add provider credentials through the vault with the secret key API or dashboard. Self-serve sign-up always starts on Free.
7. To enable card checkout, set `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and price IDs for each plan and currency (`STRIPE_PRICE_PRO`, `STRIPE_PRICE_PRO_INR`, `STRIPE_PRICE_SCALE`, `STRIPE_PRICE_SCALE_INR`), then register `${APP_URL}/api/stripe/webhook` for `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid` and `invoice.payment_failed`. Without Stripe, the billing page falls back to emailing a plan-change request.
8. Leave `ALLOW_DEMO_LOGIN` and `ALLOW_DEMO_SEED` unset in production. Demo access is disabled there unless explicitly enabled.
9. Put `/api/status` behind your uptime monitor, and run `GET /api/v1/audit/verify` as a scheduled check with a secret key.

## Demo data

The seed creates six development agents, a production environment, connectors, grants, pending approvals, audit history and billing fixtures for Northwind Labs. Seeded credentials are placeholders: any provider call is executed for real and will fail authentication until you replace them in the vault. Re-run `npm run db:reset` to return to a clean demo state. `npm run setup` no longer seeds automatically, and the seed refuses to run with `NODE_ENV=production` unless `ALLOW_DEMO_SEED=1` is set, so demo credentials cannot leak into a real deployment.
