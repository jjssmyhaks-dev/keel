import "./helpers/test-env";
import assert from "node:assert/strict";
import test from "node:test";
import { db } from "../src/lib/db";
import {
  AGENT_EVENT_FIELDS,
  DECISION_REASON_CODES,
  buildAgentEventRow,
  contributingOrgFilter,
  delegationDepthFromClaims,
  mapPolicySource,
  pruneAgentEvents,
  recordAgentEvent,
  resourceTypeOf,
  upstreamStatusClass,
  type AgentEventInput,
} from "../src/lib/agent-events";
import { approvalLatency } from "../src/lib/proxy";
import { filesContaining, readSource } from "./helpers/source";

const BASE: AgentEventInput = {
  environmentId: "env_prod",
  organizationId: "org_acme",
  agentId: "agt_atlas",
  agentType: "research",
  requestId: "req_1",
  connectorSlug: "slack",
  action: "messages.send",
  riskClass: "write",
  resourceType: "message",
  decision: "allowed",
  decisionReasonCode: "granted",
};

test("the envelope carries exactly the documented fields", () => {
  assert.deepEqual(AGENT_EVENT_FIELDS, [
    "schemaVersion",
    "occurredAt",
    "environmentId",
    "organizationId",
    "agentId",
    "agentType",
    "requestId",
    "connectorSlug",
    "action",
    "riskClass",
    "resourceType",
    "decision",
    "decisionReasonCode",
    "approvalLatencyMs",
    "upstreamStatusClass",
    "latencyMs",
    "costUnits",
    "delegationDepth",
    "isSandbox",
    "contributes",
    "credentialId",
  ]);
});

test("the row builder applies defaults and rejects unknown enums", () => {
  const row = buildAgentEventRow(BASE);
  assert.equal(row.schemaVersion, 1);
  assert.ok(row.occurredAt instanceof Date);
  assert.equal(row.agentType, "research");
  assert.equal(row.decision, "allowed");
  assert.equal(row.decisionReasonCode, "granted");
  assert.equal(row.approvalLatencyMs, null);
  assert.equal(row.upstreamStatusClass, null);
  assert.equal(row.latencyMs, null);
  assert.equal(row.costUnits, 1);
  assert.equal(row.delegationDepth, 0);
  assert.equal(row.isSandbox, false);
  assert.equal(row.contributes, false);
  assert.equal(row.credentialId, null);

  const fallback = buildAgentEventRow({
    ...BASE,
    agentType: "  ",
    resourceType: "",
    riskClass: "urgent",
    decision: "maybe",
    decisionReasonCode: "because",
  });
  assert.equal(fallback.agentType, "other");
  assert.equal(fallback.resourceType, "resource");
  assert.equal(fallback.riskClass, "write");
  assert.equal(fallback.decision, "errored");
  assert.equal(fallback.decisionReasonCode, "internal_error");

  for (const decision of ["allowed", "approved", "denied", "errored", "pending_approval"]) {
    assert.equal(buildAgentEventRow({ ...BASE, decision }).decision, decision);
  }
  for (const reason of DECISION_REASON_CODES) {
    assert.equal(buildAgentEventRow({ ...BASE, decisionReasonCode: reason }).decisionReasonCode, reason);
  }
});

