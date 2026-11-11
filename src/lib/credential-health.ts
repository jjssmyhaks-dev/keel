import type { Credential, Environment } from "@prisma/client";
import { db } from "./db";
import { auditEvent } from "./audit";
import { type Connector, type ConnectorAction } from "./connectors";
import { resolveConnector } from "./custom-connectors";
import { healthProbeFor } from "./health-checks";
import { envSettings } from "./policy";
import { executeAction } from "./proxy";
import { refreshCredentialToken, markCredentialBroken } from "./oauth-connect";

const DEFAULT_INTERVAL_HOURS = 24;
const REFRESH_AHEAD_MS = 10 * 60_000;

export type HealthOutcome = "ok" | "broken" | "warn" | "skipped";

export type HealthCheckResult = {
  credentialId: string;
  connector: string;
  outcome: HealthOutcome;
  detail: string;
  status?: number;
};

function probeAction(connectorDef: Connector): ConnectorAction | null {
  const probe = connectorDef.healthCheck ?? healthProbeFor(connectorDef.slug);
  if (!probe) return null;
  return {
    name: `${connectorDef.slug}.health_check`,
    label: "Credential health check",
    description: "Read-only probe that proves the stored credential still works.",
    method: probe.method,
    path: probe.path,
    risk: "read",
    host: probe.host,
    bodyFormat: "json",
    fields: [],
    sample: { ok: true },
  };
}

async function noteWarn(credential: Credential, detail: string) {
  await db.credential
    .update({
      where: { id: credential.id },
      data: {
        lastHealthCheckAt: new Date(),
        healthEvents: { create: { result: "warn", detail } },
      },
    })
    .catch(() => null);
}

async function noteHealthy(credential: Credential, detail: string) {
  const healed = credential.status === "broken";
  await db.credential
    .update({
      where: { id: credential.id },
      data: {
        status: "healthy",
        healthDetail: null,
        lastHealthCheckAt: new Date(),
        healthEvents: { create: { result: "ok", detail } },
      },
    })
    .catch(() => null);
  if (healed) {
    await auditEvent({
      environmentId: credential.environmentId,
      actorType: "system",
      actorName: "Credential health check",
      action: "credential.recovered",
      resourceType: "credential",
      resourceId: credential.id,
      outcome: "recorded",
      payloadSummary: { connector: credential.connectorSlug },
    }).catch(() => null);
  }
}

async function noteBroken(credential: Credential, detail: string, reason: string) {
  if (credential.status === "broken") {
    await db.credential
      .update({
        where: { id: credential.id },
        data: {
          lastHealthCheckAt: new Date(),
          healthDetail: detail,
          healthEvents: { create: { result: "error", detail } },
        },
      })
      .catch(() => null);
    return;
  }
  await markCredentialBroken(credential, detail, reason);
  await db.credential
    .update({ where: { id: credential.id }, data: { lastHealthCheckAt: new Date() } })
    .catch(() => null);
}

/**
 * Runs a real read-only provider probe for one credential. Outcomes:
 * - ok: the provider authenticated the credential
 * - broken: the provider rejected the credential (401/403 or provider auth error)
 * - warn: network/5xx/other failure that does not prove the credential is dead
 * - skipped: the connector has no safe probe
 */
export async function checkCredentialHealth(credentialId: string): Promise<HealthCheckResult> {
  const credential = await db.credential.findUnique({ where: { id: credentialId } });
  if (!credential) throw new Error("Credential not found.");
  if (credential.revokedAt || credential.status === "revoked") {
    return {
      credentialId,
      connector: credential.connectorSlug,
      outcome: "skipped",
      detail: "Revoked credentials are not probed.",
    };
  }
  return runProbe(credential);
}

