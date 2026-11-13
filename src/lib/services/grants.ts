import type { Grant } from "@prisma/client";
import { ApiError } from "../api";
import { auditEvent } from "../audit";
import { validateActions } from "../grants";
import { recordPolicyEvent } from "../policy-events";
import { storeOf, type ServiceActor, type ServiceStore } from "./types";

export const APPROVAL_MODES = ["allow", "require_approval", "deny"] as const;

export type GrantAgentRef = { id: string; name: string; agentType: string };
export type GrantCredentialRef = {
  id: string;
  name: string;
  connectorSlug: string;
  status: string;
  revokedAt: Date | null;
};

export type GrantWithRefs = Grant & {
  agent: GrantAgentRef;
  credential: GrantCredentialRef;
};

export type CreateGrantInput = {
  agent: GrantAgentRef;
  credential: GrantCredentialRef;
  actions: string[];
  resourcePattern?: string;
  conditions?: Record<string, unknown>;
  approvalMode?: string | null;
  purpose?: string | null;
  expiresAt?: Date | null;
  justInTime?: boolean;
};

export async function createGrantService(
  actor: ServiceActor,
  input: CreateGrantInput,
  store?: ServiceStore,
): Promise<{ grant: Grant; requestId: string }> {
  const client = storeOf(store);
  if (input.credential.revokedAt || input.credential.status === "revoked") {
    throw new ApiError(409, "credential_revoked", "This connection was revoked. Rotate it before granting access.");
  }

  const actions = (input.actions ?? []).map((action) => String(action).trim()).filter(Boolean);
  const validation = await validateActions(input.credential.connectorSlug, actions, actor.environmentId);
  if (!validation.ok) throw new ApiError(422, "invalid_actions", validation.error);

  const approvalMode = input.approvalMode ?? null;
  if (approvalMode && !(APPROVAL_MODES as readonly string[]).includes(approvalMode)) {
    throw new ApiError(422, "invalid_approval_mode", "approvalMode must be allow, require_approval or deny.");
  }

  const existing = await client.grant.findUnique({
    where: { agentId_credentialId: { agentId: input.agent.id, credentialId: input.credential.id } },
  });
  if (existing) {
    throw new ApiError(409, "grant_exists", "A grant already links this agent to this connection. Update it instead.");
  }

  const justInTime = input.justInTime === true;
  const conditions = input.conditions ?? {};
  const grant = await client.grant.create({
    data: {
      environmentId: actor.environmentId,
      agentId: input.agent.id,
      credentialId: input.credential.id,
      actionsJson: JSON.stringify(actions),
      resourcePattern: input.resourcePattern?.trim() || "*",
      conditionsJson: JSON.stringify(conditions),
      approvalMode,
      purpose: input.purpose?.trim() || null,
      expiresAt: input.expiresAt ?? null,
      justInTime,
      activatedAt: justInTime ? null : new Date(),
      createdBy: actor.actorId,
    },
  });

  const requestId = `req_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  await client.permissionChange.create({
    data: {
      environmentId: actor.environmentId,
      agentId: input.agent.id,
      credentialId: input.credential.id,
      actorId: actor.actorId,
      actorName: actor.actorName,
      change: "Grant created",
      beforeJson: "{}",
      afterJson: JSON.stringify({ actions, resource: grant.resourcePattern, approvalMode }),
    },
  });

  await recordPolicyEvent(
    {
      environmentId: actor.environmentId,
      organizationId: actor.organizationId,
      agentId: input.agent.id,
      agentType: input.agent.agentType,
      subject: "grant",
      grantId: grant.id,
      connectorSlug: input.credential.connectorSlug,
      actions,
      resourcePattern: grant.resourcePattern,
      approvalMode,
      conditions,
      changeKind: "create",
      isSandbox: input.credential.connectorSlug === "sandbox",
    },
    store,
  );

  await auditEvent(
    {
      environmentId: actor.environmentId,
      actorType: "human",
      actorId: actor.actorId,
      actorName: actor.actorName,
      agentId: input.agent.id,
      action: "grant.created",
      resourceType: "grant",
      resourceId: grant.id,
      outcome: "recorded",
      requestId,
      ip: actor.ip,
      payloadSummary: {
        agent: input.agent.name,
        connector: input.credential.connectorSlug,
        actions,
        resource: grant.resourcePattern,
        approvalMode,
        justInTime,
      },
    },
    store,
  );

  return { grant, requestId };
}

export type UpdateGrantInput = {
  actions?: string[];
  resourcePattern?: string;
  conditions?: Record<string, unknown>;
  approvalMode?: string | null;
  purpose?: string | null;
  expiresAt?: Date | null;
  justInTime?: boolean;
  activate?: boolean;
};

export async function updateGrantService(
  actor: ServiceActor,
  grant: GrantWithRefs,
  input: UpdateGrantInput,
  store?: ServiceStore,
): Promise<{ grant: Grant; requestId: string; changed: string[] }> {
  const client = storeOf(store);
  const data: Record<string, unknown> = {};
  if (input.actions) {
    const actions = input.actions.map((action) => String(action).trim()).filter(Boolean);
    const validation = await validateActions(grant.credential.connectorSlug, actions, actor.environmentId);
    if (!validation.ok) throw new ApiError(422, "invalid_actions", validation.error);
    data.actionsJson = JSON.stringify(actions);
  }
  if (input.resourcePattern !== undefined) data.resourcePattern = input.resourcePattern.trim() || "*";
  if (input.conditions !== undefined) data.conditionsJson = JSON.stringify(input.conditions);
  if (input.purpose !== undefined) data.purpose = input.purpose?.trim() || null;
  if (input.expiresAt !== undefined) data.expiresAt = input.expiresAt;
  if (input.approvalMode !== undefined) {
    if (input.approvalMode && !(APPROVAL_MODES as readonly string[]).includes(input.approvalMode)) {
      throw new ApiError(422, "invalid_approval_mode", "approvalMode must be allow, require_approval or deny.");
    }
    data.approvalMode = input.approvalMode;
  }
  let activated = false;
  if (input.justInTime !== undefined) {
    data.justInTime = input.justInTime;
    if (input.justInTime) {
      data.activatedAt = null;
    } else if (!grant.activatedAt) {
      data.activatedAt = new Date();
    }
  }
  if (input.activate === true) {
    data.justInTime = true;
    data.activatedAt = new Date();
    if (input.expiresAt === undefined && !grant.expiresAt) {
      data.expiresAt = new Date(Date.now() + 60 * 60_000);
    }
    activated = true;
  }

  if (!Object.keys(data).length) {
    throw new ApiError(422, "no_changes", "Provide at least one field to update.");
  }

  const before = {
    actions: JSON.parse(grant.actionsJson || "[]"),
    resource: grant.resourcePattern,
    conditions: JSON.parse(grant.conditionsJson || "{}"),
    approvalMode: grant.approvalMode,
  };
  const updated = await client.grant.update({ where: { id: grant.id }, data });

  const requestId = `req_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  await client.permissionChange.create({
    data: {
      environmentId: actor.environmentId,
      agentId: grant.agentId,
      credentialId: grant.credentialId,
      actorId: actor.actorId,
      actorName: actor.actorName,
      change: "Grant updated",
      beforeJson: JSON.stringify(before),
      afterJson: JSON.stringify({
        actions: JSON.parse(updated.actionsJson || "[]"),
        resource: updated.resourcePattern,
        conditions: JSON.parse(updated.conditionsJson || "{}"),
        approvalMode: updated.approvalMode,
      }),
    },
  });

  await recordPolicyEvent(
    {
      environmentId: actor.environmentId,
      organizationId: actor.organizationId,
      agentId: grant.agentId,
      agentType: grant.agent.agentType,
      subject: "grant",
      grantId: grant.id,
      connectorSlug: grant.credential.connectorSlug,
      actions: JSON.parse(updated.actionsJson || "[]"),
      resourcePattern: updated.resourcePattern,
      approvalMode: updated.approvalMode,
      conditions: JSON.parse(updated.conditionsJson || "{}"),
      changeKind: "update",
      isSandbox: grant.credential.connectorSlug === "sandbox",
    },
    store,
  );

  await auditEvent(
    {
      environmentId: actor.environmentId,
      actorType: "human",
      actorId: actor.actorId,
      actorName: actor.actorName,
      agentId: grant.agentId,
      action: "grant.updated",
      resourceType: "grant",
      resourceId: grant.id,
      outcome: "recorded",
      requestId,
      ip: actor.ip,
      payloadSummary: { agent: grant.agent.name, connector: grant.credential.connectorSlug, changed: Object.keys(data) },
    },
    store,
  );

  if (activated) {
    await auditEvent(
      {
        environmentId: actor.environmentId,
        actorType: "human",
        actorId: actor.actorId,
        actorName: actor.actorName,
        agentId: grant.agentId,
        action: "grant.activated",
        resourceType: "grant",
        resourceId: updated.id,
        outcome: "recorded",
        requestId,
        ip: actor.ip,
        payloadSummary: {
          agent: grant.agent.name,
          connector: grant.credential.connectorSlug,
          manual: true,
          expiresAt: updated.expiresAt?.toISOString() ?? null,
        },
      },
      store,
    );
  }

  return { grant: updated, requestId, changed: Object.keys(data) };
}

