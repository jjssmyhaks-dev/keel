import { createHash } from "node:crypto";
import type { Credential } from "@prisma/client";
import { db } from "./db";
import { auditEvent } from "./audit";
import { constantTimeEqual, decryptSecret, encryptSecret, randomToken, signedLinkToken, verifySignedLinkToken } from "./crypto";
import { appUrl } from "./email";
import { builtinProvider, envClientFor } from "./oauth-providers";
import { assertSafeOutboundUrl } from "./outbound";

export const CONNECT_COOKIE = "authab_connect";
const CONNECT_TTL_MS = 10 * 60_000;
const REFRESH_MARGIN_MS = 5 * 60_000;
const TRANSIENT_CODES = new Set([
  "server_error",
  "temporarily_unavailable",
  "network_error",
  "timeout",
  "rate_limited",
]);

export type ResolvedOAuthClient = {
  connectorSlug: string;
  label: string;
  authorizeUrl: string;
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  scopes: string[];
  scopeSeparator: string;
  tokenAuth: "basic" | "body";
  pkce: boolean;
  extraAuthParams: Record<string, string>;
  oauthAppId?: string;
  source: "database" | "env";
};

export type ConnectStatePayload = {
  connectorSlug: string;
  environmentId: string;
  userId: string;
  clientId: string;
  nonce: string;
  verifier?: string;
  issuedAt: number;
};

export type OAuthTokens = {
  accessToken: string;
  refreshToken?: string;
  tokenType: string;
  expiresAt?: Date;
  scopes: string[];
  raw: Record<string, unknown>;
};

export class OAuthTokenError extends Error {
  code: string;
  transient: boolean;

  constructor(message: string, code: string, transient: boolean) {
    super(message);
    this.name = "OAuthTokenError";
    this.code = code;
    this.transient = transient;
  }
}