test("every Decision.source in policy.ts maps to a reason code", () => {
  const expected: Record<string, string> = {
    "agent.status": "agent_inactive",
    connector: "unknown_action",
    "credential.status": "credential_unusable",
    "credential.expired": "credential_unusable",
    "credential.unhealthy": "credential_unusable",
    "grant.missing": "no_grant",
    "grant.actions": "action_not_granted",
    "grant.resource": "resource_not_granted",
    "grant.conditions": "condition_failed",
    "grant.expired": "grant_expired",
    "grant.just_in_time": "jit_pending",
    autonomous: "allowed_autonomous",
  };
  for (const [source, reason] of Object.entries(expected)) {
    assert.equal(mapPolicySource(source), reason, `${source} must map to ${reason}`);
  }
  assert.equal(mapPolicySource("not.a.source"), "internal_error");

  const policy = readSource("src/lib/policy.ts");
  const sources = [...new Set([...policy.matchAll(/source:\s*"([^"]+)"/g)].map((match) => match[1]))].sort();
  assert.deepEqual(sources, Object.keys(expected).sort());
  for (const source of sources) {
    assert.notEqual(mapPolicySource(source), "internal_error", `policy.ts uses unmapped source ${source}`);
  }
});

test("status class and delegation depth normalize their inputs", () => {
  assert.equal(upstreamStatusClass(200), "2xx");
  assert.equal(upstreamStatusClass(299), "2xx");
  assert.equal(upstreamStatusClass(302), "3xx");
  assert.equal(upstreamStatusClass(404), "4xx");
  assert.equal(upstreamStatusClass(503), "5xx");
  assert.equal(upstreamStatusClass(599), "5xx");
  assert.equal(upstreamStatusClass(600), "5xx");
  assert.equal(upstreamStatusClass(199), "none");
  assert.equal(upstreamStatusClass(0), "none");
  assert.equal(upstreamStatusClass(null), "none");
  assert.equal(upstreamStatusClass(undefined), "none");

  assert.equal(delegationDepthFromClaims(null), 0);
  assert.equal(delegationDepthFromClaims(undefined), 0);
  assert.equal(delegationDepthFromClaims({}), 0);
  assert.equal(delegationDepthFromClaims({ parent_chain: "agt_parent" }), 0);
  assert.equal(delegationDepthFromClaims({ parent_chain: ["agt_a", 7, "agt_b", null, "agt_c"] }), 3);
});

test("resource labels prefer the action, then the connector, then the default", () => {
  assert.equal(resourceTypeOf({ resourceLabel: "Channel" }, { resourceLabel: "Workspace" }), "Channel");
  assert.equal(resourceTypeOf({ resourceLabel: "  " }, { resourceLabel: "Workspace" }), "Workspace");
  assert.equal(resourceTypeOf(null, { resourceLabel: "Workspace" }), "Workspace");
  assert.equal(resourceTypeOf(null, null), "resource");
});

test("no stored field carries request input, resource text or a secret", () => {
  const secret = "sk_live_do_not_store";
  const resourceText = "Payroll spreadsheet for Dana";
  const row = buildAgentEventRow({
    ...BASE,
    resourceType: "payroll",
    resourceText,
    input: { query: resourceText, authorization: secret },
    secret,
  } as unknown as AgentEventInput);

  const serialized = JSON.stringify(row);
  assert.equal(serialized.includes(secret), false);
  assert.equal(serialized.includes(resourceText), false);
  assert.equal(serialized.includes("Dana"), false);
  assert.deepEqual(Object.keys(row).sort(), [...AGENT_EVENT_FIELDS].sort());
});

test("the writer resolves contribution and agent type, and a failed write never throws", async () => {
  const originalCreate = db.agentEvent.create;
  const originalOrg = db.organization.findUnique;
  const originalAgent = db.agent.findUnique;
  const originalError = console.error;
  const writes: Record<string, unknown>[] = [];
  console.error = () => {};
  try {
    (db as unknown as { agentEvent: { create: unknown } }).agentEvent.create = async (args: { data: Record<string, unknown> }) => {
      writes.push(args.data);
      return {};
    };
    (db as unknown as { organization: { findUnique: unknown } }).organization.findUnique = async () => ({
      dataContributionEnabled: true,
    });
    (db as unknown as { agent: { findUnique: unknown } }).agent.findUnique = async () => ({ agentType: "support" });

    await recordAgentEvent({ ...BASE, agentType: null });
    assert.equal(writes.length, 1);
    assert.equal(writes[0].contributes, true);
    assert.equal(writes[0].agentType, "support");

    (db as unknown as { agentEvent: { create: unknown } }).agentEvent.create = async () => {
      throw new Error("database down");
    };
    await recordAgentEvent({ ...BASE, contributes: false });
    assert.equal(writes.length, 1);
  } finally {
    (db as unknown as { agentEvent: { create: unknown } }).agentEvent.create = originalCreate;
    (db as unknown as { organization: { findUnique: unknown } }).organization.findUnique = originalOrg;
    (db as unknown as { agent: { findUnique: unknown } }).agent.findUnique = originalAgent;
    console.error = originalError;
  }
});

test("contribution filters require both a contributed row and an opted-in organization", async () => {
  const calls: { where?: Record<string, unknown> }[] = [];
  const filter = await contributingOrgFilter({
    organization: {
      findMany: async (args: { where: Record<string, unknown> }) => {
        calls.push(args);
        return [{ id: "org_a" }, { id: "org_b" }];
      },
    },
  });
  assert.deepEqual(filter, { contributes: true, organizationId: { in: ["org_a", "org_b"] } });
  assert.deepEqual(calls[0].where, { dataContributionEnabled: true, deletedAt: null });

  const empty = await contributingOrgFilter({ organization: { findMany: async () => [] } });
  assert.deepEqual(empty, { contributes: true, organizationId: { in: [] } });
});

test("retention deletes in full batches only", async () => {
  const originalFindMany = db.agentEvent.findMany;
  const originalDeleteMany = db.agentEvent.deleteMany;
  const cutoff = new Date("2025-01-01T00:00:00.000Z");
  let finds = 0;
  const deleteCalls: string[][] = [];
  try {
    (db as unknown as { agentEvent: { findMany: unknown } }).agentEvent.findMany = async (args: {
      where: { occurredAt: { lt: Date } };
      take: number;
    }) => {
      finds += 1;
      assert.deepEqual(args.where, { occurredAt: { lt: cutoff } });
      assert.equal(args.take, 2);
      return finds === 1 ? [{ id: "ev_1" }, { id: "ev_2" }] : [{ id: "ev_3" }];
    };
    (db as unknown as { agentEvent: { deleteMany: unknown } }).agentEvent.deleteMany = async (args: {
      where: { id: { in: string[] } };
    }) => {
      deleteCalls.push(args.where.id.in);
      return { count: args.where.id.in.length };
    };

    assert.equal(await pruneAgentEvents(cutoff, 5, 2), 3);
    assert.equal(finds, 2);
    assert.deepEqual(deleteCalls, [["ev_1", "ev_2"], ["ev_3"]]);
  } finally {
    (db as unknown as { agentEvent: { findMany: unknown } }).agentEvent.findMany = originalFindMany;
    (db as unknown as { agentEvent: { deleteMany: unknown } }).agentEvent.deleteMany = originalDeleteMany;
  }
});

test("exactly one event is written per documented outcome site", () => {
  const sites = filesContaining("src", "recordAgentEvent({");
  assert.deepEqual(sites, [
    "src/app/api/v1/proxy/[connector]/route.ts",
    "src/lib/approvals.ts",
    "src/lib/proxy.ts",
  ]);

  const proxyRoute = readSource("src/app/api/v1/proxy/[connector]/route.ts");
  assert.equal((proxyRoute.match(/recordAgentEvent\(/g) ?? []).length, 4);
  assert.match(proxyRoute, /decisionReasonCode: "rate_limited"/);
  assert.match(proxyRoute, /decisionReasonCode: "scope_not_granted"/);
  assert.match(proxyRoute, /decisionReasonCode: mapPolicySource\(decision\.source\)/);
  assert.match(proxyRoute, /decision: "pending_approval"[\s\S]*?decisionReasonCode: "approval_required"/);

  const execution = readSource("src/lib/proxy.ts");
  assert.equal((execution.match(/recordAgentEvent\(/g) ?? []).length, 3);
  assert.match(execution, /decision: opts\.approvalId \? "approved" : "allowed"/);
  assert.match(execution, /opts\.approvalId \? "approval_approved" : "granted"/);
  assert.match(execution, /decisionReasonCode: "provider_error"/);
  assert.match(execution, /upstreamStatusClass: "none"/);
  assert.match(execution, /"provider_auth_failed"/);

  const approvals = readSource("src/lib/approvals.ts");
  assert.equal((approvals.match(/recordAgentEvent\(/g) ?? []).length, 3);
  assert.match(approvals, /decisionReasonCode: "approval_denied"/);
  assert.equal((approvals.match(/decisionReasonCode: "approval_expired"/g) ?? []).length, 2);
});

test("the writer is wrapped so a database failure cannot break a call", () => {
  const writer = readSource("src/lib/agent-events.ts");
  assert.match(writer, /export async function recordAgentEvent[\s\S]*?try \{/);
  assert.match(writer, /catch \(error\) \{\s*console\.error\("\[authab\] agent event write failed"/);
});

test("approved execution measures latency from the approval", async () => {
  const original = db.approvalRequest.findUnique;
  (db as unknown as { approvalRequest: { findUnique: unknown } }).approvalRequest.findUnique = async () => ({
    createdAt: new Date(Date.now() - 1500),
  });
  try {
    const latency = await approvalLatency("apr_1");
    assert.ok(latency !== null);
    assert.ok(latency > 0);
    assert.ok(latency >= 1500);
    assert.equal(await approvalLatency(undefined), null);
  } finally {
    (db as unknown as { approvalRequest: { findUnique: unknown } }).approvalRequest.findUnique = original;
  }
});

test("retention runs nightly at 400 days and the migration matches the model", () => {
  assert.match(
    readSource("src/app/api/cron/webhooks/route.ts"),
    /pruneAgentEvents\(new Date\(now - 400 \* 86_400_000\)\)/,
  );
  const migration = readSource("prisma/migrations/20261112100300_add_agent_events/migration.sql");
  for (const field of AGENT_EVENT_FIELDS) {
    assert.ok(migration.includes(`"${field}"`), `migration is missing ${field}`);
  }
  assert.match(migration, /CREATE INDEX "AgentEvent_environmentId_occurredAt_idx"/);
  assert.match(migration, /CREATE INDEX "AgentEvent_agentId_occurredAt_idx"/);
  assert.match(migration, /CREATE INDEX "AgentEvent_organizationId_occurredAt_idx"/);
  assert.match(migration, /CREATE INDEX "AgentEvent_connectorSlug_action_idx"/);
});
