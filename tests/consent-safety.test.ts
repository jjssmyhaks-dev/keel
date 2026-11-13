import "./helpers/test-env";
import assert from "node:assert/strict";
import test from "node:test";
import { filesContaining, readSource } from "./helpers/source";

const API = readSource("src/lib/api.ts");
const PROXY_ROUTE = readSource("src/app/api/v1/proxy/[connector]/route.ts");
const PROXY_LIB = readSource("src/lib/proxy.ts");
const EXCHANGE = readSource("src/app/api/v1/tokens/exchange/route.ts");
const WORKLOAD = readSource("src/app/api/v1/tokens/workload-exchange/route.ts");
const DELEGATIONS = readSource("src/app/api/v1/delegations/route.ts");
const DECISION = readSource("src/app/consent/[token]/decision/route.ts");
const CONSENT_PAGE = readSource("src/app/consent/[token]/page.tsx");
const ME_PAGE = readSource("src/app/me/page.tsx");
const PROXY_MIDDLEWARE = readSource("src/proxy.ts");
const WEBHOOKS = readSource("src/lib/webhooks.ts");
const AUDIT = readSource("src/lib/audit.ts");

test("authenticateAgent enforces revocation, expiry and end-user ownership on consent tokens", () => {
  assert.match(API, /payload\.consent/);
  assert.match(API, /consent_revoked/);
  assert.match(API, /consent_expired/);
  assert.match(API, /consent\.agentId !== agent\.id/);
  assert.match(API, /consent\.endUserId !== claimUserId/);
  assert.match(API, /lastUsedAt/);
  assert.match(API, /60_000/);
});

test("authenticateAgent enforces live trust relationships", () => {
  assert.match(API, /payload\.trust/);
  assert.match(API, /trustRelationship/);
  assert.match(API, /trust_revoked/);
  assert.match(API, /relationship\.shadowAgentId !== agent\.id/);
});

