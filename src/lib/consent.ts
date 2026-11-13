import type { Agent, Consent, ConsentBranding, ConsentRequest, EndUser } from "@prisma/client";
import { db } from "./db";
import { ApiError } from "./api";
import { globMatch } from "./policy";
import { resolveConnector } from "./custom-connectors";
import type { Connector, ConnectorAction, Risk } from "./connectors";
import { randomToken, sha256 } from "./crypto";
import { signAgentToken } from "./jwt";
import { appUrl } from "./email";
import { buildPolicyEventRow } from "./policy-events";
import { auditEvent } from "./audit";
import { dispatchEvent } from "./webhooks";
import { DURATION_OPTIONS, isConsentDuration, type ConsentDuration } from "./consent-shared";

export { DURATION_LABELS, DURATION_OPTIONS, isConsentDuration, type ConsentDuration } from "./consent-shared";

export const RISK_ORDER: Risk[] = ["read", "write", "destructive", "financial", "admin"];

export const SESSION_DURATION_HOURS = 24;
export const CONSENT_TOKEN_TTL_SECONDS = 3600;
export const CONSENT_CODE_TTL_MS = 5 * 60_000;
export const CONSENT_REQUEST_DEFAULT_MINUTES = 30;
export const CONSENT_REQUEST_MAX_MINUTES = 1440;
export const CONTROL_LINK_TTL_MS = 15 * 60_000;
export const END_USER_SESSION_TTL_MS = 7 * 24 * 60 * 60_000;
export const END_USER_COOKIE = "authab_eu";
export const END_USER_LOGIN_TTL_MS = 15 * 60_000;

export function riskRank(risk: string) {
  const index = RISK_ORDER.indexOf(risk as Risk);
  return index === -1 ? RISK_ORDER.length : index;
}

export function parseStringArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.trim()).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

export function consentTokenHash(token: string) {
  return sha256(token);
}

export function consentUrl(token: string) {
  return appUrl(`/consent/${encodeURIComponent(token)}`);
}

export function controlCenterUrl(token: string) {
  return appUrl(`/me/verify/${encodeURIComponent(token)}`);
}

export function scopeConnectorSlug(scope: string) {
  const [first] = scope.split(".");
  return first?.trim() ?? "";
}

/** A scope is either "<connector>.<action glob>" or a bare action glob. */
export function scopeActionPattern(scope: string, connectorSlug: string) {
  const prefix = `${connectorSlug}.`;
  return scope.startsWith(prefix) ? scope.slice(prefix.length) : scope;
}

/**
 * Ownership rule shared with the proxy route: an end-user token only uses that
 * user's connection, and an organization token never learns an end-user
 * connection exists.
 */
export function credentialOwnershipError(
  credentialEndUserId: string | null,
  claimEndUserId: string | null,
): { status: 403; code: "credential_not_owned" } | { status: 404; code: "credential_not_found" } | null {
  if (claimEndUserId) {
    return credentialEndUserId === claimEndUserId ? null : { status: 403, code: "credential_not_owned" };
  }
  return credentialEndUserId === null ? null : { status: 404, code: "credential_not_found" };
}

export function actionsForScope(connector: Connector, scope: string): ConnectorAction[] {
  const pattern = scopeActionPattern(scope, connector.slug);
  return connector.actions.filter(
    (action) => action.name === pattern || globMatch(pattern, action.name),
  );
}

export function durationOptionsFor(maxGrantDays: number): ConsentDuration[] {
  return DURATION_OPTIONS.filter((option) =>
    option === "30d" ? maxGrantDays >= 30 : option === "until_revoked" ? maxGrantDays >= 1 : true,
  );
}

export function consentExpiry(duration: ConsentDuration, maxGrantDays: number, now = new Date()) {
  if (duration === "session") {
    return new Date(now.getTime() + Math.min(SESSION_DURATION_HOURS, maxGrantDays * 24) * 60 * 60_000);
  }
  if (duration === "30d") {
    return new Date(now.getTime() + Math.min(30, maxGrantDays) * 24 * 60 * 60_000);
  }
  return new Date(now.getTime() + Math.max(1, maxGrantDays) * 24 * 60 * 60_000);
}

