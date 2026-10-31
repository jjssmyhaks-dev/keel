import type { Agent, Credential, Environment } from "@prisma/client";
import { db } from "./db";
import { auditEvent } from "./audit";
import { actionFor, connector, type ConnectorAction } from "./connectors";
import { decryptSecret } from "./crypto";
import { envSettings } from "./policy";

export type ExecutionResult = {
  status: number;
  body: unknown;
  latencyMs: number;
  mock: boolean;
  request: { method: string; url: string };
};

function redact(input: Record<string, unknown>, fields: string[]) {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (fields.includes(key.toLowerCase()) || /token|secret|password|authorization/i.test(key)) {
      out[key] = "[redacted]";
    } else {
      out[key] = value;
    }
  }
  return out;
}

function safeJson(value: string) {
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function periodKey(date = new Date()) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export async function recordUsage(orgId: string, metric: string, quantity = 1) {
  const period = periodKey();
  const existing = await db.usageRecord.findFirst({ where: { orgId, metric, period } });
  if (existing) {
    await db.usageRecord.update({
      where: { id: existing.id },
      data: { quantity: existing.quantity + quantity },
    });
    return;
  }
  await db.usageRecord.create({ data: { orgId, metric, period, quantity } });
}

export async function executeAction(opts: {
  environment: Environment;
  agent: Agent;
  credential: Credential;
  action: ConnectorAction;
  input: Record<string, unknown>;
  resource?: string;
  requestId: string;
  ip?: string | null;
  approvalId?: string;
}): Promise<ExecutionResult> {
  const { environment, agent, credential, action } = opts;
  const connectorDef = connector(credential.connectorSlug)!;
  const settings = envSettings(environment);
  const started = Date.now();

  const redacted = redact(opts.input, connectorDef.redactedFields);
  const url = new URL(action.path, `https://${connectorDef.hosts[0]}`);

  let result: ExecutionResult;

  if (settings.mockMode || process.env.KEEL_PROXY_LIVE !== "1") {
    await new Promise((resolve) => setTimeout(resolve, 90 + Math.random() * 120));
    result = {
      status: 200,
      body: {
        ...(action.mock ?? { ok: true }),
        _keel: {
          mock: true,
          connector: connectorDef.slug,
          action: action.name,
          resource: opts.resource ?? null,
        },
      },
      latencyMs: Date.now() - started,
      mock: true,
      request: { method: action.method, url: url.toString() },
    };
  } else {
    const secret = (await decryptSecret(
      environment.projectId,
      credential.encryptedPayload,
      credential.dataKeyEncrypted,
    )) as Record<string, unknown>;

    let token = "";
    if (credential.type === "api_key" || credential.type === "bearer") {
      token = String(secret.apiKey ?? secret.token ?? secret.accessToken ?? "");
    } else if (credential.type === "oauth") {
      token = String(secret.accessToken ?? "");
    }
    if (!token && credential.type !== "basic") {
      throw new Error("The stored credential has no usable secret. Rotate it in the vault.");
    }

    const headers: Record<string, string> = { Accept: "application/json" };
    if (connectorDef.injection.type === "header") {
      headers[connectorDef.injection.name] = `${connectorDef.injection.prefix ?? ""}${token}`;
    } else {
      url.searchParams.set(connectorDef.injection.name, token);
    }
    if (credential.type === "basic" && secret.username) {
      headers.Authorization = `Basic ${Buffer.from(`${secret.username}:${secret.password}`).toString("base64")}`;
    }

    const init: RequestInit = { method: action.method, headers, signal: AbortSignal.timeout(15_000) };
    if (action.method === "GET") {
      for (const [key, value] of Object.entries(opts.input)) {
        if (value !== undefined && value !== null && typeof value !== "object") {
          url.searchParams.set(key, String(value));
        }
      }
    } else {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(opts.input);
    }

    try {
      const response = await fetch(url, init);
      const text = await response.text();
      let body: unknown = text;
      try {
        body = JSON.parse(text);
      } catch {}
      result = {
        status: response.status,
        body,
        latencyMs: Date.now() - started,
        mock: false,
        request: { method: action.method, url: url.toString() },
      };
    } catch (error) {
      await auditEvent({
        environmentId: environment.id,
        actorType: "agent",
        actorId: agent.id,
        actorName: agent.name,
        agentId: agent.id,
        action: "proxy.call",
        resourceType: "connector",
        resourceId: connectorDef.slug,
        outcome: "error",
        requestId: opts.requestId,
        ip: opts.ip,
        payloadSummary: {
          action: action.name,
          resource: opts.resource,
          error: error instanceof Error ? error.message : "upstream_failure",
          input: redacted,
        },
      });
      throw new Error(
        `Upstream call to ${connectorDef.name} failed: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      );
    }
  }

  await db.credential.update({ where: { id: credential.id }, data: { lastUsedAt: new Date() } }).catch(() => null);
  await db.agent.update({ where: { id: agent.id }, data: { lastActiveAt: new Date() } }).catch(() => null);
  const project = await db.project.findUnique({
    where: { id: environment.projectId },
    select: { orgId: true },
  });
  await recordUsage(project?.orgId ?? "", "proxy_calls");

  await auditEvent({
    environmentId: environment.id,
    actorType: "agent",
    actorId: agent.id,
    actorName: agent.name,
    agentId: agent.id,
    action: "proxy.call",
    resourceType: "connector",
    resourceId: connectorDef.slug,
    outcome: result.status < 400 ? "allowed" : "error",
    requestId: opts.requestId,
    ip: opts.ip,
    payloadSummary: {
      action: action.name,
      resource: opts.resource,
      status: result.status,
      latencyMs: result.latencyMs,
      mock: result.mock,
      approvalId: opts.approvalId,
      input: redacted,
    },
  });

  return result;
}

export { redact, safeJson };
