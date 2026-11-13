import "./helpers/test-env";
import assert from "node:assert/strict";
import test from "node:test";
import {
  agentConfigChanges,
  approvalPolicyConfigChanges,
  grantConfigChanges,
  normalizeActions,
  sameSet,
  stable,
  webhookConfigChanges,
} from "../src/lib/config/plan";
import { CONFIG_LIMITS, CONFIG_VERSION, normalizeConfig } from "../src/lib/config/types";
import { validateActions } from "../src/lib/grants";
import { readSource } from "./helpers/source";

const EXPORT = readSource("src/lib/config/export.ts");
const EXPORT_ROUTE = readSource("src/app/api/v1/config/export/route.ts");
const APPLY_ROUTE = readSource("src/app/api/v1/config/apply/route.ts");
const APPLY = readSource("src/lib/config/apply.ts");
const CLI = readSource("cli/src/index.ts");
const SDK_CONFIG = readSource("sdk/src/resources/config.ts");

function errorCode(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return (error as { code?: string }).code ?? "";
  }
  return "";
}

test("config normalisation validates version, limits and unknown keys", () => {
  const config = normalizeConfig({
    version: 1,
    environment: " development ",
    agents: [{ name: "Researcher", tags: [" research ", ""], extra: "ignored" }],
    connections: [{ name: "Support inbox", connector: "gmail", secret: "sk_live_nope" }],
    grants: [
      {
        agent: "Researcher",
        connection: "Support inbox",
        actions: [" gmail.messages.read "],
        expiresAt: "2027-01-01T00:00:00Z",
      },
    ],
  });

  assert.equal(config.version, CONFIG_VERSION);
  assert.equal(config.environment, "development");
  assert.deepEqual(config.agents[0].tags, ["research"]);
  assert.equal(config.agents[0].autonomousMode, false);
  assert.equal("extra" in config.agents[0], false);
  assert.equal("secret" in config.connections[0], false);
  assert.equal(config.grants[0].resource, "*");
  assert.deepEqual(config.grants[0].conditions, {});
  assert.equal(config.grants[0].approvalMode, null);
  assert.equal(config.grants[0].expiresAt, "2027-01-01T00:00:00.000Z");
  assert.deepEqual(config.approvalPolicies, []);
  assert.deepEqual(config.webhooks, []);

  assert.equal(errorCode(() => normalizeConfig({ version: 2 })), "unsupported_version");
  assert.equal(errorCode(() => normalizeConfig({ version: 1, agents: [{ name: "A" }] })), "invalid_config");
  assert.equal(
    errorCode(() => normalizeConfig({ version: 1, agents: [{ name: "Okay", type: "marketing" }] })),
    "invalid_agent_type",
  );
  assert.equal(errorCode(() => normalizeConfig({ version: 1, webhooks: "nope" })), "invalid_config");
  assert.equal(
    errorCode(() =>
      normalizeConfig({
        version: 1,
        grants: [{ agent: "Agent", connection: "Inbox", actions: ["read"], expiresAt: "not-a-date" }],
      }),
    ),
    "invalid_config",
  );
  assert.equal(
    errorCode(() =>
      normalizeConfig({
        version: 1,
        agents: Array.from({ length: CONFIG_LIMITS.agents + 1 }, (_, index) => ({ name: `Agent ${index}` })),
      }),
    ),
    "config_too_large",
  );
});

test("agent and policy diffs are idempotent", () => {
  const agent = { agentType: "support", description: "Handles tickets", tagsJson: '["b","a"]', autonomousMode: false };
  assert.deepEqual(
    agentConfigChanges(agent, { type: "support", description: "Handles tickets", tags: ["a", "b", "b"], autonomousMode: false }),
    [],
  );
  assert.deepEqual(
    agentConfigChanges(agent, { type: "research", description: null, tags: ["a"], autonomousMode: true }),
    ["type", "description", "tags", "autonomousMode"],
  );

  const policy = { mode: "require_approval", slaMinutes: 30, escalateToRole: "admin" };
  assert.deepEqual(approvalPolicyConfigChanges(policy, { ...policy }), []);
  assert.deepEqual(approvalPolicyConfigChanges(policy, { mode: "allow", slaMinutes: null, escalateToRole: null }), [
    "mode",
    "slaMinutes",
    "escalateToRole",
  ]);
});