export type ConsentScopePlan = {
  connector: Connector;
  actions: ConnectorAction[];
};

export type ConsentValidation = {
  agent: Agent;
  branding: ConsentBranding;
  connectors: string[];
  scopes: string[];
  matched: Map<string, ConsentScopePlan>;
  durationOptions: ConsentDuration[];
};

export function assertAllowedRedirect(uri: string, allowedUris: string[], environmentType: string) {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    throw new ApiError(422, "redirect_not_allowed", "redirectUri must be an absolute URL.");
  }
  const loopback = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]";
  const schemeAllowed = parsed.protocol === "https:" || (parsed.protocol === "http:" && loopback && environmentType === "development");
  if (!schemeAllowed) {
    throw new ApiError(
      422,
      "redirect_not_allowed",
      "redirectUri must use HTTPS, or HTTP on localhost in the development environment.",
    );
  }
  if (!allowedUris.includes(uri)) {
    throw new ApiError(422, "redirect_not_allowed", "redirectUri is not one of the project's allowed redirect URIs.");
  }
  return parsed;
}

/**
 * Validates a consent request against the project's branding, connector
 * catalogue and the environment. Every failure maps to one documented code.
 */
export async function validateConsentRequest(input: {
  environmentId: string;
  projectId: string;
  environmentType: string;
  agentId: string;
  scopes: string[];
  connectors?: string[];
  redirectUri: string;
  durationOptions?: string[];
}): Promise<ConsentValidation> {
  const agent = await db.agent.findFirst({
    where: { id: input.agentId, environmentId: input.environmentId },
  });
  if (!agent) throw new ApiError(404, "agent_not_found", "No agent with that ID exists in this environment.");
  if (agent.status !== "active") {
    throw new ApiError(409, "agent_inactive", `Agent is ${agent.status}. Resume it before requesting consent.`);
  }
  if (agent.kind === "external") {
    throw new ApiError(422, "agent_not_internal", "End-user consent can only be requested for an internal agent.");
  }

  const branding = await db.consentBranding.findUnique({ where: { projectId: input.projectId } });
  const allowedUris = parseStringArray(branding?.allowedRedirectUrisJson);
  if (!branding || !branding.productName.trim() || !allowedUris.length) {
    throw new ApiError(
      422,
      "branding_incomplete",
      "Configure the product name and at least one allowed redirect URI in Settings → Consent first.",
    );
  }

  const scopes = [...new Set(input.scopes.map((scope) => String(scope).trim()).filter(Boolean))];
  if (!scopes.length) throw new ApiError(422, "scopes_required", "List at least one action scope.");
  if (scopes.length > 50) throw new ApiError(422, "too_many_scopes", "A consent request may list at most 50 scopes.");

  const allowedScopes = parseStringArray(branding.allowedScopesJson);
  if (!allowedScopes.length) allowedScopes.push("*");
  const maxRiskRank = riskRank(branding.maxRisk);

  const matched = new Map<string, ConsentScopePlan>();
  for (const scope of scopes) {
    const slug = scopeConnectorSlug(scope);
    if (!slug) throw new ApiError(422, "scope_unknown", `“${scope}” is not a valid action scope.`);
    const connector = await resolveConnector(slug, input.environmentId);
    if (!connector) {
      throw new ApiError(422, "connector_not_found", `“${slug}” is not a connector in this environment.`);
    }
    const actions = actionsForScope(connector, scope);
    if (!actions.length) {
      throw new ApiError(
        422,
        "scope_unknown",
        `“${scope}” does not match any ${connector.name} action.`,
      );
    }
    const highest = Math.max(...actions.map((action) => riskRank(action.risk)));
    if (highest > maxRiskRank) {
      throw new ApiError(
        422,
        "scope_risk_too_high",
        `“${scope}” includes ${RISK_ORDER[highest]} actions above the project's ${branding.maxRisk} ceiling.`,
      );
    }
    const allowed = allowedScopes.some(
      (pattern) => globMatch(pattern, scope) || actions.some((action) => globMatch(pattern, action.name)),
    );
    if (!allowed) {
      throw new ApiError(422, "scope_not_allowed", `“${scope}” is not in the project's allowed scopes.`);
    }
    if (!connector.authMethods.some((method) => method.type === "oauth")) {
      throw new ApiError(
        422,
        "connector_not_oauth",
        `${connector.name} does not offer OAuth, so an end user cannot connect it at launch.`,
      );
    }
    const existing = matched.get(connector.slug);
    if (existing) {
      for (const action of actions) {
        if (!existing.actions.some((entry) => entry.name === action.name)) existing.actions.push(action);
      }
    } else {
      matched.set(connector.slug, { connector, actions });
    }
  }

  const derived = [...matched.keys()];
  const connectors = input.connectors?.length
    ? [...new Set(input.connectors.map(String).map((entry) => entry.trim()).filter(Boolean))]
    : derived;
  for (const slug of connectors) {
    if (!derived.includes(slug)) {
      throw new ApiError(422, "connector_unused", `“${slug}” has no requested scope. Add a scope for it or remove it.`);
    }
  }

  assertAllowedRedirect(input.redirectUri, allowedUris, input.environmentType);

  const allowedDurations = durationOptionsFor(branding.maxGrantDays);
  const requested = (input.durationOptions ?? []).filter(isConsentDuration);
  if ((input.durationOptions ?? []).some((entry) => !isConsentDuration(entry))) {
    throw new ApiError(422, "invalid_duration", `Durations must be one of ${DURATION_OPTIONS.join(", ")}.`);
  }
  const durationOptions = requested.length
    ? allowedDurations.filter((option) => requested.includes(option))
    : allowedDurations;
  if (!durationOptions.length) {
    throw new ApiError(422, "invalid_duration", "None of the requested durations are available for this project.");
  }

  return { agent, branding, connectors, scopes, matched, durationOptions };
}

