import "./helpers/test-env";
import assert from "node:assert/strict";
import test from "node:test";
import {
  TRUST_TOKEN_TTL_SECONDS,
  intersectTrustScopes,
  isTrustStatus,
  normalizeTrustScopes,
  shadowAgentName,
  trustRelationshipView,
  trustScopeAllowed,
} from "../src/lib/trust-engine";
import { readSource } from "./helpers/source";

const INVITE = readSource("src/app/api/v1/trust-relationships/route.ts");
const ACCEPT = readSource("src/app/api/v1/trust-relationships/[id]/accept/route.ts");
const DECLINE = readSource("src/app/api/v1/trust-relationships/[id]/decline/route.ts");
const REVOKE = readSource("src/app/api/v1/trust-relationships/[id]/revoke/route.ts");
const EXCHANGE = readSource("src/app/api/v1/tokens/trust-exchange/route.ts");
const PAGE = readSource("src/app/app/trust/page.tsx");
const ACTIONS = readSource("src/app/app/trust/actions.ts");

test("trust statuses are a closed set", () => {
  for (const status of ["invited", "active", "declined", "revoked"]) assert.equal(isTrustStatus(status), true);
  assert.equal(isTrustStatus("pending"), false);
  assert.equal(isTrustStatus(null), false);
});

test("trust scope caps accept wildcards but drop junk", () => {
  assert.equal(trustScopeAllowed("gmail.messages.read", []), true);
  assert.equal(trustScopeAllowed("gmail.messages.read", ["gmail.*"]), true);
  assert.equal(trustScopeAllowed("gmail.messages.read", ["github.*"]), false);

  assert.deepEqual(normalizeTrustScopes([" gmail.* ", "gmail.*", 3, null, ""]), ["gmail.*"]);
  assert.deepEqual(normalizeTrustScopes("gmail.*"), []);
  assert.equal(normalizeTrustScopes(Array.from({ length: 150 }, (_, index) => `scope.${index}`)).length, 100);
});

test("exchange scopes are the intersection of grants, cap and request", () => {
  const grantScopes = ["gmail.messages.read", "gmail.messages.send", "github.repos.read"];
  assert.deepEqual(
    intersectTrustScopes({ grantScopes, maxScopes: ["gmail.*"] }),
    ["gmail.messages.read", "gmail.messages.send"],
  );
  assert.deepEqual(
    intersectTrustScopes({ grantScopes, maxScopes: ["gmail.*"], requested: ["gmail.messages.read"] }),
    ["gmail.messages.read"],
  );
  assert.deepEqual(intersectTrustScopes({ grantScopes, requested: ["stripe.*"] }), []);
  assert.deepEqual(intersectTrustScopes({ grantScopes: [], maxScopes: null, requested: null }), []);
});

test("shadow agents carry both names", () => {
  assert.equal(shadowAgentName("Researcher", "Acme Health"), "Researcher (Acme Health)");
});

test("relationship views never invent fields", () => {
  const view = trustRelationshipView({
    relationship: {
      id: "tr_1",
      status: "active",
      note: null,
      maxScopesJson: '["gmail.*"]',
      ownerEnvironmentId: "env_a",
      externalEnvironmentId: "env_b",
      shadowAgentId: "ag_shadow",
      invitedAt: new Date("2026-11-13T10:00:00Z"),
      acceptedAt: new Date("2026-11-13T11:00:00Z"),
      revokedAt: null,
    },
    externalAgent: { id: "ag_ext", name: "Researcher", status: "active", externalOrgName: null },
    externalOrgName: "Acme Health",
    shadowAgent: { id: "ag_shadow", name: "Researcher (Acme Health)", status: "active" },
  });
  assert.deepEqual(view.maxScopes, ["gmail.*"]);
  assert.equal(view.externalAgent?.orgName, "Acme Health");
  assert.equal(view.acceptedAt, "2026-11-13T11:00:00.000Z");
  assert.equal(view.revokedAt, null);
});

test("invite validation covers every documented rejection", () => {
  for (const code of [
    "external_agent_required",
    "agent_not_found",
    "agent_not_internal",
    "agent_inactive",
    "agent_private",
    "environment_mismatch",
    "same_organization",
    "relationship_exists",
  ]) {
    assert.match(INVITE, new RegExp(code), `invite API must reject with ${code}`);
  }
  assert.match(INVITE, /visibilityOf\(external\.verificationVisibility\) === "private"/);
  assert.match(INVITE, /external\.environment\.type !== auth\.environment\.type/);
  assert.match(INVITE, /notifyTrustAdmins/);
  assert.match(INVITE, /"trust\.invited"/);
});

