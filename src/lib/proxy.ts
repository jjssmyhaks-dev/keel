import type { Agent, Credential, Environment } from "@prisma/client";
import { createHash, createPrivateKey, createPublicKey, sign } from "crypto";
import { db } from "./db";
import { auditEvent } from "./audit";
import { actionFor, connector, type Connector, type ConnectorAction } from "./connectors";
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

export function fieldValue(source: Record<string, unknown>, key?: string | null): string {
  if (!key) return "";
  const direct = source[key];
  if (direct !== undefined && direct !== null) return String(direct);
  const camel = key.replace(/_([a-z])/g, (_, char: string) => char.toUpperCase());
  const camelValue = source[camel];
  if (camelValue !== undefined && camelValue !== null) return String(camelValue);
  return "";
}

function tokenFrom(secret: Record<string, unknown>, credential: Credential) {
  if (credential.type === "oauth") {
    return fieldValue(secret, "access_token") || fieldValue(secret, "accessToken") || fieldValue(secret, "token");
  }
  return (
    fieldValue(secret, "api_key") ||
    fieldValue(secret, "apiKey") ||
    fieldValue(secret, "token") ||
    fieldValue(secret, "access_token") ||
    fieldValue(secret, "accessToken")
  );
}

export function isBlockedHostname(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    return true;
  }
  if (host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80")) {
    return true;
  }
  if (host.startsWith("::ffff:")) return isBlockedHostname(host.slice(7));
  const parts = host.split(".");
  if (parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part))) {
    const [a, b] = parts.map(Number);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 192 && b === 0) return true;
  }
  return false;
}

export function hostAllowed(connectorDef: Connector, hostname: string) {
  const host = hostname.toLowerCase();
  if (isBlockedHostname(host)) return false;
  if (
    connectorDef.hosts.some((pattern) => {
      if (pattern === host) return true;
      if (pattern.startsWith("*.")) {
        const suffix = pattern.slice(1);
        return host.endsWith(suffix) && host !== suffix.slice(1);
      }
      return false;
    })
  ) {
    return true;
  }
  return connectorDef.allowAnyPublicHost === true;
}

function normalizeBaseUrl(raw: string) {
  const value = raw.trim();
  if (!value) throw new Error("This action needs a connection URL.");
  const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  const parsed = new URL(withScheme);
  if (parsed.protocol !== "https:") throw new Error("Only HTTPS endpoints are accepted.");
  if (isBlockedHostname(parsed.hostname)) throw new Error("Private and link-local hosts are blocked.");
  return `${parsed.origin}${parsed.pathname.replace(/\/$/, "")}`;
}

function applyPath(template: string, values: Record<string, unknown>, live: boolean) {
  return template.replace(/\{([a-z0-9_]+)\}/gi, (match, key: string) => {
    const value = fieldValue(values, key);
    if (!value) {
      if (live) throw new Error(`Missing path parameter "${key}".`);
      return match;
    }
    return encodeURIComponent(value);
  });
}

function resolveBase(connectorDef: Connector, action: ConnectorAction, values: Record<string, unknown>) {
  const field = action.baseUrlField ?? connectorDef.baseUrlField;
  if (field) return normalizeBaseUrl(fieldValue(values, field));

  if (action.host) return `https://${action.host}`;
  if (action.hostTemplate) {
    const rendered = applyPath(action.hostTemplate, values, true);
    return `https://${rendered}`;
  }
  if (connectorDef.hostTemplate) {
    const rendered = applyPath(connectorDef.hostTemplate, values, true);
    return `https://${rendered}`;
  }
  return `https://${connectorDef.hosts[0]}`;
}

function snowflakeJwt(secret: Record<string, unknown>) {
  const account = fieldValue(secret, "account_identifier").toUpperCase();
  const user = fieldValue(secret, "user").toUpperCase();
  const pem = fieldValue(secret, "private_key");
  const passphrase = fieldValue(secret, "passphrase") || undefined;
  if (!account || !user || !pem) throw new Error("Snowflake key-pair credentials are incomplete.");
  const privateKey = createPrivateKey({ key: pem, format: "pem", passphrase });
  const publicKey = createPublicKey(privateKey);
  const fingerprint = createHash("sha256")
    .update(publicKey.export({ type: "spki", format: "der" }))
    .digest("base64");
  const issuedAt = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: `${account}.${user}.SHA256:${fingerprint}`,
    sub: `${account}.${user}`,
    iat: issuedAt,
    exp: issuedAt + 3600,
  };
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const body = `${encode(header)}.${encode(payload)}`;
  const signature = sign("RSA-SHA256", Buffer.from(body), privateKey).toString("base64url");
  return `${body}.${signature}`;
}