export function upsertEndUser(projectId: string, externalUserId: string, email?: string | null) {
  const normalized = externalUserId.trim();
  if (!normalized) throw new ApiError(422, "end_user_required", "Provide endUser.externalUserId.");
  if (normalized.length > 200) throw new ApiError(422, "invalid_end_user", "externalUserId must be 200 characters or fewer.");
  return db.endUser.upsert({
    where: { projectId_externalUserId: { projectId, externalUserId: normalized } },
    create: {
      projectId,
      externalUserId: normalized,
      email: email?.trim() || null,
      lastSeenAt: new Date(),
    },
    update: {
      deletedAt: null,
      ...(email !== undefined ? { email: email?.trim() || null } : {}),
    },
  });
}

export type ConsentPageData = {
  request: ConsentRequest;
  agent: Agent;
  branding: ConsentBranding;
  endUser: EndUser;
  groups: {
    risk: Risk;
    defaultOn: boolean;
    actions: { name: string; label: string; description: string; connector: string; connectorName: string }[];
  }[];
  connectors: { slug: string; name: string; connected: boolean; account: string | null }[];
  durationOptions: ConsentDuration[];
};

export async function loadConsentPage(token: string): Promise<
  | { state: "pending"; data: ConsentPageData }
  | { state: "invalid" | "expired" | "completed" }
