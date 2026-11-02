import type { Agent, Credential, Environment } from "@prisma/client";
import { createHash, createPrivateKey, createPublicKey, sign } from "crypto";
import { db } from "./db";
import { auditEvent } from "./audit";
import { actionFor, connector, type Connector, type ConnectorAction } from "./connectors";
import { decryptSecret } from "./crypto";

export type ExecutionResult = {
  status: number;
  body: unknown;
  latencyMs: number;
  truncated: boolean;
  request: { method: string; url: string };
};

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 3;

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

function applyPath(template: string, values: Record<string, unknown>) {
  return template.replace(/\{([a-z0-9_]+)\}/gi, (match, key: string) => {
    const value = fieldValue(values, key);
    if (!value) throw new Error(`Missing path parameter "${key}".`);
    return encodeURIComponent(value);
  });
}

function resolveBase(
  connectorDef: Connector,
  action: ConnectorAction,
  secret: Record<string, unknown>,
  input: Record<string, unknown>,
) {
  const field = action.baseUrlField ?? connectorDef.baseUrlField;
  if (field) {
    const supplied = fieldValue(secret, field);
    if (!supplied) throw new Error(`The credential is missing "${field}".`);
    return normalizeBaseUrl(supplied);
  }

  if (action.host) return `https://${action.host}`;
  if (action.hostTemplate) {
    return `https://${applyPath(action.hostTemplate, { ...secret, ...input })}`;
  }
  if (connectorDef.hostTemplate) {
    return `https://${applyPath(connectorDef.hostTemplate, { ...secret, ...input })}`;
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

function publicRequestUrl(url: URL, sensitive: string[]) {
  const copy = new URL(url.toString());
  for (const key of [...copy.searchParams.keys()]) {
    if (sensitive.includes(key) || /token|secret|api[-_]?key|password|authorization|signature/i.test(key)) {
      copy.searchParams.set(key, "[redacted]");
    }
  }
  return copy.toString();
}

async function readBodyLimited(response: Response) {
  if (!response.body) return { text: "", truncated: false };
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  let truncated = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        truncated = true;
        await reader.cancel().catch(() => null);
        break;
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return { text: Buffer.concat(chunks).toString("utf8"), truncated };
}

function parseBody(text: string, contentType: string) {
  if (!text) return null;
  if (contentType.includes("json") || /^\s*[[{]/.test(text)) {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }
  return text;
}

async function noteCredentialHealth(
  credential: Credential,
  actionName: string,
  status: number,
  orgId: string,
) {
  if (status === 401 || status === 403) {
    if (credential.status === "broken") return;
    const detail = `The provider rejected this credential on ${actionName} (HTTP ${status}). Rotate it in the vault.`;
    await db.credential
      .update({
        where: { id: credential.id },
        data: { status: "broken", healthDetail: detail, healthEvents: { create: { result: "error", detail } } },
      })
      .catch(() => null);
    const recipients = await db.membership.findMany({
      where: { orgId, role: { in: ["owner", "admin"] } },
      select: { userId: true },
    });
    if (recipients.length) {
      await db.notification
        .createMany({
          data: recipients.map((member) => ({
            orgId,
            userId: member.userId,
            type: "credential",
            title: `${credential.name} was rejected by the provider`,
            body: detail,
            href: `/app/vault/${credential.id}`,
          })),
        })
        .catch(() => null);
    }
    return;
  }
  if (status >= 200 && status < 300 && credential.status !== "healthy") {
    const detail = `Provider accepted the credential on ${actionName}.`;
    await db.credential
      .update({
        where: { id: credential.id },
        data: { status: "healthy", healthDetail: null, healthEvents: { create: { result: "ok", detail } } },
      })
      .catch(() => null);
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
  const connectorDef = connector(credential.connectorSlug);
  if (!connectorDef) throw new Error(`Unknown connector "${credential.connectorSlug}".`);
  const started = Date.now();

  const redacted = redact(opts.input, connectorDef.redactedFields);
  const secret = (await decryptSecret(
    environment.projectId,
    credential.encryptedPayload,
    credential.dataKeyEncrypted,
  )) as Record<string, unknown>;
  checkCredentialEnvironment(connectorDef, secret, environment);

  const values = { ...secret, ...opts.input };
  const path = applyPath(action.path, values);
  const base = resolveBase(connectorDef, action, secret, opts.input).replace(/\/$/, "");
  const relativePath = path && path !== "/" ? path.replace(/^\/+/, "") : "";
  const url = relativePath ? new URL(relativePath, `${base}/`) : new URL(base);
  if (!hostAllowed(connectorDef, url.hostname)) {
    throw new Error(`${url.hostname} is not an allowed host for ${connectorDef.name}.`);
  }

  const usedPathKeys = new Set(
    [...action.path.matchAll(/\{([a-z0-9_]+)\}/gi)].map((match) => match[1].toLowerCase()),
  );

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

  const extraHeaders = action.extraHeaders ?? injection.extraHeaders ?? [];
  for (const header of extraHeaders) {
    const value = header.value ?? (header.field ? fieldValue(secret, header.field) : "");
    if (value) headers[header.name] = `${header.prefix ?? ""}${value}`;
  }

  const extraParams = action.queryParams ?? injection.queryParams ?? [];
  for (const param of extraParams) {
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

  let method: string = action.method;
  const init: RequestInit = { method, headers, signal: AbortSignal.timeout(15_000), redirect: "manual" };
  if (action.method !== "GET") {
    const body: Record<string, unknown> = { ...opts.input, ...query };
    for (const param of connectorDef.bodyParams ?? []) {
      const value = fieldValue(secret, param.field);
      if (value) body[param.name] = value;
    }
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }

  const sensitiveParams = [
    ...(injection.type === "query" ? [injection.name] : []),
    ...extraParams.map((param) => param.name),
  ];

  let result: ExecutionResult;
  try {
    let currentUrl = url;
    let response = await fetch(currentUrl, init);

    for (let hop = 0; hop < MAX_REDIRECTS; hop += 1) {
      const location = response.headers.get("location");
      if (response.status < 300 || response.status >= 400 || !location) break;
      const next = new URL(location, currentUrl);
      if (next.origin !== currentUrl.origin) {
        throw new Error(`Upstream redirected to ${next.origin}; refusing to forward credentials off-origin.`);
      }
      if (next.protocol !== "https:") throw new Error("Upstream redirects must use HTTPS.");
      if (response.status === 303 || ((response.status === 301 || response.status === 302) && method !== "GET")) {
        method = "GET";
        init.method = method;
        init.body = undefined;
        delete headers["Content-Type"];
      }
      currentUrl = next;
      response = await fetch(currentUrl, init);
    }

    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      throw new Error("Upstream returned too many redirects.");
    }

    const { text, truncated } = await readBodyLimited(response);
    result = {
      status: response.status,
      body: parseBody(text, response.headers.get("content-type") ?? ""),
      latencyMs: Date.now() - started,
      truncated,
      request: { method, url: publicRequestUrl(currentUrl, sensitiveParams) },
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

  await db.credential.update({ where: { id: credential.id }, data: { lastUsedAt: new Date() } }).catch(() => null);
  await db.agent.update({ where: { id: agent.id }, data: { lastActiveAt: new Date() } }).catch(() => null);
  const project = await db.project.findUnique({
    where: { id: environment.projectId },
    select: { orgId: true },
  });
  await recordUsage(project?.orgId ?? "", "proxy_calls");
  await noteCredentialHealth(credential, action.name, result.status, project?.orgId ?? "");

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
      truncated: result.truncated,
      approvalId: opts.approvalId,
      input: redacted,
    },
  });

  return result;
}

export { redact, safeJson };
