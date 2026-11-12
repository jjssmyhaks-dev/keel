import "./helpers/test-env";
import assert from "node:assert/strict";
import test from "node:test";
import { db } from "../src/lib/db";
import {
  buildPolicyEventRow,
  classifyResourceShape,
  recordPolicyEvent,
  sortedActionSet,
  sortedConditionKeys,
  type PolicyEventInput,
} from "../src/lib/policy-events";
import { filesContaining, readSource } from "./helpers/source";

const BASE: PolicyEventInput = {
  environmentId: "env_prod",
  organizationId: "org_acme",
  agentId: "agt_atlas",
  agentType: "research",
  subject: "grant",
  grantId: "grt_1",
  connectorSlug: "slack",
  actions: ["messages.send", "messages.read"],
  resourcePattern: "chan-#ops-*",
  approvalMode: "require_approval",
  conditions: { maxAmount: 5000 },
  changeKind: "create",
};

test("resource shapes are classified without storing the pattern", () => {
  assert.equal(classifyResourceShape(null), "any");
  assert.equal(classifyResourceShape(undefined), "any");
  assert.equal(classifyResourceShape(""), "any");
  assert.equal(classifyResourceShape("   "), "any");
  assert.equal(classifyResourceShape("*"), "any");
  assert.equal(classifyResourceShape("#ops-general"), "single");
  assert.equal(classifyResourceShape("#ops-*"), "pattern");
  assert.equal(classifyResourceShape("chan-?"), "pattern");
});

test("action sets and condition keys are sorted and de-duplicated", () => {
  assert.deepEqual(sortedActionSet(["b", "a", "b", " a ", 7, null]), ["a", "b"]);
  assert.deepEqual(sortedActionSet("not-an-array"), []);
  assert.deepEqual(sortedConditionKeys({ zeta: 1, alpha: 2 }), ["alpha", "zeta"]);
  assert.deepEqual(sortedConditionKeys(["nope"]), []);
  assert.deepEqual(sortedConditionKeys(null), []);
});

test("the row builder stores keys and shapes, never resource text or values", () => {
  const row = buildPolicyEventRow(BASE);
  assert.equal(row.subject, "grant");
  assert.equal(row.changeKind, "create");
  assert.equal(row.agentType, "research");
  assert.deepEqual(JSON.parse(row.actionSetJson), ["messages.read", "messages.send"]);
  assert.deepEqual(JSON.parse(row.conditionKeysJson), ["maxAmount"]);
  assert.equal(row.resourceShape, "pattern");
  assert.equal(row.isSandbox, false);
  assert.equal(row.contributes, false);
  assert.equal(row.changedFromEventId, null);

  const serialized = JSON.stringify(row);
  assert.equal(serialized.includes("chan-#ops-*"), false);
  assert.equal(serialized.includes("5000"), false);

  const fallback = buildPolicyEventRow({
    ...BASE,
    subject: "unknown_subject",
    agentType: " ",
    changeKind: "archive",
    actions: "messages.send",
    conditions: { token: "super-secret-value" },
  });
  assert.equal(fallback.subject, "grant");
  assert.equal(fallback.agentType, "other");
  assert.equal(fallback.changeKind, "update");
  assert.equal(fallback.actionSetJson, "[]");
  assert.deepEqual(JSON.parse(fallback.conditionKeysJson), ["token"]);
  assert.equal(JSON.stringify(fallback).includes("super-secret-value"), false);
});

test("a failed policy event write never breaks the permission change", async () => {
  const originalCreate = db.policyEvent.create;
  const originalError = console.error;
  console.error = () => {};
  try {
    (db as unknown as { policyEvent: { create: unknown } }).policyEvent.create = async () => {
      throw new Error("database down");
    };
    await recordPolicyEvent({ ...BASE, contributes: false, agentType: "research" });
  } finally {
    (db as unknown as { policyEvent: { create: unknown } }).policyEvent.create = originalCreate;
    console.error = originalError;
  }
});

test("an update links to the previous event and resolves org contribution", async () => {
  const originalOrg = db.organization.findUnique;
  const originalAgent = db.agent.findUnique;
  const originalFindFirst = db.policyEvent.findFirst;
  const originalCreate = db.policyEvent.create;
  const writes: Record<string, unknown>[] = [];
  const lookups: unknown[] = [];
  try {
    (db as unknown as { organization: { findUnique: unknown } }).organization.findUnique = async () => ({
      dataContributionEnabled: true,
    });
    (db as unknown as { agent: { findUnique: unknown } }).agent.findUnique = async () => ({ agentType: "finance" });
    (db as unknown as { policyEvent: { findFirst: unknown } }).policyEvent.findFirst = async (args: unknown) => {
      lookups.push(args);
      return { id: "pe_previous" };
    };
    (db as unknown as { policyEvent: { create: unknown } }).policyEvent.create = async (args: {
      data: Record<string, unknown>;
    }) => {
      writes.push(args.data);
      return {};
    };

    await recordPolicyEvent({
      ...BASE,
      agentType: null,
      contributes: undefined,
      changeKind: "update",
      conditions: { maxAmount: 5000 },
    });

    assert.equal(writes.length, 1);
    assert.equal(writes[0].changedFromEventId, "pe_previous");
    assert.equal(writes[0].contributes, true);
    assert.equal(writes[0].agentType, "finance");
    assert.deepEqual(JSON.parse(String(writes[0].conditionKeysJson)), ["maxAmount"]);
    assert.deepEqual(lookups, [
      { where: { grantId: "grt_1" }, orderBy: { createdAt: "desc" }, select: { id: true } },
    ]);
  } finally {
    (db as unknown as { organization: { findUnique: unknown } }).organization.findUnique = originalOrg;
    (db as unknown as { agent: { findUnique: unknown } }).agent.findUnique = originalAgent;
    (db as unknown as { policyEvent: { findFirst: unknown } }).policyEvent.findFirst = originalFindFirst;
    (db as unknown as { policyEvent: { create: unknown } }).policyEvent.create = originalCreate;
  }
});

