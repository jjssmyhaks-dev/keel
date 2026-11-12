import type {
  Agent,
  AgentClientSecret,
  ApprovalPolicy,
  ApprovalRequest,
  Credential,
  Grant,
  WorkloadIdentity,
} from "@prisma/client";

export function serializeAgent(agent: Agent, extra?: Record<string, unknown>) {
  return {
    id: agent.id,
    object: "agent",
    name: agent.name,
    description: agent.description,
    status: agent.status,
    type: agent.agentType,
    verificationVisibility: agent.verificationVisibility,
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
    tokenExpiresAt: credential.tokenExpiresAt?.toISOString() ?? null,
    refreshable: credential.refreshable,
    scopes: JSON.parse(credential.oauthScopes || "[]"),
    lastHealthCheckAt: credential.lastHealthCheckAt?.toISOString() ?? null,
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
    justInTime: grant.justInTime,
    activatedAt: grant.activatedAt?.toISOString() ?? null,
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
    kind: request.kind,
    grantSpec: JSON.parse(request.grantSpecJson || "{}"),
    slaDueAt: request.slaDueAt?.toISOString() ?? null,
    escalatedAt: request.escalatedAt?.toISOString() ?? null,
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
    slaMinutes: policy.slaMinutes,
    escalateToRole: policy.escalateToRole,
    createdAt: policy.createdAt.toISOString(),
  };
}

export function serializeClientSecret(secret: AgentClientSecret) {
  return {
    id: secret.id,
    object: "client_secret",
    agentId: secret.agentId,
    label: secret.label,
    prefix: secret.prefix,
    scopes: JSON.parse(secret.scopesJson || "[]"),
    lastUsedAt: secret.lastUsedAt?.toISOString() ?? null,
    expiresAt: secret.expiresAt?.toISOString() ?? null,
    revokedAt: secret.revokedAt?.toISOString() ?? null,
    createdAt: secret.createdAt.toISOString(),
  };
}

export function serializeWorkloadIdentity(identity: WorkloadIdentity) {
  return {
    id: identity.id,
    object: "workload_identity",
    name: identity.name,
    type: identity.type,
    issuer: identity.issuer,
    audience: identity.audience,
    jwksUrl: identity.jwksUrl,
    jwks: identity.jwksJson ? JSON.parse(identity.jwksJson || "{}") : null,
    agentId: identity.agentId,
    subjectPattern: identity.subjectPattern,
    requiredClaims: JSON.parse(identity.requiredClaimsJson || "{}"),
    tokenTtlSeconds: identity.tokenTtlSeconds,
    enabled: identity.enabled,
    createdAt: identity.createdAt.toISOString(),
  };
}