> {
  if (!token || token.length > 200) return { state: "invalid" };
  const request = await db.consentRequest.findUnique({ where: { tokenHash: consentTokenHash(token) } });
  if (!request) return { state: "invalid" };
  if (request.status !== "pending") return { state: "completed" };
  if (request.expiresAt < new Date()) {
    await db.consentRequest.updateMany({
      where: { id: request.id, status: "pending" },
      data: { status: "expired", completedAt: new Date() },
    });
    return { state: "expired" };
  }

  const [agent, branding, endUser] = await Promise.all([
    db.agent.findUnique({ where: { id: request.agentId } }),
    db.consentBranding.findUnique({ where: { projectId: request.projectId } }),
    request.endUserId
      ? db.endUser.findUnique({ where: { id: request.endUserId } })
      : db.endUser.findUnique({
          where: { projectId_externalUserId: { projectId: request.projectId, externalUserId: request.externalUserId } },
        }),
  ]);
  if (!agent || !branding || !endUser) return { state: "invalid" };

  const connectorSlugs = parseStringArray(request.connectorSlugsJson);
  const scopes = parseStringArray(request.scopesJson);
  const credentials = await db.credential.findMany({
    where: {
      environmentId: request.environmentId,
      endUserId: endUser.id,
      connectorSlug: { in: connectorSlugs },
      revokedAt: null,
    },
    select: { connectorSlug: true, name: true },
  });

  const groupMap = new Map<Risk, ConsentPageData["groups"][number]>();
  for (const slug of connectorSlugs) {
    const connector = await resolveConnector(slug, request.environmentId);
    if (!connector) continue;
    const seen = new Set<string>();
    for (const scope of scopes) {
      if (scopeConnectorSlug(scope) !== slug) continue;
      for (const action of actionsForScope(connector, scope)) {
        if (seen.has(action.name)) continue;
        seen.add(action.name);
        const risk = action.risk as Risk;
        let group = groupMap.get(risk);
        if (!group) {
          group = { risk, defaultOn: riskRank(risk) <= riskRank("write"), actions: [] };
          groupMap.set(risk, group);
        }
        group.actions.push({
          name: action.name,
          label: action.label,
          description: action.description,
          connector: connector.slug,
          connectorName: connector.name,
        });
      }
    }
  }
  const groups = RISK_ORDER.filter((risk) => groupMap.has(risk)).map((risk) => groupMap.get(risk)!);

  return {
    state: "pending",
    data: {
      request,
      agent,
      branding,
      endUser,
      groups,
      connectors: connectorSlugs.map((slug) => {
        const credential = credentials.find((entry) => entry.connectorSlug === slug);
        return {
          slug,
          name: slug,
          connected: Boolean(credential),
          account: credential?.name ?? null,
        };
      }),
      durationOptions: parseStringArray(request.durationOptionsJson).filter(isConsentDuration),
    },
  };
}

/**
 * Recomputes the approved action list from the stored request. The form can
 * only turn requested risk groups off; it can never add an action.
 */
export async function approvedActionsFor(
  request: ConsentRequest,
  selectedRisks: Risk[],
): Promise<{ connector: string; connectorName: string; actions: string[] }[]> {
  const selected = new Set(selectedRisks);
  const scopes = parseStringArray(request.scopesJson);
  const result: { connector: string; connectorName: string; actions: string[] }[] = [];
  for (const slug of parseStringArray(request.connectorSlugsJson)) {
    const connector = await resolveConnector(slug, request.environmentId);
    if (!connector) continue;
    const actions = new Set<string>();
    for (const scope of scopes) {
      if (scopeConnectorSlug(scope) !== slug) continue;
      for (const action of actionsForScope(connector, scope)) {
        if (selected.has(action.risk as Risk)) actions.add(action.name);
      }
    }
    if (actions.size) result.push({ connector: slug, connectorName: connector.name, actions: [...actions].sort() });
  }
  return result;
}

export type ApproveConsentInput = {
  requestId: string;
  selectedRisks: Risk[];
  duration: ConsentDuration;
  ip?: string | null;
  userAgent?: string | null;
};