test("creates do not look up or link a previous event", async () => {
  const originalFindFirst = db.policyEvent.findFirst;
  const originalCreate = db.policyEvent.create;
  const writes: Record<string, unknown>[] = [];
  try {
    (db as unknown as { policyEvent: { findFirst: unknown } }).policyEvent.findFirst = async () => {
      throw new Error("create must not query history");
    };
    (db as unknown as { policyEvent: { create: unknown } }).policyEvent.create = async (args: {
      data: Record<string, unknown>;
    }) => {
      writes.push(args.data);
      return {};
    };
    await recordPolicyEvent({ ...BASE, subject: "approval_policy", grantId: null, approvalPolicyId: "ap_1", changeKind: "create", contributes: false });
    assert.equal(writes.length, 1);
    assert.equal(writes[0].changedFromEventId, null);
    assert.equal(writes[0].approvalPolicyId, "ap_1");
  } finally {
    (db as unknown as { policyEvent: { findFirst: unknown } }).policyEvent.findFirst = originalFindFirst;
    (db as unknown as { policyEvent: { create: unknown } }).policyEvent.create = originalCreate;
  }
});

test("every permission-change site records one policy event", () => {
  const sites = filesContaining("src", "recordPolicyEvent({");
  assert.deepEqual(sites, [
    "src/app/api/v1/approval-policies/[id]/route.ts",
    "src/app/api/v1/approval-policies/route.ts",
    "src/app/api/v1/delegations/route.ts",
    "src/app/api/v1/grants/[id]/route.ts",
    "src/app/api/v1/grants/route.ts",
    "src/app/app/actions.ts",
    "src/lib/approvals.ts",
    "src/lib/promotion.ts",
    "src/lib/sandbox.ts",
  ]);

  const grantsRoute = readSource("src/app/api/v1/grants/route.ts");
  assert.match(grantsRoute, /subject: "grant"/);
  assert.match(grantsRoute, /changeKind: "create"/);
  assert.match(grantsRoute, /isSandbox: credential\.connectorSlug === "sandbox"/);

  const grantsDetail = readSource("src/app/api/v1/grants/[id]/route.ts");
  assert.match(grantsDetail, /subject: "grant"/);
  assert.match(grantsDetail, /changeKind: "update"/);
  assert.match(grantsDetail, /changeKind: "delete"/);
  assert.match(grantsDetail, /isSandbox: grant\.credential\.connectorSlug === "sandbox"/);

  const policiesRoute = readSource("src/app/api/v1/approval-policies/route.ts");
  assert.match(policiesRoute, /subject: "approval_policy"/);
  assert.match(policiesRoute, /changeKind: "create"/);
  const policiesDetail = readSource("src/app/api/v1/approval-policies/[id]/route.ts");
  assert.match(policiesDetail, /subject: "approval_policy"/);
  assert.match(policiesDetail, /changeKind: "update"/);
  assert.match(policiesDetail, /changeKind: "delete"/);

  assert.match(readSource("src/app/api/v1/delegations/route.ts"), /subject: "delegation"/);

  const dashboard = readSource("src/app/app/actions.ts");
  assert.match(dashboard, /subject: "grant"/);
  assert.match(dashboard, /changeKind: "delete"/);
  assert.match(dashboard, /before \? "update" : "create"/);

  const approvals = readSource("src/lib/approvals.ts");
  assert.match(approvals, /subject: "jit_grant"/);
  assert.match(approvals, /subject: "grant"/);
  assert.match(approvals, /approveAlways[\s\S]*?recordPolicyEvent\(\{[\s\S]*?changeKind: "update"/);

  const promotion = readSource("src/lib/promotion.ts");
  assert.match(promotion, /subject: "grant"/);
  assert.match(promotion, /subject: "approval_policy"/);

  const sandbox = readSource("src/lib/sandbox.ts");
  assert.match(sandbox, /subject: "grant"/);
  assert.match(sandbox, /isSandbox: true/);
});

test("the writer and migration match the documented model", () => {
  const writer = readSource("src/lib/policy-events.ts");
  assert.match(writer, /export async function recordPolicyEvent[\s\S]*?try \{/);
  assert.match(writer, /catch \(error\) \{\s*console\.error\("\[authab\] policy event write failed"/);

  const migration = readSource("prisma/migrations/20261112100400_add_policy_events_and_agent_type/migration.sql");
  assert.match(migration, /ALTER TABLE "Agent" ADD COLUMN "agentType" TEXT NOT NULL DEFAULT 'other'/);
  assert.match(migration, /CREATE TABLE "PolicyEvent"/);
  assert.match(migration, /CREATE INDEX "PolicyEvent_environmentId_createdAt_idx"/);
  assert.match(migration, /CREATE INDEX "PolicyEvent_organizationId_createdAt_idx"/);
});
