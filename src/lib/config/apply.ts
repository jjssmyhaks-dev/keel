import type { Agent, ApprovalPolicy, Credential, Grant, WebhookEndpoint } from "@prisma/client";
import { db } from "../db";
import { ApiError } from "../api";
import { auditEvent } from "../audit";
import { validateActions } from "../grants";
import { checkPlanLimit, productionAccess } from "../limits";
import { dispatchEvent } from "../webhooks";
import { issueIdentityDocumentSafe } from "../identity-document";
import {
  APPROVAL_MODES,
  createGrantService,
  deleteGrantService,
  updateGrantService,
  type CreateGrantInput,
  type GrantCredentialRef,
  type GrantWithRefs,
} from "../services/grants";
import {
  POLICY_MODES,
  createApprovalPolicyService,
  deleteApprovalPolicyService,
  normalizeEscalationRole,
  normalizeSla,
  updateApprovalPolicyService,
} from "../services/approval-policies";
import {
  createWebhookService,
  deleteWebhookService,
  normalizeWebhookEvents,
  safeWebhookUrl,
  updateWebhookService,
} from "../services/webhooks";
import { registerAgentService, updateAgentConfigService } from "../services/agents";
import type { ServiceActor } from "../services/types";
import {
  agentConfigChanges,
  approvalPolicyConfigChanges,
  grantConfigChanges,
  normalizeActions,
  webhookConfigChanges,
} from "./plan";
import { normalizeConfig, type ConfigV1 } from "./types";

export type ConfigApplyActor = ServiceActor & {
  projectId: string;
  plan: string;
  planStatus: string;
  isProduction: boolean;
  confirmPrune: boolean;
};

export type ConfigChange = { key: string; changes: string[] };

export type ConfigApplyPlan = {
  create: string[];
  update: ConfigChange[];
  delete: string[];
  warnings: string[];
};

export type ConfigApplyResult = ConfigApplyPlan & {
  version: 1;
  environment: string;
  dryRun: boolean;
  results?: {
    created: string[];
    updated: string[];
    deleted: string[];
    agents: { name: string; id: string; privateKey: string | null }[];
    webhookSecrets: { url: string; secret: string }[];
  };
};

type AgentRef = { id: string; name: string; agentType: string };
type LoadedGrant = Grant & { agent: AgentRef & { status: string }; credential: GrantCredentialRef };

type AgentCreate = {
  key: string;
  name: string;
  input: Parameters<typeof registerAgentService>[1];
};

type AgentUpdate = {
  key: string;
  agent: Agent;
  input: Parameters<typeof updateAgentConfigService>[2];
  changes: string[];
};

type GrantCreate = {
  key: string;
  agentName: string;
  agentRef: AgentRef | null;
  credential: Credential;
  input: Omit<CreateGrantInput, "agent" | "credential">;
};

type GrantUpdate = {
  key: string;
  grant: GrantWithRefs;
  input: Parameters<typeof updateGrantService>[2];
  changes: string[];
};

type PolicyCreate = {
  key: string;
  agentName: string | null;
  agentRefId: string | null;
  input: Parameters<typeof createApprovalPolicyService>[1];
};

type PolicyUpdate = {
  key: string;
  policy: ApprovalPolicy;
  input: Parameters<typeof updateApprovalPolicyService>[2];
  changes: string[];
};

type WebhookCreate = {
  key: string;
  input: { url: string; events: string[] };
};

type WebhookUpdate = {
  key: string;
  endpoint: WebhookEndpoint;
  input: Parameters<typeof updateWebhookService>[2];
  changes: string[];
};

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const value = key(row);
    const bucket = map.get(value);
    if (bucket) bucket.push(row);
    else map.set(value, [row]);
  }
  return map;
}

function one<T>(matches: T[] | undefined, kind: string, name: string): T | undefined {
  if (!matches?.length) return undefined;
  if (matches.length > 1) {
    throw new ApiError(
      409,
      "ambiguous_name",
      `More than one ${kind} matches “${name}”. Rename the records so the configuration key is unique.`,
    );
  }
  return matches[0];
}