function checkCredentialEnvironment(connectorDef: Connector, secret: Record<string, unknown>, environment: Environment) {
  if (connectorDef.slug !== "razorpay") return;
  const keyId = fieldValue(secret, "key_id");
  if (!keyId) return;
  const isTest = keyId.startsWith("rzp_test_");
  const isLive = keyId.startsWith("rzp_live_");
  if (environment.type === "development" && isLive) {
    throw new Error("A live Razorpay key cannot be used in development.");
  }
  if (environment.type !== "development" && isTest) {
    throw new Error("A Razorpay test key cannot be used in production.");
  }
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
  if (!connectorDef) throw new Error(`Unknown connector "${credential.connectorSlug}".`);
  const settings = envSettings(environment);
  const started = Date.now();
  const live = !settings.mockMode && process.env.KEEL_PROXY_LIVE === "1";

  const redacted = redact(opts.input, connectorDef.redactedFields);
  let secret: Record<string, unknown> = {};
  if (live) {
    secret = (await decryptSecret(
      environment.projectId,
      credential.encryptedPayload,
      credential.dataKeyEncrypted,
    )) as Record<string, unknown>;
    checkCredentialEnvironment(connectorDef, secret, environment);
  }

  const values = { ...secret, ...opts.input };
  const path = applyPath(action.path, values, live);
  const base = resolveBase(connectorDef, action, values).replace(/\/$/, "");
  const url = path && path !== "/" ? new URL(path, `${base}/`) : new URL(base);
  if (!hostAllowed(connectorDef, url.hostname)) {
    throw new Error(`${url.hostname} is not an allowed host for ${connectorDef.name}.`);
  }

  const usedPathKeys = new Set(
    [...action.path.matchAll(/\{([a-z0-9_]+)\}/gi)].map((match) => match[1].toLowerCase()),
  );

  let result: ExecutionResult;

  if (!live) {
    await new Promise((resolve) => setTimeout(resolve, 90 + Math.random() * 120));
    const mock = action.mock;
    const mockBody =
      mock && typeof mock === "object" && !Array.isArray(mock) ? (mock as Record<string, unknown>) : mock !== undefined ? { data: mock } : { ok: true };
    result = {
      status: 200,
      body: {
        ...mockBody,
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
    let token = action.authField ? fieldValue(secret, action.authField) : tokenFrom(secret, credential);
    if (connectorDef.authStrategy === "snowflake-jwt") token = snowflakeJwt(secret);
    const authKey = action.authField ?? connectorDef.injection.field;
    const authRequired = connectorDef.credentialFields?.find((field) => field.key === authKey)?.required;
    if (!token && !connectorDef.injection.basic && (authRequired === true || !authKey)) {
      throw new Error("The stored credential has no usable secret. Rotate it in the vault.");
    }

    const headers: Record<string, string> = { Accept: "application/json" };
    const injection = connectorDef.injection;
    if (injection.type === "header") {
      if (token) headers[injection.name] = `${injection.prefix ?? ""}${token}`;
    } else if (token) {
      url.searchParams.set(injection.name, token);
    }

    if (injection.basic) {
      const username = fieldValue(secret, injection.basic.usernameField) || fieldValue(secret, "username");
      const password = fieldValue(secret, injection.basic.passwordField) || fieldValue(secret, "password");
      if (!username || !password) throw new Error("The stored basic-auth credential is incomplete.");
      headers.Authorization = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
    }

    for (const header of action.extraHeaders ?? injection.extraHeaders ?? []) {
      const value = header.value ?? (header.field ? fieldValue(secret, header.field) : "");
      if (value) headers[header.name] = `${header.prefix ?? ""}${value}`;
    }

    for (const param of action.queryParams ?? injection.queryParams ?? []) {
      const value = param.value ?? (param.field ? fieldValue(secret, param.field) : "");
      if (value) url.searchParams.set(param.name, value);
    }

    const query: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(opts.input)) {
      if (value === undefined || value === null || usedPathKeys.has(key.toLowerCase())) continue;
      if (action.method === "GET") {
        if (typeof value === "object") {
          query[key] = JSON.stringify(value);
        } else {
          url.searchParams.set(key, String(value));
        }
      }
    }

    const init: RequestInit = { method: action.method, headers, signal: AbortSignal.timeout(15_000) };
    if (action.method !== "GET") {
      const body: Record<string, unknown> = { ...opts.input, ...query };
      for (const param of connectorDef.bodyParams ?? []) {
        const value = fieldValue(secret, param.field);
        if (value) body[param.name] = value;
      }
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
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
          credentialId: credential.id,
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
      credentialId: credential.id,
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