test("accept creates an unkeyed shadow agent and an identity document", () => {
  assert.match(ACCEPT, /kind: "external"/);
  assert.match(ACCEPT, /keyMode: "external"/);
  assert.match(ACCEPT, /publicKey: null/);
  assert.match(ACCEPT, /fingerprint: external\.fingerprint/);
  assert.match(ACCEPT, /externalAgentId: external\.id/);
  assert.match(ACCEPT, /issueIdentityDocumentSafe\(shadow\.id\)/);
  assert.match(ACCEPT, /relationship\.externalEnvironmentId !== auth\.environment\.id/);
  assert.match(ACCEPT, /"trust\.accepted"/);
  assert.doesNotMatch(ACCEPT, /agentKey\.create/);
});

test("decline and revoke are party-scoped and audited on both sides", () => {
  assert.match(DECLINE, /not_external_side/);
  assert.match(DECLINE, /"trust\.declined"/);
  assert.match(REVOKE, /not_a_party/);
  assert.match(REVOKE, /status: "revoked"/);
  assert.match(REVOKE, /recordRevocation\(relationship\.shadowAgentId, relationship\.ownerEnvironmentId, "owner_revoked"\)/);
  assert.match(REVOKE, /for \(const environmentId of \[relationship\.ownerEnvironmentId, relationship\.externalEnvironmentId\]\)/);
  assert.match(REVOKE, /"trust\.revoked"/);
});

test("trust-exchange enforces caller identity, liveness, scope intersection and a 300s cap", () => {
  assert.equal(TRUST_TOKEN_TTL_SECONDS, 300);
  assert.match(EXCHANGE, /relationship\.externalAgentId !== caller\.id/);
  assert.match(EXCHANGE, /not_external_agent/);
  assert.match(EXCHANGE, /relationship\.status !== "active" \|\| !relationship\.shadowAgentId/);
  assert.match(EXCHANGE, /shadow\.status !== "active"/);
  assert.match(EXCHANGE, /trust_environment_mismatch/);
  assert.match(EXCHANGE, /intersectTrustScopes\(/);
  assert.match(EXCHANGE, /Math\.min\(Math\.max\(Number\(body\.ttl \|\| TRUST_TOKEN_TTL_SECONDS\), 60\), TRUST_TOKEN_TTL_SECONDS\)/);
  assert.match(EXCHANGE, /x_org: true, trust: relationship\.id/);
  assert.match(EXCHANGE, /act: \{ sub: caller\.id, env: relationship\.externalEnvironmentId \}/);
  assert.match(EXCHANGE, /endUserId: null/);
});

test("shadow agents cannot bootstrap their own credentials", () => {
  assert.match(readSource("src/app/api/v1/agents/[id]/[action]/route.ts"), /trust_exchange_required/);
  assert.match(readSource("src/app/api/v1/agents/[id]/[action]/route.ts"), /external_agent_has_no_keys/);
  assert.match(readSource("src/app/api/v1/agents/[id]/client-secrets/route.ts"), /external_agent_has_no_keys/);
  assert.match(readSource("src/app/api/v1/tokens/client-credentials/route.ts"), /external_agent_has_no_keys/);
  assert.match(readSource("src/lib/workload-identities.ts"), /Shadow agents cannot hold workload identities/);
});

test("trust page shows both sides and hides key surfaces for shadow agents", () => {
  assert.match(PAGE, /Access I gave/);
  assert.match(PAGE, /Access my agents have/);
  assert.match(PAGE, /acceptTrustAction/);
  assert.match(PAGE, /declineTrustAction/);
  assert.match(PAGE, /revokeTrustAction/);
  assert.match(PAGE, /inviteTrustAction/);
  assert.match(ACTIONS, /ctx\.can\("manage_agents"\)/);
  assert.match(readSource("src/components/app/nav.ts"), /\/app\/trust/);
  assert.match(readSource("src/app/app/agents/page.tsx"), /external ·/);
  assert.match(readSource("src/app/app/agents/[id]/page.tsx"), /kind !== "external"/);
});

test("shadow agent calls mirror an audit event to the external environment", () => {
  const events = readSource("src/lib/agent-events.ts");
  assert.match(events, /trustRelationshipId/);
  assert.match(events, /trust\.outbound_call/);
  assert.match(events, /payloadSummary: \{/);
  assert.match(events, /ownerOrgName/);
  assert.match(events, /connector: input\.connectorSlug/);
  assert.match(events, /action: "trust\.outbound_call"/);
});
