import "./helpers/test-env";
import assert from "node:assert/strict";
import test from "node:test";
import { db } from "../src/lib/db";
import { contributingOrgFilter, recordAgentEvent } from "../src/lib/agent-events";
import { recordPolicyEvent } from "../src/lib/policy-events";
import { readSource } from "./helpers/source";

test("new organizations default to contributing and the migration opts old ones out", () => {
  const schema = readSource("prisma/schema.prisma");
  assert.match(schema, /dataContributionEnabled\s+Boolean\s+@default\(true\)/);

  const migration = readSource("prisma/migrations/20261112100500_add_data_contribution/migration.sql");
  const addColumn = migration.indexOf('ADD COLUMN "dataContributionEnabled"');
  const optOut = migration.indexOf('UPDATE "Organization" SET "dataContributionEnabled" = false');
  assert.ok(addColumn >= 0, "migration must add the column");
  assert.ok(optOut > addColumn, "existing organizations are opted out after the column exists");
  assert.equal((migration.match(/UPDATE "Organization"/g) ?? []).length, 1);
  assert.match(migration, /ADD COLUMN "dataContributionEnabled" BOOLEAN NOT NULL DEFAULT true/);

  const provisioning = readSource("src/lib/provisioning.ts");
  assert.match(provisioning, /db\.organization\.create\(\{/);
  assert.equal(provisioning.includes("dataContributionEnabled"), false, "new organizations must inherit the default");
});

test("the change history model records who toggled the setting", () => {
  const schema = readSource("prisma/schema.prisma");
  const model = schema.slice(schema.indexOf("model DataContributionChange"), schema.indexOf("model Consent"));
  for (const field of ["organizationId", "enabled", "changedBy", "changedAt"]) {
    assert.match(model, new RegExp(`\\b${field}\\b`), `DataContributionChange is missing ${field}`);
  }
  assert.match(model, /enabled\s+Boolean/);
  assert.match(model, /@@index\(\[organizationId, changedAt\]\)/);
});

test("the toggle requires manage_security, writes a change row and an audit event", () => {
  const actions = readSource("src/app/app/actions.ts");
  const action = actions.slice(
    actions.indexOf("export async function updateDataContributionAction"),
    actions.indexOf("export async function updateEnvironmentSettingsAction"),
  );
  assert.match(action, /ctx\.capabilities\.manageSecurity/);
  assert.match(action, /enabled !== ctx\.org\.dataContributionEnabled/);
  assert.match(action, /db\.dataContributionChange\.create/);
  assert.match(action, /action: "org\.data_contribution_changed"/);
  assert.match(action, /data: \{ organizationId: ctx\.org\.id, enabled, changedBy: ctx\.user\.id \}/);
  assert.match(readSource("src/lib/audit.ts"), /"org\.data_contribution_changed": "Data contribution changed"/);
});

test("the settings card explains the setting and is capability-gated", () => {
  const settings = readSource("src/app/app/settings/page.tsx");
  assert.match(settings, /title="Data and privacy"/);
  assert.match(settings, /Contribute anonymized usage statistics/);
  assert.match(settings, /name="enabled"/);
  assert.match(settings, /defaultChecked=\{ctx\.org\.dataContributionEnabled\}/);
  assert.match(settings, /disabled=\{!ctx\.capabilities\.manageSecurity\}/);
  assert.match(
    settings,
    /Uses only decision types, action names and counts, never request content, resource names or personal\s+data\./,
  );
});

test("both event writers copy the organization's setting at write time", async () => {
  const originalOrg = db.organization.findUnique;
  const originalAgent = db.agent.findUnique;
  const originalAgentEvent = db.agentEvent.create;
  const originalPolicyEvent = db.policyEvent.create;
  const agentWrites: Record<string, unknown>[] = [];
  const policyWrites: Record<string, unknown>[] = [];
  try {
    (db as unknown as { organization: { findUnique: unknown } }).organization.findUnique = async () => ({
      dataContributionEnabled: false,
    });
    (db as unknown as { agent: { findUnique: unknown } }).agent.findUnique = async () => ({ agentType: "research" });
    (db as unknown as { agentEvent: { create: unknown } }).agentEvent.create = async (args: { data: Record<string, unknown> }) => {
      agentWrites.push(args.data);
      return {};
    };
    (db as unknown as { policyEvent: { create: unknown } }).policyEvent.create = async (args: { data: Record<string, unknown> }) => {
      policyWrites.push(args.data);
      return {};
    };

    await recordAgentEvent({
      environmentId: "env_prod",
      organizationId: "org_optout",
      agentId: "agt_atlas",
      agentType: null,
      requestId: "req_1",
      connectorSlug: "slack",
      action: "messages.send",
      riskClass: "write",
      decision: "allowed",
      decisionReasonCode: "granted",
    });
    await recordPolicyEvent({
      environmentId: "env_prod",
      organizationId: "org_optout",
      agentId: "agt_atlas",
      agentType: null,
      subject: "grant",
      grantId: "grt_1",
      actions: ["messages.send"],
      resourcePattern: "*",
      changeKind: "create",
    });

    assert.equal(agentWrites.length, 1);
    assert.equal(agentWrites[0].contributes, false);
    assert.equal(policyWrites.length, 1);
    assert.equal(policyWrites[0].contributes, false);
  } finally {
    (db as unknown as { organization: { findUnique: unknown } }).organization.findUnique = originalOrg;
    (db as unknown as { agent: { findUnique: unknown } }).agent.findUnique = originalAgent;
    (db as unknown as { agentEvent: { create: unknown } }).agentEvent.create = originalAgentEvent;
    (db as unknown as { policyEvent: { create: unknown } }).policyEvent.create = originalPolicyEvent;
  }
});

test("aggregates only see contributed rows from currently opted-in organizations", async () => {
  const filter = await contributingOrgFilter({
    organization: {
      findMany: async () => [{ id: "org_opted_in" }],
    },
  });
  assert.deepEqual(filter, { contributes: true, organizationId: { in: ["org_opted_in"] } });
  assert.equal(filter.contributes, true);

  const none = await contributingOrgFilter({ organization: { findMany: async () => [] } });
  assert.deepEqual(none.organizationId.in, []);
});

test("the legal copy matches the published wording", () => {
  const privacy = readSource("src/app/legal/privacy/page.tsx");
  assert.match(privacy, /id="usage-statistics"/);
  assert.match(privacy, /We use anonymized usage statistics, such as decision types, action names, timing and counts/);
  assert.match(privacy, /never include the content of requests or/);
  assert.match(privacy, /groups large/);
  assert.match(privacy, /no single customer can be identified/);
  assert.match(privacy, /You can turn this off in your organization settings at any/);

  assert.match(readSource("src/app/legal/terms/page.tsx"), /href="\/legal\/privacy#usage-statistics"/);
  assert.match(readSource("src/app/(auth)/sign-up/sign-up-form.tsx"), /href="\/legal\/privacy#usage-statistics"/);
});