/** Creates the consent, one grant per end-user connection and the one-time code. */
export async function approveConsentRequest(input: ApproveConsentInput) {
  const request = await db.consentRequest.findUnique({ where: { id: input.requestId } });
  if (!request) throw new ApiError(404, "request_not_found", "This consent request no longer exists.");
  if (request.status !== "pending" || request.expiresAt < new Date()) {
    throw new ApiError(409, "request_closed", "This consent request is no longer open.");
  }
  const allowed = parseStringArray(request.durationOptionsJson).filter(isConsentDuration);
  if (!allowed.includes(input.duration)) {
    throw new ApiError(422, "invalid_duration", "Choose one of the durations offered on the consent page.");
  }

  const approved = await approvedActionsFor(request, input.selectedRisks);
  if (!approved.length) {
    throw new ApiError(422, "no_permissions", "Keep at least one permission group to approve this request.");
  }
  const endUserId = request.endUserId;
  if (!endUserId) throw new ApiError(409, "end_user_missing", "Connect a service before approving.");
  const branding = await db.consentBranding.findUnique({ where: { projectId: request.projectId } });
  if (!branding) throw new ApiError(409, "branding_incomplete", "The project's consent branding is missing.");

  const credentials = await db.credential.findMany({
    where: {
      environmentId: request.environmentId,
      endUserId,
      connectorSlug: { in: approved.map((entry) => entry.connector) },
      revokedAt: null,
      status: { not: "revoked" },
    },
  });
  const missing = approved.filter(
    (entry) => !credentials.some((credential) => credential.connectorSlug === entry.connector),
  );
  if (missing.length) {
    throw new ApiError(
      409,
      "connector_not_connected",
      `Connect ${missing.map((entry) => entry.connectorName).join(", ")} before approving.`,
    );
  }

  const agent = await db.agent.findUnique({ where: { id: request.agentId } });
  if (!agent) throw new ApiError(404, "agent_not_found", "The requesting agent no longer exists.");
  const environment = await db.environment.findUnique({
    where: { id: request.environmentId },
    include: { project: { include: { org: true } } },
  });
  if (!environment) throw new ApiError(404, "environment_not_found", "The request environment no longer exists.");

  const now = new Date();
  const expiresAt = consentExpiry(input.duration, branding.maxGrantDays, now);
  const code = randomToken(32);
  const codeHash = sha256(code);
  const scopes = approved.flatMap((entry) => entry.actions);

  const { consent } = await db.$transaction(async (tx) => {
    const created = await tx.consent.create({
      data: {
        endUserId,
        projectId: request.projectId,
        environmentId: request.environmentId,
        agentId: request.agentId,
        scopesJson: JSON.stringify(scopes),
        consentTextVersion: String(branding.consentTextVersion),
        consentRequestId: request.id,
        expiresAt,
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
      },
    });

    const grantIds: string[] = [];
    for (const entry of approved) {
      const credential = credentials.find((row) => row.connectorSlug === entry.connector)!;
      const grant = await tx.grant.upsert({
        where: { agentId_credentialId: { agentId: agent.id, credentialId: credential.id } },
        create: {
          environmentId: request.environmentId,
          agentId: agent.id,
          credentialId: credential.id,
          actionsJson: JSON.stringify(entry.actions),
          resourcePattern: "*",
          conditionsJson: "{}",
          approvalMode: null,
          expiresAt,
          consentId: created.id,
          endUserId,
          createdBy: `enduser:${endUserId}`,
        },
        update: {
          actionsJson: JSON.stringify(entry.actions),
          resourcePattern: "*",
          conditionsJson: "{}",
          approvalMode: null,
          expiresAt,
          consentId: created.id,
          endUserId,
        },
      });
      grantIds.push(grant.id);
      await tx.permissionChange.create({
        data: {
          environmentId: request.environmentId,
          agentId: agent.id,
          credentialId: credential.id,
          actorId: `enduser:${endUserId}`,
          actorName: "End user",
          change: "Consent granted",
          beforeJson: "{}",
          afterJson: JSON.stringify({
            consentId: created.id,
            actions: entry.actions,
            expiresAt: expiresAt.toISOString(),
            connector: entry.connector,
          }),
        },
      });
      await tx.policyEvent.create({
        data: buildPolicyEventRow({
          environmentId: request.environmentId,
          organizationId: environment.project.orgId,
          agentId: agent.id,
          agentType: agent.agentType,
          subject: "grant",
          grantId: grant.id,
          connectorSlug: entry.connector,
          actions: entry.actions,
          resourcePattern: "*",
          approvalMode: null,
          conditions: {},
          changeKind: "create",
          contributes: environment.project.org.dataContributionEnabled,
        }),
      });
    }

    await tx.consent.update({ where: { id: created.id }, data: { grantIdsJson: JSON.stringify(grantIds) } });
    await tx.consentRequest.update({
      where: { id: request.id },
      data: {
        status: "approved",
        consentId: created.id,
        codeHash,
        codeExpiresAt: new Date(Date.now() + CONSENT_CODE_TTL_MS),
        completedAt: now,
      },
    });
    if (request.endUserId) {
      await tx.endUser.update({ where: { id: request.endUserId }, data: { lastSeenAt: now } }).catch(() => null);
    }
    return { consent: { ...created, grantIdsJson: JSON.stringify(grantIds) } };
  });

  const redirect = new URL(request.redirectUri);
  redirect.searchParams.set("code", code);
  if (request.state) redirect.searchParams.set("state", request.state);

  await auditEvent({
    environmentId: request.environmentId,
    actorType: "system",
    actorId: `enduser:${endUserId}`,
    actorName: "End user",
    agentId: agent.id,
    action: "consent.granted",
    resourceType: "consent",
    resourceId: consent.id,
    outcome: "recorded",
    ip: input.ip ?? null,
    payloadSummary: {
      agent: agent.name,
      endUser: { id: endUserId, externalUserId: request.externalUserId },
      scopes,
      connectors: approved.map((entry) => entry.connector),
      duration: input.duration,
      consentRequestId: request.id,
    },
  });
  await dispatchEvent(request.environmentId, "consent.granted", {
    consentId: consent.id,
    consentRequestId: request.id,
    agentId: agent.id,
    endUserId,
    externalUserId: request.externalUserId,
    scopes,
    connectors: approved.map((entry) => entry.connector),
    duration: input.duration,
    expiresAt: expiresAt.toISOString(),
  }).catch(() => null);

  return { request, consent, redirectUrl: redirect.toString(), approved };
}