async function runProbe(credential: Credential): Promise<HealthCheckResult> {
  const connectorDef = await resolveConnector(credential.connectorSlug, credential.environmentId);
  if (!connectorDef) {
    return {
      credentialId: credential.id,
      connector: credential.connectorSlug,
      outcome: "skipped",
      detail: "No connector definition to probe.",
    };
  }
  const action = probeAction(connectorDef);
  if (!action) {
    return {
      credentialId: credential.id,
      connector: credential.connectorSlug,
      outcome: "skipped",
      detail: `No safe read-only probe is defined for ${connectorDef.name}. Use a real call to verify it.`,
    };
  }
  const environment = await db.environment.findUnique({ where: { id: credential.environmentId } });
  if (!environment) {
    return {
      credentialId: credential.id,
      connector: credential.connectorSlug,
      outcome: "skipped",
      detail: "Environment not found.",
    };
  }

  const probe = connectorDef.healthCheck ?? healthProbeFor(connectorDef.slug)!;
  try {
    const result = await executeAction({
      environment,
      agent: null,
      credential,
      connectorDef,
      action,
      input: probe.body ?? {},
      requestId: `health_${credential.id}_${Date.now().toString(36)}`,
      healthCheck: true,
      skipHealthNote: true,
      countUsage: false,
    });
    const providerError = providerAuthFailureFor(connectorDef.slug, result.body);
    if (result.status === 401 || result.status === 403 || providerError) {
      const detail = providerError
        ? `Health probe was rejected by ${connectorDef.name} (${providerError}). Reconnect this credential.`
        : `Health probe was rejected by ${connectorDef.name} (HTTP ${result.status}). Reconnect this credential.`;
      await noteBroken(credential, detail, providerError ?? `http_${result.status}`);
      return {
        credentialId: credential.id,
        connector: credential.connectorSlug,
        outcome: "broken",
        detail,
        status: result.status,
      };
    }
    if (result.status >= 200 && result.status < 300) {
      const detail = `Health probe ${action.method} ${action.path} returned ${result.status}.`;
      await noteHealthy(credential, detail);
      return {
        credentialId: credential.id,
        connector: credential.connectorSlug,
        outcome: "ok",
        detail,
        status: result.status,
      };
    }
    const detail = `Health probe ${action.method} ${action.path} returned HTTP ${result.status}. The credential was not marked broken.`;
    await noteWarn(credential, detail);
    return {
      credentialId: credential.id,
      connector: credential.connectorSlug,
      outcome: "warn",
      detail,
      status: result.status,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Probe failed.";
    const detail = `Health probe failed: ${message}`;
    await noteWarn(credential, detail);
    return {
      credentialId: credential.id,
      connector: credential.connectorSlug,
      outcome: "warn",
      detail,
    };
  }
}

function providerAuthFailureFor(connectorSlug: string, body: unknown) {
  if (connectorSlug !== "slack") return null;
  if (!body || typeof body !== "object") return null;
  const payload = body as { ok?: unknown; error?: unknown };
  if (payload.ok !== false || typeof payload.error !== "string") return null;
  return ["invalid_auth", "not_authed", "token_revoked", "token_expired", "account_inactive"].includes(payload.error)
    ? payload.error
    : null;
}

function intervalHours(environment: Pick<Environment, "settingsJson">) {
  const settings = envSettings(environment) as { healthCheckIntervalHours?: unknown };
  const value = Number(settings.healthCheckIntervalHours);
  if (!Number.isFinite(value)) return DEFAULT_INTERVAL_HOURS;
  return Math.min(Math.max(value, 0), 24 * 30);
}

function dueForCheck(credential: Credential, environment: Pick<Environment, "settingsJson">, force?: boolean) {
  if (force) return true;
  const hours = intervalHours(environment);
  if (hours <= 0) return false;
  if (!credential.lastHealthCheckAt) return true;
  return Date.now() - credential.lastHealthCheckAt.getTime() >= hours * 3_600_000;
}

export type HealthSweepSummary = {
  checked: number;
  healthy: number;
  broken: number;
  warnings: number;
  skipped: number;
  results: HealthCheckResult[];
};

export async function runHealthChecks(opts?: {
  environmentId?: string;
  force?: boolean;
  limit?: number;
}): Promise<HealthSweepSummary> {
  const credentials = await db.credential.findMany({
    where: {
      ...(opts?.environmentId ? { environmentId: opts.environmentId } : {}),
      revokedAt: null,
      status: { not: "revoked" },
    },
    include: { environment: true },
    orderBy: [{ lastHealthCheckAt: "asc" }, { createdAt: "asc" }],
    take: Math.min(Math.max(opts?.limit ?? 100, 1), 500),
  });

  const summary: HealthSweepSummary = {
    checked: 0,
    healthy: 0,
    broken: 0,
    warnings: 0,
    skipped: 0,
    results: [],
  };

  for (const credential of credentials) {
    if (!dueForCheck(credential, credential.environment, opts?.force)) continue;
    const result = await runProbe(credential);
    summary.results.push(result);
    if (result.outcome === "skipped") {
      summary.skipped += 1;
      continue;
    }
    summary.checked += 1;
    if (result.outcome === "ok") summary.healthy += 1;
    else if (result.outcome === "broken") summary.broken += 1;
    else summary.warnings += 1;
  }
  return summary;
}

/**
 * Refreshes OAuth access tokens that are about to expire so a scheduled sweep
 * (or the next proxy call) does not hit a dead token. Permanent failures mark
 * the credential broken once and notify owners through markCredentialBroken.
 */
export async function refreshExpiringOAuthTokens(limit = 25): Promise<{
  refreshed: number;
  failed: number;
}> {
  const credentials = await db.credential.findMany({
    where: {
      type: "oauth",
      refreshable: true,
      revokedAt: null,
      status: { not: "revoked" },
      tokenExpiresAt: { not: null, lte: new Date(Date.now() + REFRESH_AHEAD_MS) },
    },
    orderBy: { tokenExpiresAt: "asc" },
    take: Math.min(Math.max(limit, 1), 100),
  });
  let refreshed = 0;
  let failed = 0;
  for (const credential of credentials) {
    try {
      await refreshCredentialToken(credential.id);
      refreshed += 1;
    } catch {
      failed += 1;
    }
  }
  return { refreshed, failed };
}