test("grant diffs ignore ordering and formatting but catch every field", () => {
  const existing = {
    actionsJson: '["gmail.messages.read","gmail.messages.send"]',
    resourcePattern: "*",
    conditionsJson: '{"maxAmount":10,"currency":"USD"}',
    approvalMode: "require_approval",
    expiresAt: new Date("2027-01-01T00:00:00.000Z"),
  };
  assert.deepEqual(
    grantConfigChanges(existing, {
      actions: ["gmail.messages.send", "gmail.messages.read", "gmail.messages.read"],
      resource: "*",
      conditions: { currency: "USD", maxAmount: 10 },
      approvalMode: "require_approval",
      expiresAt: new Date("2027-01-01T00:00:00.000Z"),
    }),
    [],
    "a second apply of the same grant must produce an empty plan",
  );
  assert.deepEqual(
    grantConfigChanges(existing, {
      actions: ["gmail.messages.read"],
      resource: "inbox/*",
      conditions: {},
      approvalMode: null,
      expiresAt: null,
    }),
    ["actions", "resource", "conditions", "approvalMode", "expiresAt"],
  );
});

test("webhook diffs and action normalisation are set-based", () => {
  assert.deepEqual(webhookConfigChanges('["grant.created","agent.registered"]', ["agent.registered", "grant.created"]), []);
  assert.deepEqual(webhookConfigChanges('["grant.created"]', ["agent.registered"]), ["events"]);
  assert.deepEqual(normalizeActions([" grant.created ", "grant.created", "", "agent.registered"]), [
    "agent.registered",
    "grant.created",
  ]);
  assert.equal(sameSet(["a", "b", "a"], ["b", "a"]), true);
  assert.equal(stable({ b: 1, a: [2, 3] }), stable({ a: [2, 3], b: 1 }));
  assert.notEqual(stable({ a: 1 }), stable({ a: 2 }));
});