export async function declineConsentRequest(requestId: string, ip?: string | null) {
  const request = await db.consentRequest.findUnique({ where: { id: requestId } });
  if (!request) throw new ApiError(404, "request_not_found", "This consent request no longer exists.");
  if (request.status !== "pending") throw new ApiError(409, "request_closed", "This consent request is no longer open.");
  await db.consentRequest.update({
    where: { id: request.id },
    data: { status: "declined", completedAt: new Date() },
  });
  await auditEvent({
    environmentId: request.environmentId,
    actorType: "system",
    actorId: request.endUserId ? `enduser:${request.endUserId}` : null,
    actorName: "End user",
    agentId: request.agentId,
    action: "consent.declined",
    resourceType: "consent_request",
    resourceId: request.id,
    outcome: "recorded",
    ip: ip ?? null,
    payloadSummary: {
      agentId: request.agentId,
      endUser: { id: request.endUserId, externalUserId: request.externalUserId },
    },
  });
  const redirect = new URL(request.redirectUri);
  redirect.searchParams.set("error", "access_denied");
  if (request.state) redirect.searchParams.set("state", request.state);
  return { request, redirectUrl: redirect.toString() };
}

export function consentIsActive(consent: Consent, now = new Date()) {
  return !consent.revokedAt && (!consent.expiresAt || consent.expiresAt > now);
}