function grantKey(agent: string, connection: string) {
  return `grant:${agent}→${connection}`;
}

function policyKey(agent: string | null, pattern: string) {
  return `approval_policy:${agent ?? "*"}:${pattern}`;
}

export async function applyConfig(
  actor: ConfigApplyActor,
  raw: unknown,
  options: { dryRun: boolean; prune: boolean },
): Promise<ConfigApplyResult> {
  const config: ConfigV1 = normalizeConfig(raw);
  if (config.environment && config.environment.toLowerCase() !== (actor.isProduction ? "production" : "development")) {
    throw new ApiError(
      422,
      "environment_mismatch",
      `This config targets “${config.environment}”, but the API key belongs to a ${actor.isProduction ? "production" : "development"} environment.`,
    );
  }
  if (options.prune && actor.isProduction && !actor.confirmPrune) {
    throw new ApiError(
      400,
      "confirmation_required",
      "Pruning in a production environment requires the x-authab-confirm: prune header.",
    );
  }

  const environmentId = actor.environmentId;
  const [agents, credentials, grants, policies, endpoints] = await Promise.all([
    db.agent.findMany({ where: { environmentId }, orderBy: { createdAt: "asc" } }),
    db.credential.findMany({ where: { environmentId, endUserId: null }, orderBy: { createdAt: "asc" } }),
    db.grant.findMany({
      where: { environmentId, endUserId: null },
      include: {
        agent: { select: { id: true, name: true, agentType: true, status: true } },
        credential: { select: { id: true, name: true, connectorSlug: true, status: true, revokedAt: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
    db.approvalPolicy.findMany({ where: { environmentId }, orderBy: { createdAt: "asc" } }),
    db.webhookEndpoint.findMany({ where: { environmentId }, orderBy: { createdAt: "asc" } }),
  ]);

  const warnings: string[] = [];
  const agentsByName = groupBy(agents, (agent) => agent.name);
  const credentialsByName = groupBy(credentials, (credential) => credential.name);
  const grantsByPair = groupBy(grants as LoadedGrant[], (grant) => `${grant.agentId}:${grant.credentialId}`);
  const policiesByKey = groupBy(policies, (policy) => `${policy.agentId ?? ""}|${policy.actionPattern}`);
  const endpointsByUrl = groupBy(endpoints, (endpoint) => endpoint.url);

  const agentCreates: AgentCreate[] = [];
  const agentUpdates: AgentUpdate[] = [];
  const declaredAgentNames = new Set<string>();

  for (const item of config.agents) {
    if (declaredAgentNames.has(item.name)) {
      throw new ApiError(422, "duplicate_agent", `Agent “${item.name}” is declared more than once.`);
    }
    declaredAgentNames.add(item.name);
    const existing = one(agentsByName.get(item.name), "agent", item.name);
    if (!existing) {
      agentCreates.push({
        key: `agent:${item.name}`,
        name: item.name,
        input: {
          name: item.name,
          type: item.type,
          description: item.description,
          tags: item.tags,
          autonomousMode: item.autonomousMode,
        },
      });
      continue;
    }

    if (existing.status === "revoked") {
      warnings.push(`Agent “${item.name}” is revoked. Applying the config does not reactivate it.`);
    }
    const changes = agentConfigChanges(existing, {
      type: item.type,
      description: item.description,
      tags: item.tags,
      autonomousMode: item.autonomousMode,
    });
    if (changes.length) {
      agentUpdates.push({
        key: `agent:${item.name}`,
        agent: existing,
        input: {
          type: item.type ?? "other",
          description: item.description ?? null,
          tags: item.tags ?? [],
          autonomousMode: item.autonomousMode === true,
        },
        changes,
      });
    }
  }

  if (agentCreates.length) {
    if (actor.isProduction) {
      const access = productionAccess(actor.plan, actor.planStatus);
      if (!access.allowed) throw new ApiError(402, "plan_required", access.message);
    }
    const quota = await checkPlanLimit(actor.organizationId, "agents", actor.plan, actor.planStatus);
    if (quota.limit >= 0 && quota.used + agentCreates.length > quota.limit) {
      throw new ApiError(
        402,
        "plan_limit_reached",
        `This apply would create ${agentCreates.length} agent(s) and exceed the ${quota.limit}-agent limit on the ${quota.plan} plan.`,
        { used: quota.used, limit: quota.limit, plan: quota.plan },
      );
    }
  }

  const declaredConnections = new Map<string, Credential>();
  for (const item of config.connections) {
    if (declaredConnections.has(item.name)) {
      throw new ApiError(422, "duplicate_connection", `Connection “${item.name}” is declared more than once.`);
    }
    const matches = (credentialsByName.get(item.name) ?? []).filter(
      (credential) => credential.connectorSlug === item.connector,
    );
    if (!matches.length) {
      throw new ApiError(
        422,
        "unknown_connection",
        `Connection “${item.name}” for ${item.connector} does not exist. Connections need secrets, so create it in the vault first.`,
      );
    }
    const credential = one(matches, "connection", `${item.connector}/${item.name}`)!;
    if (credential.revokedAt || credential.status === "revoked") {
      throw new ApiError(409, "credential_revoked", `Connection “${item.name}” is revoked. Rotate it before applying grants.`);
    }
    if (item.type && item.type !== credential.type) {
      warnings.push(`Connection “${item.name}” has type ${credential.type}; apply does not change connection types.`);
    }
    declaredConnections.set(item.name, credential);
  }

  function resolveAgentForReference(name: string): { ref: AgentRef | null; created: boolean } {
    if (declaredAgentNames.has(name)) {
      const existing = one(agentsByName.get(name), "agent", name);
      return { ref: existing ? { id: existing.id, name: existing.name, agentType: existing.agentType } : null, created: !existing };
    }
    const existing = one(agentsByName.get(name), "agent", name);
    if (!existing) {
      throw new ApiError(
        422,
        "unknown_agent",
        `Agent “${name}” does not exist and is not declared in this config. Declare it under agents first.`,
      );
    }
    return { ref: { id: existing.id, name: existing.name, agentType: existing.agentType }, created: false };
  }

  function resolveConnection(name: string): Credential {
    const matches = credentialsByName.get(name) ?? [];
    if (!matches.length) {
      throw new ApiError(
        422,
        "unknown_connection",
        `Connection “${name}” does not exist. Connections need secrets, so create it in the vault first.`,
      );
    }
    if (matches.length > 1) {
      const declared = config.connections.filter((connection) => connection.name === name);
      if (declared.length === 1) {
        const match = matches.find((credential) => credential.connectorSlug === declared[0].connector);
        if (match) return match;
      }
      throw new ApiError(
        409,
        "ambiguous_name",
        `More than one connection is named “${name}”. Declare the connection with its connector so the key is unique.`,
      );
    }
    return matches[0];
  }

  const grantCreates: GrantCreate[] = [];
  const grantUpdates: GrantUpdate[] = [];
  const representedGrantIds = new Set<string>();
  const declaredGrantKeys = new Set<string>();

  for (const item of config.grants) {
    const key = grantKey(item.agent, item.connection);
    if (declaredGrantKeys.has(key)) {
      throw new ApiError(422, "duplicate_grant", `Grant ${key} is declared more than once.`);
    }
    declaredGrantKeys.add(key);

    const { ref } = resolveAgentForReference(item.agent);
    const credential = resolveConnection(item.connection);
    if (credential.revokedAt || credential.status === "revoked") {
      throw new ApiError(409, "credential_revoked", `Connection “${item.connection}” is revoked. Rotate it before granting access.`);
    }
    const actions = normalizeActions(item.actions);
    const validation = await validateActions(credential.connectorSlug, actions, environmentId);
    if (!validation.ok) throw new ApiError(422, "invalid_actions", validation.error);
    const approvalMode = item.approvalMode ?? null;
    if (approvalMode && !(APPROVAL_MODES as readonly string[]).includes(approvalMode)) {
      throw new ApiError(422, "invalid_approval_mode", "approvalMode must be allow, require_approval or deny.");
    }
    const conditions = item.conditions ?? {};
    const expiresAt = item.expiresAt ? new Date(item.expiresAt) : null;
    const resource = item.resource?.trim() || "*";

    const existing = ref ? one(grantsByPair.get(`${ref.id}:${credential.id}`), "grant", key) : undefined;
    if (!existing) {
      grantCreates.push({
        key,
        agentName: item.agent,
        agentRef: ref,
        credential,
        input: {
          actions,
          resourcePattern: resource,
          conditions,
          approvalMode,
          expiresAt,
        },
      });
      continue;
    }

    representedGrantIds.add(existing.id);
    const changes = grantConfigChanges(existing, { actions, resource, conditions, approvalMode, expiresAt });
    if (!changes.length) continue;

    grantUpdates.push({
      key,
      grant: existing as GrantWithRefs,
      input: {
        ...(changes.includes("actions") ? { actions } : {}),
        ...(changes.includes("resource") ? { resourcePattern: resource } : {}),
        ...(changes.includes("conditions") ? { conditions } : {}),
        ...(changes.includes("approvalMode") ? { approvalMode } : {}),
        ...(changes.includes("expiresAt") ? { expiresAt } : {}),
      },
      changes,
    });
  }

  const policyCreates: PolicyCreate[] = [];
  const policyUpdates: PolicyUpdate[] = [];
  const representedPolicyIds = new Set<string>();
  const declaredPolicyKeys = new Set<string>();

  for (const item of config.approvalPolicies) {
    const key = policyKey(item.agent, item.actionPattern);
    if (declaredPolicyKeys.has(key)) {
      throw new ApiError(422, "duplicate_policy", `Approval policy ${key} is declared more than once.`);
    }
    declaredPolicyKeys.add(key);

    if (!(POLICY_MODES as readonly string[]).includes(item.mode)) {
      throw new ApiError(422, "invalid_mode", "mode must be allow, require_approval or deny.");
    }
    const slaMinutes = normalizeSla(item.slaMinutes);
    const escalateToRole = normalizeEscalationRole(item.escalateToRole);
    let agentId: string | null = null;
    if (item.agent) {
      const { ref } = resolveAgentForReference(item.agent);
      agentId = ref?.id ?? null;
      if (!ref && !declaredAgentNames.has(item.agent)) {
        throw new ApiError(422, "unknown_agent", `Agent “${item.agent}” does not exist and is not declared in this config.`);
      }
    }

    const existing = agentId ? one(policiesByKey.get(`${agentId}|${item.actionPattern}`), "approval policy", key) : one(
      policiesByKey.get(`|${item.actionPattern}`),
      "approval policy",
      key,
    );
    if (!existing) {
      policyCreates.push({
        key,
        agentName: item.agent,
        agentRefId: agentId,
        input: {
          agentId,
          actionPattern: item.actionPattern,
          mode: item.mode,
          slaMinutes,
          escalateToRole,
        },
      });
      continue;
    }

    representedPolicyIds.add(existing.id);
    const changes = approvalPolicyConfigChanges(existing, {
      mode: item.mode,
      slaMinutes: slaMinutes ?? null,
      escalateToRole: escalateToRole ?? null,
    });
    if (!changes.length) continue;

    policyUpdates.push({
      key,
      policy: existing,
      input: {
        ...(changes.includes("mode") ? { mode: item.mode } : {}),
        ...(changes.includes("slaMinutes") ? { slaMinutes } : {}),
        ...(changes.includes("escalateToRole") ? { escalateToRole } : {}),
      },
      changes,
    });
  }

  const webhookCreates: WebhookCreate[] = [];
  const webhookUpdates: WebhookUpdate[] = [];
  const representedWebhookIds = new Set<string>();
  const declaredWebhookUrls = new Set<string>();

  for (const item of config.webhooks) {
    // An existing endpoint was validated when it was created. Re-resolving its
    // host on every apply would block reconciliation while DNS is unavailable
    // (and delivery resolves the host again anyway); only new URLs are checked.
    const existing = one(endpointsByUrl.get(String(item.url || "").trim()), "webhook", item.url);
    const url = existing ? existing.url : await safeWebhookUrl(item.url);
    if (declaredWebhookUrls.has(url)) {
      throw new ApiError(422, "duplicate_webhook", `Webhook “${url}” is declared more than once.`);
    }
    declaredWebhookUrls.add(url);
    const events = normalizeWebhookEvents(item.events);
    if (!existing) {
      webhookCreates.push({ key: `webhook:${url}`, input: { url, events } });
      continue;
    }

    representedWebhookIds.add(existing.id);
    const changes = webhookConfigChanges(existing.eventsJson, events);
    if (changes.length) {
      webhookUpdates.push({
        key: `webhook:${url}`,
        endpoint: existing,
        input: { events },
        changes,
      });
    }
  }

  const grantDeletes: LoadedGrant[] = [];
  const policyDeletes: ApprovalPolicy[] = [];
  const webhookDeletes: WebhookEndpoint[] = [];
  if (options.prune) {
    for (const grant of grants as LoadedGrant[]) {
      if (!representedGrantIds.has(grant.id)) grantDeletes.push(grant);
    }
    for (const policy of policies) {
      if (!representedPolicyIds.has(policy.id)) policyDeletes.push(policy);
    }
    for (const endpoint of endpoints) {
      if (!representedWebhookIds.has(endpoint.id)) webhookDeletes.push(endpoint);
    }
  } else {
    const extraGrants = grants.filter((grant) => !representedGrantIds.has(grant.id)).length;
    const extraPolicies = policies.filter((policy) => !representedPolicyIds.has(policy.id)).length;
    const extraWebhooks = endpoints.filter((endpoint) => !representedWebhookIds.has(endpoint.id)).length;
    if (extraGrants) warnings.push(`${extraGrants} grant(s) exist outside this config. Apply with prune to delete them.`);
    if (extraPolicies) warnings.push(`${extraPolicies} approval policy/policies exist outside this config. Apply with prune to delete them.`);
    if (extraWebhooks) warnings.push(`${extraWebhooks} webhook(s) exist outside this config. Apply with prune to delete them.`);
  }

  const create = [
    ...agentCreates.map((item) => item.key),
    ...grantCreates.map((item) => item.key),
    ...policyCreates.map((item) => item.key),
    ...webhookCreates.map((item) => item.key),
  ];
  const update: ConfigChange[] = [
    ...agentUpdates.map((item) => ({ key: item.key, changes: item.changes })),
    ...grantUpdates.map((item) => ({ key: item.key, changes: item.changes })),
    ...policyUpdates.map((item) => ({ key: item.key, changes: item.changes })),
    ...webhookUpdates.map((item) => ({ key: item.key, changes: item.changes })),
  ];
  const remove = [
    ...grantDeletes.map((grant) => grantKey(grant.agent.name, grant.credential.name)),
    ...policyDeletes.map((policy) => policyKey(policy.agentId ? agents.find((agent) => agent.id === policy.agentId)?.name ?? policy.agentId : null, policy.actionPattern)),
    ...webhookDeletes.map((endpoint) => `webhook:${endpoint.url}`),
  ];

  if (agentCreates.length) {
    warnings.push("Agent private keys created by apply are returned once in results. Store them before closing the response.");
  }
  if (webhookCreates.length) {
    warnings.push("Webhook signing secrets created by apply are returned once in results.");
  }

  const plan: ConfigApplyPlan = { create, update, delete: remove, warnings };
  const result: ConfigApplyResult = {
    version: 1,
    environment: actor.isProduction ? "production" : "development",
    dryRun: options.dryRun,
    ...plan,
  };
  if (options.dryRun) return result;

  const execution = await db.$transaction(
    async (tx) => {
      const runtimeAgentIds = new Map<string, string>();
      const createdAgents: { name: string; id: string; privateKey: string | null }[] = [];

      for (const item of agentUpdates) {
        await updateAgentConfigService(actor, item.agent, item.input, tx);
        runtimeAgentIds.set(item.agent.name, item.agent.id);
      }
      for (const item of agentCreates) {
        const created = await registerAgentService(actor, item.input, tx);
        runtimeAgentIds.set(item.name, created.agent.id);
        createdAgents.push({ name: item.name, id: created.agent.id, privateKey: created.privateKey });
      }
      for (const agent of agents) {
        if (!runtimeAgentIds.has(agent.name)) runtimeAgentIds.set(agent.name, agent.id);
      }

      for (const item of grantUpdates) {
        await updateGrantService(actor, item.grant, item.input, tx);
      }
      for (const item of grantCreates) {
        const agentId = item.agentRef?.id ?? runtimeAgentIds.get(item.agentName);
        if (!agentId) {
          throw new ApiError(500, "agent_resolution_failed", `Agent “${item.agentName}” could not be resolved during apply.`);
        }
        await createGrantService(
          actor,
          {
            agent: { id: agentId, name: item.agentName, agentType: item.agentRef?.agentType ?? "other" },
            credential: item.credential,
            ...item.input,
          },
          tx,
        );
      }

      for (const item of policyUpdates) {
        await updateApprovalPolicyService(actor, item.policy, item.input, tx);
      }
      for (const item of policyCreates) {
        const agentId = item.agentRefId ?? (item.agentName ? runtimeAgentIds.get(item.agentName) ?? null : null);
        if (item.agentName && !agentId) {
          throw new ApiError(500, "agent_resolution_failed", `Agent “${item.agentName}” could not be resolved during apply.`);
        }
        await createApprovalPolicyService(actor, { ...item.input, agentId }, tx);
      }

      for (const item of webhookUpdates) {
        await updateWebhookService(actor, item.endpoint, item.input, tx);
      }
      const webhookSecrets: { url: string; secret: string }[] = [];
      for (const item of webhookCreates) {
        const created = await createWebhookService(actor, item.input, tx);
        webhookSecrets.push({ url: created.endpoint.url, secret: created.secret });
      }

      for (const grant of grantDeletes) {
        await deleteGrantService(actor, grant, tx);
      }
      for (const policy of policyDeletes) {
        await deleteApprovalPolicyService(actor, policy, tx);
      }
      for (const endpoint of webhookDeletes) {
        await deleteWebhookService(actor, endpoint, tx);
      }

      const requestId = `req_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      await auditEvent(
        {
          environmentId: actor.environmentId,
          actorType: "human",
          actorId: actor.actorId,
          actorName: actor.actorName,
          action: "config.applied",
          resourceType: "config",
          outcome: "recorded",
          requestId,
          ip: actor.ip,
          payloadSummary: {
            create: create.length,
            update: update.length,
            delete: remove.length,
            prune: options.prune,
          },
        },
        tx,
      );

      return { createdAgents, webhookSecrets };
    },
    { timeout: 30_000, maxWait: 10_000 },
  );

  for (const agent of execution.createdAgents) {
    await dispatchEvent(actor.environmentId, "agent.registered", {
      agentId: agent.id,
      name: agent.name,
      environment: actor.isProduction ? "production" : "development",
    });
    await issueIdentityDocumentSafe(agent.id);
  }

  result.results = {
    created: create,
    updated: update.map((entry) => entry.key),
    deleted: remove,
    agents: execution.createdAgents,
    webhookSecrets: execution.webhookSecrets,
  };
  return result;
}