export async function deleteGrantService(
  actor: ServiceActor,
  grant: GrantWithRefs,
  store?: ServiceStore,
): Promise<{ requestId: string }> {
  const client = storeOf(store);
  await client.grant.delete({ where: { id: grant.id } });

  const requestId = `req_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  await client.permissionChange.create({
    data: {
      environmentId: actor.environmentId,
      agentId: grant.agentId,
      credentialId: grant.credentialId,
      actorId: actor.actorId,
      actorName: actor.actorName,
      change: "Grant removed",
      beforeJson: JSON.stringify({
        actions: JSON.parse(grant.actionsJson || "[]"),
        resource: grant.resourcePattern,
      }),
      afterJson: "{}",
    },
  });

  await recordPolicyEvent(
    {
      environmentId: actor.environmentId,
      organizationId: actor.organizationId,
      agentId: grant.agentId,
      agentType: grant.agent.agentType,
      subject: "grant",
      grantId: grant.id,
      connectorSlug: grant.credential.connectorSlug,
      actions: JSON.parse(grant.actionsJson || "[]"),
      resourcePattern: grant.resourcePattern,
      approvalMode: grant.approvalMode,
      conditions: JSON.parse(grant.conditionsJson || "{}"),
      changeKind: "delete",
      isSandbox: grant.credential.connectorSlug === "sandbox",
    },
    store,
  );

  await auditEvent(
    {
      environmentId: actor.environmentId,
      actorType: "human",
      actorId: actor.actorId,
      actorName: actor.actorName,
      agentId: grant.agentId,
      action: "grant.deleted",
      resourceType: "grant",
      resourceId: grant.id,
      outcome: "recorded",
      requestId,
      ip: actor.ip,
      payloadSummary: { agent: grant.agent.name, connector: grant.credential.connectorSlug },
    },
    store,
  );

  return { requestId };
}