export async function mintConsentToken(consentId: string) {
  const consent = await db.consent.findUnique({ where: { id: consentId } });
  if (!consent) throw new ApiError(404, "consent_not_found", "No consent with that ID exists.");
  if (!consentIsActive(consent)) {
    throw new ApiError(409, "consent_inactive", "This consent was revoked or expired. The end user must approve again.");
  }
  const [endUser, agent, environment] = await Promise.all([
    db.endUser.findUnique({ where: { id: consent.endUserId } }),
    db.agent.findUnique({ where: { id: consent.agentId } }),
    db.environment.findUnique({
      where: { id: consent.environmentId },
      include: { project: { include: { org: true } } },
    }),
  ]);
  if (!endUser || endUser.deletedAt) {
    throw new ApiError(409, "consent_inactive", "The end user's data was deleted. The consent can no longer be used.");
  }
  if (!agent || !environment) throw new ApiError(409, "consent_inactive", "The consent is no longer usable.");
  const scopes = parseStringArray(consent.scopesJson);
  const issued = await signAgentToken(
    {
      agentId: agent.id,
      environmentId: consent.environmentId,
      projectId: consent.projectId,
      organizationId: environment.project.orgId,
      principalId: null,
      scopes,
    },
    CONSENT_TOKEN_TTL_SECONDS,
    {
      scopeEnforced: true,
      extraClaims: {
        end_user: { id: endUser.id, ext: endUser.externalUserId },
        consent: consent.id,
      },
    },
  );
  return { issued, consent, endUser, agent, environment, scopes };
}

export type ConsentRevokeActor = { actorType: "human" | "system"; actorId?: string | null; actorName: string };

/** Revokes a consent, expires every linked grant, audits and dispatches. */
export async function revokeConsentRecord(
  consentId: string,
  actor: ConsentRevokeActor = { actorType: "system", actorName: "Authab" },
  options: { reason?: string; requestId?: string; ip?: string | null } = {},
) {
  const consent = await db.consent.findUnique({ where: { id: consentId } });
  if (!consent) throw new ApiError(404, "consent_not_found", "No consent with that ID exists.");
  const now = new Date();
  const updated = await db.$transaction(async (tx) => {
    const row = await tx.consent.update({
      where: { id: consent.id },
      data: { revokedAt: consent.revokedAt ?? now },
    });
    await tx.grant.updateMany({
      where: { consentId: consent.id, expiresAt: { gt: now } },
      data: { expiresAt: now },
    });
    return row;
  });
  const endUser = await db.endUser
    .findUnique({ where: { id: consent.endUserId }, select: { externalUserId: true } })
    .catch(() => null);
  await auditEvent({
    environmentId: consent.environmentId,
    actorType: actor.actorType,
    actorId: actor.actorId ?? null,
    actorName: actor.actorName,
    agentId: consent.agentId,
    action: "consent.revoked",
    resourceType: "consent",
    resourceId: consent.id,
    outcome: "recorded",
    requestId: options.requestId,
    ip: options.ip ?? null,
    payloadSummary: {
      agentId: consent.agentId,
      endUser: { id: consent.endUserId, externalUserId: endUser?.externalUserId ?? null },
      reason: options.reason ?? "revoked",
    },
  });
  await dispatchEvent(consent.environmentId, "consent.revoked", {
    consentId: consent.id,
    agentId: consent.agentId,
    endUserId: consent.endUserId,
    externalUserId: endUser?.externalUserId ?? null,
    reason: options.reason ?? "revoked",
    revokedAt: (consent.revokedAt ?? now).toISOString(),
  }).catch(() => null);
  return updated;
}

export async function endUserSessionFromCookie(token: string | undefined | null) {
  return endUserSessionWithUser(token);
}

/** Loads an end-user session row with its end user without relying on relations. */
export async function endUserSessionWithUser(token: string | undefined | null) {
  if (!token) return null;
  const session = await db.endUserSession.findUnique({ where: { tokenHash: sha256(token) } });
  if (!session || session.expiresAt < new Date()) return null;
  const endUser = await db.endUser.findUnique({ where: { id: session.endUserId } });
  if (!endUser || endUser.deletedAt) return null;
  return { session, endUser };
}

export function serializeConsent(consent: Consent, agentName?: string | null) {
  return {
    id: consent.id,
    agentId: consent.agentId,
    agentName: agentName ?? null,
    endUserId: consent.endUserId,
    scopes: parseStringArray(consent.scopesJson),
    grantedAt: consent.grantedAt.toISOString(),
    expiresAt: consent.expiresAt?.toISOString() ?? null,
    revokedAt: consent.revokedAt?.toISOString() ?? null,
    lastUsedAt: consent.lastUsedAt?.toISOString() ?? null,
  };
}