test("export returns metadata only and skips revoked or end-user records", () => {
  assert.match(EXPORT, /endUserId: null/g);
  assert.match(EXPORT, /status: \{ not: "revoked" \}/);
  assert.match(EXPORT, /metadata: JSON\.parse\(credential\.metadataJson/);
  assert.match(EXPORT, /grant\.credential\.status !== "revoked"/);
  assert.match(EXPORT, /grant\.credential\.revokedAt/);
  assert.doesNotMatch(EXPORT, /encryptedPayload|dataKeyEncrypted|secretJson|ciphertext|plaintext|maskedHint/i);
  assert.doesNotMatch(EXPORT, /credential\.create|storeCredential/);

  assert.match(EXPORT_ROUTE, /format !== "json" && format !== "yaml"/);
  assert.match(EXPORT_ROUTE, /application\/yaml/);
  assert.match(EXPORT_ROUTE, /no-store/);
});

test("apply is secret-key only and never creates connections or agents by side effect", () => {
  assert.match(APPLY_ROUTE, /requireSecretKey\(auth\)/);
  assert.match(APPLY_ROUTE, /x-authab-confirm/);
  assert.match(APPLY_ROUTE, /dryRun: body\.dryRun === true/);
  assert.match(APPLY_ROUTE, /invalid_yaml/);
  assert.match(APPLY_ROUTE, /config_required/);

  assert.doesNotMatch(APPLY, /credential\.create|storeCredential/);
  assert.doesNotMatch(APPLY, /agent\.delete|credential\.delete/);
  assert.match(APPLY, /unknown_connection/);
  assert.match(APPLY, /Connections need secrets, so create it in the vault first\./);
  assert.match(APPLY, /credential_revoked/);
});

test("apply rejects ambiguous keys and duplicate declarations", () => {
  assert.match(APPLY, /409,\s*\n\s*"ambiguous_name"/);
  for (const code of ["duplicate_agent", "duplicate_grant", "duplicate_policy", "duplicate_webhook", "duplicate_connection"]) {
    assert.match(APPLY, new RegExp(code), `apply must reject with ${code}`);
  }
  assert.match(APPLY, /unknown_agent/);
  assert.match(APPLY, /invalid_actions/);
  assert.match(APPLY, /invalid_approval_mode/);
  assert.match(APPLY, /invalid_mode/);
});

test("apply is atomic, audited as config.applied and prunes only grants, policies and webhooks", () => {
  const start = APPLY.indexOf("const execution = await db.$transaction");
  const end = APPLY.indexOf("for (const agent of execution.createdAgents)");
  assert.ok(start > 0 && end > start, "apply must wrap writes in db.$transaction");
  const transactionBody = APPLY.slice(start, end);

  assert.match(transactionBody, /createGrantService\(/);
  assert.match(transactionBody, /createApprovalPolicyService\(/);
  assert.match(transactionBody, /createWebhookService\(/);
  assert.match(transactionBody, /deleteGrantService\(/);
  assert.match(transactionBody, /deleteApprovalPolicyService\(/);
  assert.match(transactionBody, /deleteWebhookService\(/);
  assert.match(transactionBody, /action: "config\.applied"/);
  assert.match(transactionBody, /prune: options\.prune/);
  assert.doesNotMatch(transactionBody, /dispatchEvent|issueIdentityDocumentSafe/);

  assert.ok(APPLY.indexOf("await dispatchEvent(") > end, "webhooks fire after the transaction commits");
  assert.ok(APPLY.indexOf("await issueIdentityDocumentSafe(") > end, "identity documents are issued after commit");

  assert.match(APPLY, /const grantDeletes: LoadedGrant\[\]/);
  assert.match(APPLY, /const policyDeletes: ApprovalPolicy\[\]/);
  assert.match(APPLY, /const webhookDeletes: WebhookEndpoint\[\]/);
  assert.doesNotMatch(APPLY, /agentDeletes|credentialDeletes/);
  assert.match(APPLY, /checkPlanLimit\(actor\.organizationId, "agents"/);
  assert.match(APPLY, /productionAccess\(actor\.plan, actor\.planStatus\)/);
  assert.match(APPLY, /if \(options\.dryRun\) return result;/);
  assert.match(APPLY, /changes\.includes\("actions"\)/);
});

test("production prune needs the confirm header and environment must match", () => {
  assert.match(APPLY, /confirmation_required/);
  assert.match(APPLY, /x-authab-confirm: prune header/);
  assert.match(APPLY, /environment_mismatch/);
  assert.match(APPLY, /Apply with prune to delete them\./);
});

test("CLI and SDK expose export, dry-run, prune and one-time secrets", () => {
  assert.match(CLI, /authab\.config\.apply\(/);
  assert.match(CLI, /dryRun/);
  assert.match(CLI, /prune/);
  assert.match(CLI, /webhookSecrets/);
  assert.match(CLI, /privateKey/);
  assert.match(CLI, /config export \[--format yaml\|json\]/);

  assert.match(SDK_CONFIG, /exportYaml/);
  assert.match(SDK_CONFIG, /x-authab-confirm/);
  assert.match(SDK_CONFIG, /confirmPrune/);
});

test("grant action validation accepts catalogue wildcards and rejects empty patterns", async () => {
  assert.equal((await validateActions("sandbox", ["sandbox.*"], "env_test")).ok, true);
  assert.equal((await validateActions("sandbox", ["sandbox.echo", "risk:write"], "env_test")).ok, true);
  assert.equal((await validateActions("sandbox", ["sandbox.*", "slack.post_message"], "env_test")).ok, false);
  assert.equal((await validateActions("sandbox", ["sandy.*"], "env_test")).ok, false);
});