test("proxy route scopes credential choice to the token's end user", () => {
  assert.match(PROXY_ROUTE, /credentialOwnershipError/);
  assert.match(PROXY_ROUTE, /\.\.\.\(endUserId \? \{ endUserId \} : \{ endUserId: null \}\)/);
  const ownership = readSource("src/lib/consent.ts");
  assert.match(ownership, /credential_not_owned", status: 403|status: 403, code: "credential_not_owned"/);
  assert.match(ownership, /credential_not_found", status: 404|status: 404, code: "credential_not_found"/);
});

test("agent-token credential lookup excludes end-user credentials", () => {
  const tokenRoute = readSource("src/app/api/v1/agents/[id]/[action]/route.ts");
  assert.match(tokenRoute, /endUserId: null/);
});

test("every dashboard and API credential listing excludes end-user credentials", () => {
  const files = [
    "src/app/app/vault/page.tsx",
    "src/app/app/vault/[id]/page.tsx",
    "src/app/app/permissions/page.tsx",
    "src/app/app/permissions/[agentId]/page.tsx",
    "src/app/app/playground/page.tsx",
    "src/app/app/policy/page.tsx",
    "src/app/app/page.tsx",
    "src/app/api/v1/credentials/route.ts",
    "src/app/api/v1/credentials/[id]/route.ts",
    "src/app/api/v1/grants/route.ts",
    "src/app/api/v1/grants/request/route.ts",
    "src/lib/mcp-gateway.ts",
    "src/lib/promotion.ts",
    "src/lib/alerts.ts",
    "src/lib/credential-health.ts",
    "src/lib/sandbox.ts",
    "src/lib/agent-secrets.ts",
    "src/lib/policy.ts",
  ];
  for (const file of files) {
    assert.match(readSource(file), /endUserId: null/, `${file} must exclude end-user credentials`);
  }
});

test("credential ciphertext never leaves the vault for end-user rows", () => {
  // The proxy materializes credentials server-side; it must request them by the
  // ownership-scoped filter, never by bare id.
  assert.match(PROXY_LIB, /endUserId\?: string \| null/);
  assert.equal(
    filesContaining("src/app", "encryptedSecret").filter((file) => file.endsWith("page.tsx")).length,
    0,
    "dashboard pages must not select encrypted secret columns",
  );
});

test("RFC 8693 exchange carries end_user and consent forward and refuses delegation", () => {
  assert.match(EXCHANGE, /consent_token_cannot_delegate/);
  assert.match(EXCHANGE, /external_agent_cannot_delegate/);
  assert.match(EXCHANGE, /end_user: endUserClaim/);
  assert.match(EXCHANGE, /consent: consentClaim/);
  assert.match(EXCHANGE, /extraClaims/);
});

test("workload exchange and delegation reject external agents", () => {
  assert.match(WORKLOAD, /external_agent_cannot_delegate/);
  assert.match(DELEGATIONS, /external_agent_cannot_delegate/);
});

test("hosted consent and control-center pages are noindex, no-store and CSRF protected", () => {
  assert.match(CONSENT_PAGE, /robots/);
  assert.match(CONSENT_PAGE, /index: false/);
  assert.match(PROXY_MIDDLEWARE, /Cache-Control", "no-store/);
  assert.match(PROXY_MIDDLEWARE, /\/consent\/:path\*/);
  assert.match(PROXY_MIDDLEWARE, /\/me\/:path\*/);
  assert.match(DECISION, /authab_csrf/);
  assert.match(DECISION, /constantTimeEqual/);
  assert.match(ME_PAGE, /authab_csrf/);
  assert.match(ME_PAGE, /index: false/);
});

test("control-center routes require the end-user session and CSRF where they mutate", () => {
  for (const file of [
    "src/app/me/revoke/[consentId]/route.ts",
    "src/app/me/disconnect/[credentialId]/route.ts",
    "src/app/me/data/[kind]/route.ts",
    "src/app/me/request-link/route.ts",
    "src/app/me/logout/route.ts",
  ]) {
    const source = readSource(file);
    assert.match(source, /csrf/, `${file} must verify the double-submit token`);
  }
  for (const file of [
    "src/app/me/page.tsx",
    "src/app/me/export/route.ts",
    "src/app/me/revoke/[consentId]/route.ts",
    "src/app/me/disconnect/[credentialId]/route.ts",
    "src/app/me/data/[kind]/route.ts",
  ]) {
    assert.match(readSource(file), /END_USER_COOKIE|endUserSession|endUserSessionFromCookie/, `${file} must read the end-user session`);
  }
});

test("consent audit and webhook vocabulary is registered", () => {
  for (const action of [
    "consent.request_created",
    "consent.granted",
    "consent.declined",
    "consent.revoked",
    "consent.control_link_created",
    "end_user.deleted",
    "end_user.data_request",
    "trust.invited",
    "trust.accepted",
    "trust.revoked",
    "trust.outbound_call",
    "credential.imported",
    "config.applied",
  ]) {
    assert.match(AUDIT, new RegExp(`"${action.replace(".", "\\.")}"`), `audit label missing for ${action}`);
  }
  for (const event of [
    "consent.granted",
    "consent.revoked",
    "end_user.data_request",
    "trust.invited",
    "trust.accepted",
    "trust.revoked",
  ]) {
    assert.match(WEBHOOKS, new RegExp(`"${event.replace(".", "\\.")}"`), `webhook event missing for ${event}`);
  }
});

test("migrations add the consent and trust tables forward-only", () => {
  const consent = readSource("prisma/migrations/20261113100000_add_end_user_consent/migration.sql");
  for (const table of ["ConsentBranding", "ConsentRequest", "EndUserLink", "EndUserSession", "DataRequest"]) {
    assert.match(consent, new RegExp(`CREATE TABLE "${table}"`), `missing table ${table}`);
  }
  assert.match(consent, /ALTER TABLE "Credential"[\s\S]*"endUserId"/);
  assert.match(consent, /ALTER TABLE "Consent"[\s\S]*"environmentId"/);
  const trust = readSource("prisma/migrations/20261113100100_add_cross_org_trust/migration.sql");
  assert.match(trust, /CREATE TABLE "TrustRelationship"/);
  assert.match(trust, /ALTER TABLE "Agent"[\s\S]*"kind" TEXT NOT NULL DEFAULT 'internal'/);
});

test("external agents can never use consent-branding or verification bypasses", () => {
  const branding = readSource("src/lib/consent-branding.ts");
  assert.match(branding, /contrastRatio/);
  assert.match(branding, /domainVerifiedAt/);
  const policy = readSource("src/lib/policy.ts");
  assert.match(policy, /externalAgentRequiresApproval/);
  assert.match(policy, /source = "external_agent"/);
  assert.match(policy, /External agents need approval for every non-read action/);
});
