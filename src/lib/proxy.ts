import type { Agent, Credential, Environment } from "@prisma/client";
import { createHash, createPrivateKey, createPublicKey, sign } from "crypto";
import { db } from "./db";
import { auditEvent } from "./audit";
import { actionFor, connector, type Connector, type ConnectorAction } from "./connectors";
import { resolveConnector } from "./custom-connectors";
import { decryptSecret } from "./crypto";
import { gmailRawMessage } from "./gmail";
import { providerAuthFailure } from "./provider-health";
import { assertPublicHost, isPrivateHost, privateOutboundAllowed } from "./outbound";
import { refreshCredentialIfNeeded } from "./oauth-connect";
import { endSpanError, endSpanOk, startSpan, traceIdOf } from "./tracing";
import { redact, redactedFieldNames, redactDeep, secretValues } from "./redaction";
import { recordAgentEvent, resourceTypeOf, upstreamStatusClass } from "./agent-events";

export type ExecutionResult = {
  status: number;
  body: unknown;
  latencyMs: number;
  truncated: boolean;
  request: { method: string; url: string };
};

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 3;

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
  if (privateOutboundAllowed()) return false;
  return isPrivateHost(hostname);
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
  if (parsed.protocol !== "https:" && !(privateOutboundAllowed() && parsed.protocol === "http:")) {
    throw new Error("Only HTTPS endpoints are accepted.");
  }
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
  providerError: string | null = null,
) {
  if (status === 401 || status === 403 || providerError) {
    if (credential.status === "broken") return;
    const detail = providerError
      ? `The provider rejected this credential on ${actionName} (${providerError}). Rotate it in the vault.`
      : `The provider rejected this credential on ${actionName} (HTTP ${status}). Rotate it in the vault.`;
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

async function executeSandboxCall(opts: {
  environment: Environment;
  agent: Agent | null;
  credential: Credential;
  connectorDef: Connector;
  action: ConnectorAction;
  input: Record<string, unknown>;
  resource?: string;
  requestId: string;
  ip?: string | null;
  approvalId?: string;
  delegationDepth?: number;
  endUserId?: string | null;
  endUserExternalId?: string | null;
  trustRelationshipId?: string | null;
  decision?: { effect: string; risk: string; source: string; reason: string; grantId?: string | null };
}): Promise<ExecutionResult> {
  const { environment, agent, action, connectorDef, credential } = opts;
  const started = Date.now();
  const redactedInput = redact(opts.input, connectorDef.redactedFields);
  const redactions = redactedFieldNames(opts.input, connectorDef.redactedFields);
  const span = startSpan("proxy.call", {
    "authab.connector": connectorDef.slug,
    "authab.action": action.name,
    "authab.environment.id": environment.id,
    "authab.environment.type": environment.type,
    "authab.sandbox": true,
    ...(agent ? { "authab.agent.id": agent.id, "authab.agent.name": agent.name } : {}),
  });
  const traceId = traceIdOf(span);
  endSpanOk(span);
  span.end();
  const latencyMs = Math.max(1, Date.now() - started);
  const result: ExecutionResult = {
    status: 200,
    body: {
      sandbox: true,
      action: action.name,
      resource: opts.resource ?? null,
      request: { method: action.method, url: `sandbox://${action.name}` },
      input: redactedInput,
      response: action.sample ?? { ok: true },
      note: "No network egress. Auth, grants, policy, approvals, rate limits and audit ran exactly as they do for a live connector.",
    },
    latencyMs,
    truncated: false,
    request: { method: action.method, url: `sandbox://${action.name}` },
  };

  await db.credential.update({ where: { id: credential.id }, data: { lastUsedAt: new Date() } }).catch(() => null);
  if (agent) {
    await db.agent.update({ where: { id: agent.id }, data: { lastActiveAt: new Date() } }).catch(() => null);
  }
  await auditEvent({
    environmentId: environment.id,
    actorType: agent ? "agent" : "system",
    actorId: agent?.id ?? null,
    actorName: agent?.name ?? "Sandbox",
    agentId: agent?.id ?? null,
    action: "sandbox.call",
    resourceType: "connector",
    resourceId: connectorDef.slug,
    outcome: "allowed",
    requestId: opts.requestId,
    ip: opts.ip,
    payloadSummary: {
      action: action.name,
      resource: opts.resource,
      credentialId: credential.id,
      status: 200,
      latencyMs,
      sandbox: true,
      approvalId: opts.approvalId,
      ...(traceId ? { traceId } : {}),
      ...(opts.endUserId ? { endUser: { id: opts.endUserId, externalUserId: opts.endUserExternalId ?? null } } : {}),
      ...(agent?.kind === "external"
        ? { crossOrg: { externalAgentId: agent.externalAgentId, externalOrgName: agent.externalOrgName } }
        : {}),
      input: redactedInput,
      ...(opts.decision ? { decision: opts.decision } : {}),
      trust: {
        egress: false,
        request: { method: action.method, target: `sandbox://${action.name}` },
        injection: {
          location: "none",
          name: null,
          scheme: null,
          source: "No secret — the sandbox executor never reads credential material",
        },
        injectedHeaders: [],
        injectedParams: [],
        injectedBodyFields: [],
        redactions,
        responseRedactions: 0,
        responseStatus: 200,
        latencyMs,
        billable: false,
        ...(traceId ? { traceId } : {}),
      },
    },
  });

  if (agent) {
    const project = await db.project
      .findUnique({ where: { id: environment.projectId }, select: { orgId: true } })
      .catch(() => null);
    await recordAgentEvent({
      environmentId: environment.id,
      organizationId: project?.orgId ?? "",
      agentId: agent.id,
      agentType: agent.agentType,
      requestId: opts.requestId,
      connectorSlug: connectorDef.slug,
      action: action.name,
      riskClass: action.risk,
      resourceType: resourceTypeOf(action, connectorDef),
      decision: opts.approvalId ? "approved" : "allowed",
      decisionReasonCode: opts.approvalId ? "approval_approved" : "granted",
      upstreamStatusClass: upstreamStatusClass(200),
      latencyMs,
      delegationDepth: opts.delegationDepth ?? 0,
      isSandbox: true,
      credentialId: credential.id,
      endUserId: opts.endUserId ?? null,
      trustRelationshipId: opts.trustRelationshipId ?? null,
      approvalLatencyMs: await approvalLatency(opts.approvalId),
    });
  }

  return result;
}

export async function approvalLatency(approvalId?: string) {
  if (!approvalId) return null;
  const approval = await db.approvalRequest
    .findUnique({ where: { id: approvalId }, select: { createdAt: true } })
    .catch(() => null);
  return approval ? Math.max(0, Date.now() - approval.createdAt.getTime()) : null;
}

export async function executeAction(opts: {
  environment: Environment;
  agent: Agent | null;
  credential: Credential;
  connectorDef?: Connector;
  action: ConnectorAction;
  input: Record<string, unknown>;
  resource?: string;
  requestId: string;
  ip?: string | null;
  approvalId?: string;
  healthCheck?: boolean;
  skipHealthNote?: boolean;
  countUsage?: boolean;
  delegationDepth?: number;
  endUserId?: string | null;
  endUserExternalId?: string | null;
  trustRelationshipId?: string | null;
  decision?: { effect: string; risk: string; source: string; reason: string; grantId?: string | null };
}): Promise<ExecutionResult> {
  const { environment, agent, action } = opts;
  let credential = opts.credential;
  const connectorDef = opts.connectorDef ?? (await resolveConnector(credential.connectorSlug, environment.id));
  if (!connectorDef) throw new Error(`Unknown connector "${credential.connectorSlug}".`);

  if (connectorDef.sandbox) {
    return executeSandboxCall({
      environment,
      agent,
      credential,
      connectorDef,
      action,
      input: opts.input,
      resource: opts.resource,
      requestId: opts.requestId,
      ip: opts.ip,
      approvalId: opts.approvalId,
      delegationDepth: opts.delegationDepth,
      endUserId: opts.endUserId,
      endUserExternalId: opts.endUserExternalId,
      trustRelationshipId: opts.trustRelationshipId,
      decision: opts.decision,
    });
  }

  const started = Date.now();
  const auditAction = opts.healthCheck ? "credential.checked" : "proxy.call";
  const crossOrg =
    agent?.kind === "external" && agent.externalOrgName
      ? { externalAgentId: agent.externalAgentId, externalOrgName: agent.externalOrgName }
      : null;
  const actorName = agent
    ? crossOrg && !agent.name.includes(`(${crossOrg.externalOrgName})`)
      ? `${agent.name} (via ${crossOrg.externalOrgName})`
      : agent.name
    : "Credential health check";

  if (credential.type === "oauth" && credential.refreshable) {
    credential = await refreshCredentialIfNeeded(credential);
  }

  const redacted = redact(opts.input, connectorDef.redactedFields);
  const redactions = redactedFieldNames(opts.input, connectorDef.redactedFields);
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

  const injection =
    credential.type === "oauth" && connectorDef.oauthInjection
      ? connectorDef.oauthInjection
      : connectorDef.injection;
  let token = action.authField ? fieldValue(secret, action.authField) : tokenFrom(secret, credential);
  if (connectorDef.authStrategy === "snowflake-jwt") token = snowflakeJwt(secret);
  const authKey = action.authField ?? injection.field;
  const authRequired = connectorDef.credentialFields?.find((field) => field.key === authKey)?.required;
  if (!token && !injection.basic && (authRequired === true || !authKey)) {
    throw new Error("The stored credential has no usable secret. Rotate it in the vault.");
  }

  const headers: Record<string, string> = { Accept: "application/json" };
  const injectedHeaders: string[] = [];
  const injectedParams: string[] = [];
  const injectedBodyFields: string[] = [];
  if (injection.type === "header") {
    if (token) {
      headers[injection.name] = `${injection.prefix ?? ""}${token}`;
      injectedHeaders.push(injection.name);
    }
  } else if (token) {
    url.searchParams.set(injection.name, token);
    injectedParams.push(injection.name);
  }

  if (injection.basic) {
    const username = fieldValue(secret, injection.basic.usernameField) || fieldValue(secret, "username");
    const password = fieldValue(secret, injection.basic.passwordField) || fieldValue(secret, "password");
    if (!username || (!password && !injection.basic.allowEmptyPassword)) {
      throw new Error("The stored basic-auth credential is incomplete.");
    }
    headers.Authorization = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
    injectedHeaders.push("Authorization");
  }

  const extraHeaders = action.extraHeaders ?? injection.extraHeaders ?? [];
  for (const header of extraHeaders) {
    const value = header.value ?? (header.field ? fieldValue(secret, header.field) : "");
    if (value) {
      headers[header.name] = `${header.prefix ?? ""}${value}`;
      injectedHeaders.push(header.name);
    }
  }

  const extraParams = action.queryParams ?? injection.queryParams ?? [];
  for (const param of extraParams) {
    const value = param.value ?? (param.field ? fieldValue(secret, param.field) : "");
    if (value) {
      url.searchParams.set(param.name, value);
      injectedParams.push(param.name);
    }
  }

  const authSource =
    injection.basic
      ? "Basic auth"
      : connectorDef.authStrategy === "snowflake-jwt"
        ? "Snowflake key-pair JWT"
        : credential.type === "oauth"
          ? "OAuth access token"
          : action.authField
            ? `Credential field “${action.authField}”`
            : credential.type === "bearer"
              ? "Bearer token"
              : "API key";
  const injectedNothing = !token && !injection.basic;
  const injectionSummary = injectedNothing
    ? { location: "none" as const, name: null, scheme: null, source: "No credential injected — this action is public" }
    : {
        location: injection.basic ? ("header" as const) : injection.type,
        name: injection.basic ? "Authorization" : injection.name,
        scheme: injection.basic
          ? "Basic"
          : injection.type === "header"
            ? injection.prefix?.trim() || "raw"
            : null,
        source: authSource,
      };
  const responseSecrets = secretValues(
    secret,
    [action.authField, injection.basic?.passwordField].filter((key): key is string => Boolean(key)),
  );
  if (token && token.length >= 8 && !responseSecrets.includes(token)) responseSecrets.push(token);

  const queryFields = action.queryFields ?? [];
  for (const key of queryFields) {
    const value = opts.input[key];
    if (value === undefined || value === null) continue;
    url.searchParams.set(key, typeof value === "object" ? JSON.stringify(value) : String(value));
  }

  const query: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(opts.input)) {
    if (value === undefined || value === null || usedPathKeys.has(key.toLowerCase())) continue;
    if (queryFields.includes(key)) continue;
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
    for (const key of queryFields) delete body[key];
    for (const param of connectorDef.bodyParams ?? []) {
      const value = fieldValue(secret, param.field);
      if (value) {
        body[param.name] = value;
        injectedBodyFields.push(param.name);
      }
    }

    if (connectorDef.slug === "google" && !action.graphqlQuery && typeof body.raw !== "string" && !body.message) {
      const gmailKind = action.name === "gmail.send_message" ? "send" : action.name === "gmail.create_draft" ? "draft" : null;
      if (gmailKind) {
        const raw = gmailRawMessage(body);
        if (!raw) throw new Error("Gmail needs to, subject and body (or a raw MIME message).");
        for (const key of ["to", "subject", "body"]) delete body[key];
        if (gmailKind === "send") body.raw = raw;
        else body.message = { raw };
      }
    }

    if (action.argHeader) {
      const args: Record<string, unknown> = { ...body };
      if (action.argHeader.bodyField) {
        const raw = args[action.argHeader.bodyField];
        delete args[action.argHeader.bodyField];
        if (raw !== undefined && raw !== null) init.body = typeof raw === "string" ? raw : JSON.stringify(raw);
      }
      headers[action.argHeader.name] = JSON.stringify(args);
      headers["Content-Type"] = "application/octet-stream";
    } else if (action.graphqlQuery) {
      const variables: Record<string, unknown> = { ...body };
      if (action.graphqlWrap) {
        const wrapped: Record<string, unknown> = { ...body };
        if (wrapped.id === undefined && opts.resource) wrapped.id = opts.resource;
        variables[action.graphqlWrap] = wrapped;
        for (const key of Object.keys(wrapped)) delete variables[key];
      } else if (variables.id === undefined && opts.resource && /\$id\b/.test(action.graphqlQuery)) {
        variables.id = opts.resource;
      }
      for (const key of Object.keys(variables)) {
        if (variables[key] === undefined || variables[key] === null) delete variables[key];
      }
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify({ query: action.graphqlQuery, variables });
    } else if ((action.bodyFormat ?? connectorDef.bodyFormat ?? "json") === "form") {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(body)) {
        if (value === undefined || value === null) continue;
        if (Array.isArray(value)) {
          for (const item of value) params.append(key, typeof item === "object" ? JSON.stringify(item) : String(item));
        } else {
          params.append(key, typeof value === "object" ? JSON.stringify(value) : String(value));
        }
      }
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      if ([...params.keys()].length) init.body = params.toString();
    } else {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }
  }

  const sensitiveParams = [
    ...(injection.type === "query" ? [injection.name] : []),
    ...extraParams.map((param) => param.name),
  ];

  const span = startSpan("proxy.call", {
    "http.request.method": method,
    "url.full": publicRequestUrl(url, sensitiveParams),
    "server.address": url.hostname,
    "authab.connector": connectorDef.slug,
    "authab.action": action.name,
    "authab.environment.id": environment.id,
    "authab.environment.type": environment.type,
    ...(agent ? { "authab.agent.id": agent.id, "authab.agent.name": agent.name } : {}),
  });
  const traceId = traceIdOf(span);

  let result: ExecutionResult;
  let currentUrl = url;
  let requestTarget = `${url.origin}${url.pathname}`;
  let responseRedactions = 0;
  try {
    await assertPublicHost(url.hostname, "Upstream host");
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
      requestTarget = `${currentUrl.origin}${currentUrl.pathname}`;
      await assertPublicHost(next.hostname, "Upstream host");
      response = await fetch(currentUrl, init);
    }

    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      throw new Error("Upstream returned too many redirects.");
    }

    const { text, truncated } = await readBodyLimited(response);
    const scanned = redactDeep(parseBody(text, response.headers.get("content-type") ?? ""), responseSecrets);
    responseRedactions = scanned.hits;
    result = {
      status: response.status,
      body: scanned.value,
      latencyMs: Date.now() - started,
      truncated,
      request: { method, url: publicRequestUrl(currentUrl, sensitiveParams) },
    };
  } catch (error) {
    endSpanError(span, error);
    span.end();
    const cause =
      error instanceof Error
        ? (error as Error & { cause?: { code?: string; message?: string } }).cause
        : undefined;
    await auditEvent({
      environmentId: environment.id,
      actorType: agent ? "agent" : "system",
      actorId: agent?.id ?? null,
      actorName,
      agentId: agent?.id ?? null,
      action: auditAction,
      resourceType: "connector",
      resourceId: connectorDef.slug,
      outcome: "error",
      requestId: opts.requestId,
      ip: opts.ip,
      payloadSummary: {
        action: action.name,
        resource: opts.resource,
        credentialId: credential.id,
        host: url.hostname,
        latencyMs: Date.now() - started,
        ...(traceId ? { traceId } : {}),
        error: error instanceof Error ? error.message : "upstream_failure",
        ...(cause?.code ? { errorCode: cause.code } : {}),
        ...(cause?.message ? { errorCause: cause.message } : {}),
        ...(opts.endUserId ? { endUser: { id: opts.endUserId, externalUserId: opts.endUserExternalId ?? null } } : {}),
        ...(crossOrg ? { crossOrg } : {}),
        input: redacted,
        ...(opts.decision ? { decision: opts.decision } : {}),
        trust: {
          egress: true,
          request: { method: init.method ?? method, target: requestTarget },
          injection: injectionSummary,
          injectedHeaders: [...new Set(injectedHeaders)],
          injectedParams: [...new Set(injectedParams)],
          injectedBodyFields: [...new Set(injectedBodyFields)],
          redactions,
          responseRedactions: 0,
          responseStatus: null,
          latencyMs: Date.now() - started,
          ...(traceId ? { traceId } : {}),
        },
      },
    });
    if (agent && !opts.healthCheck) {
      const orgId =
        (
          await db.project
            .findUnique({ where: { id: environment.projectId }, select: { orgId: true } })
            .catch(() => null)
        )?.orgId ?? "";
      await recordAgentEvent({
        environmentId: environment.id,
        organizationId: orgId,
        agentId: agent.id,
        agentType: agent.agentType,
        requestId: opts.requestId,
        connectorSlug: connectorDef.slug,
        action: action.name,
        riskClass: action.risk,
        resourceType: resourceTypeOf(action, connectorDef),
        decision: "errored",
        decisionReasonCode: "provider_error",
        upstreamStatusClass: "none",
        latencyMs: Date.now() - started,
        delegationDepth: opts.delegationDepth ?? 0,
        isSandbox: false,
        credentialId: credential.id,
        endUserId: opts.endUserId ?? null,
        trustRelationshipId: opts.trustRelationshipId ?? null,
        approvalLatencyMs: await approvalLatency(opts.approvalId),
      });
    }
    throw new Error(
      `Upstream call to ${connectorDef.name} failed: ${
        error instanceof Error ? error.message : "unknown error"
      }`,
    );
  }

  const providerError = providerAuthFailure(connectorDef.slug, result.body);
  span.setAttribute("http.response.status_code", result.status);
  span.setAttribute("authab.upstream.latency_ms", result.latencyMs);
  if (result.status >= 400 || providerError) {
    endSpanError(span, new Error(providerError ?? `Upstream returned HTTP ${result.status}.`));
  } else {
    endSpanOk(span);
  }
  span.end();

  await db.credential.update({ where: { id: credential.id }, data: { lastUsedAt: new Date() } }).catch(() => null);
  if (agent) {
    await db.agent.update({ where: { id: agent.id }, data: { lastActiveAt: new Date() } }).catch(() => null);
  }
  const project = await db.project.findUnique({
    where: { id: environment.projectId },
    select: { orgId: true },
  });
  if (opts.countUsage !== false) await recordUsage(project?.orgId ?? "", "proxy_calls");
  if (!opts.skipHealthNote) {
    await noteCredentialHealth(credential, action.name, result.status, project?.orgId ?? "", providerError);
  }

  await auditEvent({
    environmentId: environment.id,
    actorType: agent ? "agent" : "system",
    actorId: agent?.id ?? null,
    actorName,
    agentId: agent?.id ?? null,
    action: auditAction,
    resourceType: "connector",
    resourceId: connectorDef.slug,
    outcome: result.status < 400 && !providerError ? "allowed" : "error",
    requestId: opts.requestId,
    ip: opts.ip,
    payloadSummary: {
      action: action.name,
      resource: opts.resource,
      credentialId: credential.id,
      host: url.hostname,
      status: result.status,
      latencyMs: result.latencyMs,
      truncated: result.truncated,
      approvalId: opts.approvalId,
      ...(traceId ? { traceId } : {}),
      ...(providerError ? { providerError } : {}),
      ...(opts.endUserId ? { endUser: { id: opts.endUserId, externalUserId: opts.endUserExternalId ?? null } } : {}),
      ...(crossOrg ? { crossOrg } : {}),
      input: redacted,
      ...(opts.decision ? { decision: opts.decision } : {}),
      trust: {
        egress: true,
        request: { method: result.request.method, target: requestTarget },
        injection: injectionSummary,
        injectedHeaders: [...new Set(injectedHeaders)],
        injectedParams: [...new Set(injectedParams)],
        injectedBodyFields: [...new Set(injectedBodyFields)],
        redactions,
        responseRedactions,
        responseStatus: result.status,
        latencyMs: result.latencyMs,
        truncated: result.truncated,
        ...(providerError ? { providerError } : {}),
        ...(traceId ? { traceId } : {}),
        billable: opts.countUsage !== false,
      },
    },
  });

  if (agent && !opts.healthCheck) {
    const succeeded = result.status < 400 && !providerError;
    await recordAgentEvent({
      environmentId: environment.id,
      organizationId: project?.orgId ?? "",
      agentId: agent.id,
      agentType: agent.agentType,
      requestId: opts.requestId,
      connectorSlug: connectorDef.slug,
      action: action.name,
      riskClass: action.risk,
      resourceType: resourceTypeOf(action, connectorDef),
      decision: succeeded ? (opts.approvalId ? "approved" : "allowed") : "errored",
      decisionReasonCode: succeeded
        ? opts.approvalId
          ? "approval_approved"
          : "granted"
        : providerError
          ? "provider_auth_failed"
          : "provider_error",
      upstreamStatusClass: upstreamStatusClass(result.status),
      latencyMs: result.latencyMs,
      costUnits: opts.countUsage === false ? 0 : 1,
      delegationDepth: opts.delegationDepth ?? 0,
      isSandbox: false,
      credentialId: credential.id,
      endUserId: opts.endUserId ?? null,
      trustRelationshipId: opts.trustRelationshipId ?? null,
      approvalLatencyMs: await approvalLatency(opts.approvalId),
    });
  }

  return result;
}

export { redact, redactedFieldNames, safeJson };
