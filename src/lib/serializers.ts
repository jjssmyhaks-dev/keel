import type {
  Agent,
  ApprovalPolicy,
  ApprovalRequest,
  Credential,
  Grant,
} from "@prisma/client";

export function serializeAgent(agent: Agent, extra?: Record<string, unknown>) {
  return {
    id: agent.id,
    object: "agent",
    name: agent.name,
    description: agent.description,
    status: agent.status,
    fingerprint: agent.fingerprint,
    publicKey: agent.publicKey,
    keyMode: agent.keyMode,
    tags: JSON.parse(agent.tagsJson || "[]"),
    framework: agent.framework,
    autonomousMode: agent.autonomousMode,
    safeLaunchUntil: agent.safeLaunchUntil?.toISOString() ?? null,
    ownerUserId: agent.ownerUserId,
    promotedFromAgentId: agent.promotedFromAgentId,
    environmentId: agent.environmentId,
    lastActiveAt: agent.lastActiveAt?.toISOString() ?? null,
    createdAt: agent.createdAt.toISOString(),
    ...extra,
  };
}

export function serializeCredential(credential: Credential, extra?: Record<string, unknown>) {
  return {
    id: credential.id,
    object: "credential",
    connector: credential.connectorSlug,
    name: credential.name,
    type: credential.type,
    maskedHint: credential.maskedHint,
    status: credential.status,
    healthDetail: credential.healthDetail,
    metadata: JSON.parse(credential.metadataJson || "{}"),
    expiresAt: credential.expiresAt?.toISOString() ?? null,
    lastUsedAt: credential.lastUsedAt?.toISOString() ?? null,
    revokedAt: credential.revokedAt?.toISOString() ?? null,
    createdAt: credential.createdAt.toISOString(),
    ...extra,
  };
}

export function serializeGrant(grant: Grant, extra?: Record<string, unknown>) {
  return {
    id: grant.id,
    object: "grant",
    agentId: grant.agentId,
    credentialId: grant.credentialId,
    actions: JSON.parse(grant.actionsJson || "[]"),
    resourcePattern: grant.resourcePattern,
    conditions: JSON.parse(grant.conditionsJson || "{}"),
    approvalMode: grant.approvalMode,
    purpose: grant.purpose,
    expiresAt: grant.expiresAt?.toISOString() ?? null,
    createdAt: grant.createdAt.toISOString(),
    ...extra,
  };
}

export function serializeApproval(request: ApprovalRequest, extra?: Record<string, unknown>) {
  return {
    id: request.id,
    object: "approval",
    agentId: request.agentId,
    credentialId: request.credentialId,
    grantId: request.grantId,
    action: request.action,
    summary: request.summary,
    payload: JSON.parse(request.redactedJson || "{}"),
    risk: request.risk,
    status: request.status,
    requestId: request.requestId,
    decisionNote: request.decisionNote,
    decidedBy: request.decidedBy,
    decidedAt: request.decidedAt?.toISOString() ?? null,
    executionResult: request.executionResult ? JSON.parse(request.executionResult) : null,
    expiresAt: request.expiresAt.toISOString(),
    createdAt: request.createdAt.toISOString(),
    ...extra,
  };
}

export function serializePolicy(policy: ApprovalPolicy) {
  return {
    id: policy.id,
    object: "approval_policy",
    agentId: policy.agentId,
    actionPattern: policy.actionPattern,
    mode: policy.mode,
    createdAt: policy.createdAt.toISOString(),
  };
}