function safeJson(value: string | null) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function safeArray(value: string | null) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function splitScopes(scope: unknown, separator = " ") {
  if (typeof scope !== "string" || !scope.trim()) return [];
  return scope
    .split(separator === "," ? /[,\s]+/ : /\s+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function connectRedirectUri(connectorSlug: string) {
  return `${appUrl("").replace(/\/$/, "")}/api/connect/${encodeURIComponent(connectorSlug)}/callback`;
}

/**
 * Resolves the OAuth client for a connector: an app configured in the
 * environment wins, otherwise CONNECT_<PROVIDER>_CLIENT_ID/SECRET from the
 * server environment. Returns null when the provider has no client yet.
 */
export async function resolveOAuthClient(
  connectorSlug: string,
  environmentId: string,
): Promise<ResolvedOAuthClient | null> {
  const environment = await db.environment.findUnique({
    where: { id: environmentId },
    select: { projectId: true },
  });
  if (!environment) return null;

  const app = await db.oAuthApp.findUnique({
    where: { environmentId_connectorSlug: { environmentId, connectorSlug } },
  });
  const builtin = builtinProvider(connectorSlug);

  if (app && app.enabled) {
    let clientSecret = "";
    try {
      const sealed = await decryptSecret(
        environment.projectId,
        app.clientSecretEncrypted,
        app.dataKeyEncrypted,
      );
      clientSecret = String((sealed as Record<string, unknown>).clientSecret ?? "");
    } catch {
      return null;
    }
    if (!clientSecret) return null;
    const authorizeUrl = app.authorizeUrl || builtin?.authorizeUrl || "";
    const tokenUrl = app.tokenUrl || builtin?.tokenUrl || "";
    if (!authorizeUrl || !tokenUrl) return null;
    const configuredScopes = safeArray(app.scopesJson);
    return {
      connectorSlug,
      label: builtin?.label ?? app.provider,
      authorizeUrl,
      tokenUrl,
      clientId: app.clientId,
      clientSecret,
      scopes: configuredScopes.length ? configuredScopes : (builtin?.scopes ?? []),
      scopeSeparator: app.scopeSeparator || builtin?.scopeSeparator || " ",
      tokenAuth: app.tokenAuth === "basic" ? "basic" : "body",
      pkce: app.pkce,
      extraAuthParams: {
        ...(builtin?.extraAuthParams ?? {}),
        ...(safeJson(app.extraAuthParamsJson) as Record<string, string>),
      },
      oauthAppId: app.id,
      source: "database",
    };
  }

  if (!builtin) return null;
  const env = envClientFor(connectorSlug);
  if (!env) return null;
  return {
    connectorSlug,
    label: builtin.label,
    authorizeUrl: builtin.authorizeUrl,
    tokenUrl: builtin.tokenUrl,
    clientId: env.clientId,
    clientSecret: env.clientSecret,
    scopes: env.scopes?.length ? env.scopes : builtin.scopes,
    scopeSeparator: builtin.scopeSeparator,
    tokenAuth: builtin.tokenAuth,
    pkce: builtin.pkce,
    extraAuthParams: builtin.extraAuthParams ?? {},
    source: "env",
  };
}

export function createConnectState(input: {
  connectorSlug: string;
  environmentId: string;
  userId: string;
  clientId: string;
  verifier?: string;
}): { state: string; cookie: string; payload: ConnectStatePayload } {
  const nonce = randomToken(24);
  const payload: ConnectStatePayload = {
    ...input,
    nonce,
    issuedAt: Date.now(),
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return { state: nonce, cookie: signedLinkToken([encoded]), payload };
}

export function verifyConnectState(token: string | null | undefined): ConnectStatePayload | null {
  if (!token) return null;
  const payload = verifySignedLinkToken(token);
  if (!payload) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as ConnectStatePayload;
    if (!parsed.nonce || !parsed.connectorSlug || !parsed.environmentId || !parsed.userId) return null;
    if (Date.now() - parsed.issuedAt > CONNECT_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function codeChallenge(verifier: string) {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function buildAuthorizeUrl(
  client: ResolvedOAuthClient,
  input: { redirectUri: string; state: string; verifier?: string },
) {
  const url = new URL(client.authorizeUrl);
  url.searchParams.set("client_id", client.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", input.state);
  if (client.scopes.length && client.scopeSeparator !== "none") {
    url.searchParams.set("scope", client.scopes.join(client.scopeSeparator));
  }
  if (client.pkce && input.verifier) {
    url.searchParams.set("code_challenge", codeChallenge(input.verifier));
    url.searchParams.set("code_challenge_method", "S256");
  }
  for (const [key, value] of Object.entries(client.extraAuthParams)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

function parseTokenBody(text: string, contentType: string): Record<string, unknown> {
  if (!text) return {};
  if (contentType.includes("json") || /^\s*[{[]/.test(text)) {
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      return { raw: text };
    }
  }
  const params = new URLSearchParams(text);
  return Object.fromEntries(params.entries());
}

async function tokenRequest(
  client: ResolvedOAuthClient,
  params: Record<string, string>,
): Promise<Record<string, unknown>> {
  const endpoint = await assertSafeOutboundUrl(client.tokenUrl, "OAuth token endpoint");
  const body = new URLSearchParams(params);
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
  };
  if (client.tokenAuth === "basic") {
    headers.Authorization = `Basic ${Buffer.from(`${client.clientId}:${client.clientSecret}`).toString("base64")}`;
  } else {
    body.set("client_id", client.clientId);
    body.set("client_secret", client.clientSecret);
  }

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers,
      body,
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new OAuthTokenError(
      "Could not reach the OAuth token endpoint. Try again.",
      "network_error",
      true,
    );
  }
  const text = await response.text();
  const payload = parseTokenBody(text, response.headers.get("content-type") ?? "");
  const providerError =
    typeof payload.error === "string"
      ? payload.error
      : payload.ok === false
        ? String(payload.error_description ?? payload.error ?? "provider_error")
        : null;
  const failed = !response.ok || Boolean(providerError);
  if (failed) {
    const code = providerError || `http_${response.status}`;
    const description =
      typeof payload.error_description === "string"
        ? payload.error_description
        : typeof payload.error === "string"
          ? payload.error
          : response.statusText;
    throw new OAuthTokenError(
      `OAuth token endpoint rejected the request (${code}${description ? `: ${description}` : ""}).`,
      code,
      TRANSIENT_CODES.has(code) || response.status >= 500 || response.status === 429,
    );
  }
  return payload;
}

export function normalizeTokens(
  raw: Record<string, unknown>,
  client: ResolvedOAuthClient,
): OAuthTokens {
  const accessToken = typeof raw.access_token === "string" ? raw.access_token : "";
  if (!accessToken) {
    throw new OAuthTokenError(
      "The OAuth token endpoint did not return an access token.",
      "invalid_response",
      false,
    );
  }
  const expiresIn = Number(raw.expires_in);
  const expiresAt = Number.isFinite(expiresIn) && expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000) : undefined;
  const scopes = splitScopes(raw.scope, client.scopeSeparator);
  return {
    accessToken,
    refreshToken: typeof raw.refresh_token === "string" ? raw.refresh_token : undefined,
    tokenType: typeof raw.token_type === "string" ? raw.token_type : "Bearer",
    expiresAt,
    scopes: scopes.length ? scopes : client.scopes,
    raw,
  };
}

export async function exchangeAuthorizationCode(
  client: ResolvedOAuthClient,
  input: { code: string; redirectUri: string; verifier?: string },
): Promise<OAuthTokens> {
  const params: Record<string, string> = {
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.redirectUri,
  };
  if (client.pkce && input.verifier) params.code_verifier = input.verifier;
  return normalizeTokens(await tokenRequest(client, params), client);
}

export async function refreshAccessToken(
  client: ResolvedOAuthClient,
  refreshToken: string,
): Promise<OAuthTokens> {
  return normalizeTokens(
    await tokenRequest(client, { grant_type: "refresh_token", refresh_token: refreshToken }),
    client,
  );
}

async function accessTokensEnvironment(credential: Credential) {
  return db.environment.findUnique({
    where: { id: credential.environmentId },
    select: { projectId: true, project: { select: { orgId: true } } },
  });
}

async function clientForCredential(credential: Credential): Promise<ResolvedOAuthClient | null> {
  if (credential.oauthAppId) {
    const app = await db.oAuthApp.findFirst({
      where: { id: credential.oauthAppId, environmentId: credential.environmentId },
    });
    if (app) {
      const resolved = await resolveOAuthClient(app.connectorSlug, credential.environmentId);
      if (resolved) return resolved;
    }
  }
  return resolveOAuthClient(credential.connectorSlug, credential.environmentId);
}

async function notifyCredentialBroken(
  orgId: string,
  credential: { id: string; name: string },
  detail: string,
) {
  if (!orgId) return;
  const recipients = await db.membership.findMany({
    where: { orgId, role: { in: ["owner", "admin"] } },
    select: { userId: true },
  });
  if (!recipients.length) return;
  await db.notification
    .createMany({
      data: recipients.map((member) => ({
        orgId,
        userId: member.userId,
        type: "credential",
        title: `${credential.name} needs to be reconnected`,
        body: detail,
        href: `/app/vault/${credential.id}`,
      })),
    })
    .catch(() => null);
}

export async function markCredentialBroken(credential: Credential, detail: string, reason: string) {
  await db.credential
    .update({
      where: { id: credential.id },
      data: {
        status: "broken",
        healthDetail: detail,
        healthEvents: { create: { result: "error", detail } },
      },
    })
    .catch(() => null);
  const environment = await accessTokensEnvironment(credential);
  await notifyCredentialBroken(environment?.project.orgId ?? "", credential, detail);
  await auditEvent({
    environmentId: credential.environmentId,
    actorType: "system",
    actorName: "Token refresh",
    action: "credential.broken",
    resourceType: "credential",
    resourceId: credential.id,
    outcome: "error",
    payloadSummary: { connector: credential.connectorSlug, reason, detail },
  }).catch(() => null);
}

/**
 * Refreshes a stored OAuth credential using its refresh token. Rotated refresh
 * tokens are written back before returning. Permanent failures mark the
 * credential broken and notify owners; transient failures keep the existing
 * token usable when it has not expired yet.
 */
export async function refreshCredentialToken(credentialId: string): Promise<Credential> {
  const credential = await db.credential.findUnique({ where: { id: credentialId } });
  if (!credential) throw new Error("Credential not found.");
  if (credential.revokedAt || credential.status === "revoked") {
    throw new Error("This credential was revoked.");
  }
  if (credential.type !== "oauth") throw new Error("Only OAuth credentials can be refreshed.");

  const environment = await accessTokensEnvironment(credential);
  if (!environment) throw new Error("Credential environment not found.");

  let payload: Record<string, unknown>;
  try {
    payload = (await decryptSecret(
      environment.projectId,
      credential.encryptedPayload,
      credential.dataKeyEncrypted,
    )) as Record<string, unknown>;
  } catch {
    throw new Error("The stored credential could not be decrypted.");
  }
  const refreshToken = typeof payload.refresh_token === "string" ? payload.refresh_token : "";
  if (!refreshToken) throw new Error("This credential has no refresh token. Reconnect it.");

  const client = await clientForCredential(credential);
  if (!client) throw new Error("No OAuth client is configured for this connector. Reconnect it.");

  const expired = Boolean(credential.tokenExpiresAt && credential.tokenExpiresAt.getTime() <= Date.now());

  let tokens: OAuthTokens;
  try {
    tokens = await refreshAccessToken(client, refreshToken);
  } catch (error) {
    const failure = error instanceof OAuthTokenError ? error : null;
    // Another worker may have rotated the token while this refresh was in flight.
    const current = await db.credential.findUnique({ where: { id: credential.id } });
    if (current && current.encryptedPayload !== credential.encryptedPayload) {
      return current;
    }
    const permanent = failure ? !failure.transient : true;
    if (permanent) {
      const detail = `Token refresh failed (${failure?.code ?? "error"}). Reconnect this credential${expired ? " — the access token has expired" : ""}.`;
      await markCredentialBroken(credential, detail, failure?.code ?? "refresh_failed");
      throw new Error(detail);
    }
    await db.connectionHealthEvent
      .create({
        data: {
          credentialId: credential.id,
          result: "warn",
          detail: `Token refresh deferred (${failure?.code ?? "network"}). The current token is still in use.`,
        },
      })
      .catch(() => null);
    if (expired) {
      throw new Error("The access token expired and refresh failed. Try again shortly.");
    }
    return credential;
  }

  const nextPayload: Record<string, unknown> = {
    ...payload,
    access_token: tokens.accessToken,
    token_type: tokens.tokenType,
  };
  nextPayload.refresh_token = tokens.refreshToken ?? refreshToken;
  if (tokens.expiresAt) nextPayload.expires_at = tokens.expiresAt.toISOString();
  else delete nextPayload.expires_at;
  if (tokens.raw.instance_url && typeof tokens.raw.instance_url === "string") {
    nextPayload.instance_url = tokens.raw.instance_url;
  }

  const sealed = await encryptSecret(environment.projectId, nextPayload);
  // Compare-and-swap on the stored payload so a slower worker cannot overwrite
  // a refresh (and rotated refresh token) that another worker already stored.
  const written = await db.credential.updateMany({
    where: { id: credential.id, encryptedPayload: credential.encryptedPayload },
    data: {
      encryptedPayload: sealed.encryptedPayload,
      dataKeyEncrypted: sealed.dataKeyEncrypted,
      tokenExpiresAt: tokens.expiresAt ?? null,
      expiresAt: tokens.expiresAt ?? credential.expiresAt,
      refreshable: Boolean(tokens.refreshToken ?? refreshToken),
      oauthScopes: JSON.stringify(tokens.scopes),
      ...(credential.status === "broken" ? { status: "unverified", healthDetail: null } : {}),
    },
  });
  if (written.count === 0) {
    const current = await db.credential.findUnique({ where: { id: credential.id } });
    if (current && current.encryptedPayload !== credential.encryptedPayload) return current;
    throw new Error("The credential changed while it was being refreshed. Try again.");
  }
  await db.connectionHealthEvent
    .create({
      data: {
        credentialId: credential.id,
        result: "refreshed",
        detail: "Access token refreshed from the provider.",
      },
    })
    .catch(() => null);
  const updated = await db.credential.findUnique({ where: { id: credential.id } });
  if (!updated) throw new Error("This credential was removed during refresh.");
  await auditEvent({
    environmentId: credential.environmentId,
    actorType: "system",
    actorName: "Token refresh",
    action: "credential.refreshed",
    resourceType: "credential",
    resourceId: credential.id,
    outcome: "recorded",
    payloadSummary: {
      connector: credential.connectorSlug,
      rotatedRefreshToken: Boolean(tokens.refreshToken),
      expiresAt: tokens.expiresAt?.toISOString() ?? null,
    },
  }).catch(() => null);
  return updated;
}

/**
 * Called by the proxy before a provider call. Refreshes when the token is
 * inside the safety margin so callers never see an expired token.
 */
export async function refreshCredentialIfNeeded(
  credential: Credential,
  marginMs = REFRESH_MARGIN_MS,
): Promise<Credential> {
  if (credential.type !== "oauth" || !credential.refreshable || credential.revokedAt) {
    return credential;
  }
  if (!credential.tokenExpiresAt) return credential;
  const remaining = credential.tokenExpiresAt.getTime() - Date.now();
  if (remaining > marginMs) return credential;
  return refreshCredentialToken(credential.id);
}

/**
 * Provider-specific data that must live next to the token for the curated
 * connector to work (Salesforce instance URL, Atlassian cloud id, and display
 * metadata for the vault).
 */
export async function gatherConnectionProfile(
  client: ResolvedOAuthClient,
  tokens: OAuthTokens,
): Promise<{ secret: Record<string, unknown>; metadata: Record<string, unknown> }> {
  const secret: Record<string, unknown> = {};
  const metadata: Record<string, unknown> = {};
  const raw = tokens.raw as {
    instance_url?: unknown;
    team?: { name?: unknown; id?: unknown };
    bot_user_id?: unknown;
    workspace_name?: unknown;
    workspace_id?: unknown;
  };

  if (typeof raw.instance_url === "string" && raw.instance_url) {
    secret.instance_url = raw.instance_url;
    metadata.instance_url = raw.instance_url;
  }
  if (raw.team?.name) metadata.workspace_name = String(raw.team.name);
  if (raw.team?.id) metadata.workspace_id = String(raw.team.id);
  if (raw.bot_user_id) metadata.bot_user_id = String(raw.bot_user_id);
  if (raw.workspace_name) metadata.workspace_name = String(raw.workspace_name);
  if (raw.workspace_id) metadata.workspace_id = String(raw.workspace_id);

  if (client.connectorSlug === "atlassian") {
    const endpoint = await assertSafeOutboundUrl(
      "https://api.atlassian.com/oauth/token/accessible-resources",
      "Atlassian resources endpoint",
    );
    try {
      const response = await fetch(endpoint, {
        headers: { Authorization: `Bearer ${tokens.accessToken}`, Accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const resources = (await response.json()) as {
        id?: string;
        name?: string;
        url?: string;
        scopes?: string[];
      }[];
      const site = resources.find((entry) => entry.id);
      if (!site?.id) throw new Error("no accessible resources");
      secret.cloud_id = site.id;
      metadata.cloud_id = site.id;
      if (site.name) metadata.site_name = site.name;
      if (site.url) metadata.site_url = site.url;
    } catch {
      throw new Error(
        "Atlassian did not return an accessible site for this authorization. Reconnect and grant Jira/Confluence access.",
      );
    }
  }

  return { secret, metadata };
}

/**
 * Creates the vault credential for a completed authorization-code exchange.
 * Existing credentials for the same connector are left alone; the user can
 * revoke old connections in the vault.
 */
export async function createOAuthCredential(input: {
  environmentId: string;
  connectorSlug: string;
  userId: string;
  client: ResolvedOAuthClient;
  tokens: OAuthTokens;
  profile?: { secret: Record<string, unknown>; metadata: Record<string, unknown> };
  name?: string;
}) {
  const environment = await db.environment.findUnique({
    where: { id: input.environmentId },
    select: { projectId: true },
  });
  if (!environment) throw new Error("Environment not found.");

  const { connector } = await import("./connectors");
  const connectorDef = connector(input.connectorSlug);
  const connectorName = connectorDef?.name ?? input.client.label;

  const payload: Record<string, unknown> = {
    access_token: input.tokens.accessToken,
    token_type: input.tokens.tokenType,
    ...(input.tokens.refreshToken ? { refresh_token: input.tokens.refreshToken } : {}),
    ...(input.tokens.expiresAt ? { expires_at: input.tokens.expiresAt.toISOString() } : {}),
    ...(input.profile?.secret ?? {}),
  };
  const metadata = { ...(input.profile?.metadata ?? {}), oauth: true };
  const sealed = await encryptSecret(environment.projectId, payload);

  const credential = await db.credential.create({
    data: {
      environmentId: input.environmentId,
      connectorSlug: input.connectorSlug,
      name: (input.name || `${connectorName} OAuth`).slice(0, 80),
      type: "oauth",
      encryptedPayload: sealed.encryptedPayload,
      dataKeyEncrypted: sealed.dataKeyEncrypted,
      metadataJson: JSON.stringify(metadata),
      maskedHint: `••••${input.tokens.accessToken.slice(-4)}`,
      status: "unverified",
      oauthAppId: input.client.oauthAppId ?? null,
      oauthScopes: JSON.stringify(input.tokens.scopes),
      tokenEndpoint: input.client.tokenUrl,
      tokenExpiresAt: input.tokens.expiresAt ?? null,
      refreshable: Boolean(input.tokens.refreshToken),
      expiresAt: input.tokens.expiresAt ?? null,
      createdBy: input.userId,
      healthEvents: {
        create: {
          result: "connected",
          detail: `Authorized with ${input.client.label} through OAuth${input.tokens.refreshToken ? " with a refresh token" : ""}.`,
        },
      },
    },
  });

  await auditEvent({
    environmentId: input.environmentId,
    actorType: "human",
    actorId: input.userId,
    actorName: "OAuth connect",
    action: "credential.connected",
    resourceType: "credential",
    resourceId: credential.id,
    outcome: "recorded",
    payloadSummary: {
      connector: input.connectorSlug,
      name: credential.name,
      source: input.client.source,
      scopes: input.tokens.scopes.slice(0, 20),
      refreshable: Boolean(input.tokens.refreshToken),
    },
  }).catch(() => null);

  return credential;
}

export function connectCookieOptions() {
  return {
    httpOnly: true as const,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/api/connect",
    maxAge: Math.floor(CONNECT_TTL_MS / 1000),
  };
}

export function stateMatches(expected: string, received: string | null) {
  if (!received) return false;
  return constantTimeEqual(expected, received);
}
