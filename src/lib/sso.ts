import { createHash, randomBytes } from "node:crypto";
import { SAML, ValidateInResponseTo, type Profile } from "@node-saml/node-saml";
import { createLocalJWKSet, jwtVerify, type JWTPayload } from "jose";
import { db } from "./db";
import { open, randomToken, seal, sha256, unwrapKey, wrapKey } from "./crypto";
import { assertSafeOutboundUrl } from "./outbound";
import { appUrl } from "./email";
import { checkPlanLimit } from "./limits";
import { beginLogin, type LoginMeta, type LoginOutcome } from "./login";
import { ROLES, type Role } from "./session";

export const SSO_STATE_COOKIE = "authab_sso_state";
const STATE_TTL_MS = 10 * 60_000;

export type OidcConfig = {
  kind: "oidc";
  issuer: string;
  clientId: string;
  clientSecret: string;
  scopes?: string;
  emailClaim?: string;
  nameClaim?: string;
  groupsClaim?: string;
  tokenAuth?: "client_secret_basic" | "client_secret_post";
  assumeMfa?: boolean;
};

export type SamlConfig = {
  kind: "saml";
  entryPoint: string;
  idpCert: string;
  idpEntityId?: string;
  emailAttribute?: string;
  nameAttribute?: string;
  groupAttribute?: string;
  assumeMfa?: boolean;
};

export type SsoConfig = OidcConfig | SamlConfig;

export type SsoProfile = {
  subject: string;
  email: string;
  name: string;
  groups: string[];
  mfa: boolean;
};

export function ssoCallbackUrl(connectionId: string) {
  return appUrl(`/api/sso/${connectionId}/callback`);
}

export function samlAcsUrl(connectionId: string) {
  return appUrl(`/api/sso/${connectionId}/acs`);
}

export function samlEntityId(connectionId: string) {
  return appUrl(`/api/sso/${connectionId}/metadata`);
}

export function safeNextPath(next: string | null | undefined) {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "";
  return next;
}

/* ------------------------------------------------------------------ */
/* Config sealing                                                      */
/* ------------------------------------------------------------------ */

export function packSsoConfig(config: SsoConfig, connectionId: string) {
  const dataKey = randomBytes(32);
  return {
    configEncrypted: seal(dataKey, JSON.stringify(config), `authab:sso:${connectionId}`),
    configDataKey: wrapKey(dataKey),
  };
}

export function unpackSsoConfig(connection: {
  id: string;
  type: string;
  configEncrypted: string;
  configDataKey: string;
}): SsoConfig {
  const key = unwrapKey(connection.configDataKey);
  const parsed = JSON.parse(
    open(key, connection.configEncrypted, `authab:sso:${connection.id}`),
  ) as SsoConfig;
  if (parsed.kind !== connection.type) throw new Error("SSO connection configuration is inconsistent.");
  return parsed;
}

/* ------------------------------------------------------------------ */
/* OIDC                                                                */
/* ------------------------------------------------------------------ */

type OidcDiscovery = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
};

const discoveryCache = new Map<string, { value: OidcDiscovery; expiresAt: number }>();

async function fetchJson(url: string, label: string, init?: RequestInit) {
  const safe = await assertSafeOutboundUrl(url, label);
  const response = await fetch(safe, {
    ...init,
    redirect: "manual",
    signal: AbortSignal.timeout(8000),
    headers: { accept: "application/json", ...(init?.headers ?? {}) },
  });
  if (!response.ok) throw new Error(`${label} responded with HTTP ${response.status}.`);
  return (await response.json()) as Record<string, unknown>;
}

export async function oidcDiscovery(issuer: string): Promise<OidcDiscovery> {
  const cacheKey = issuer.replace(/\/+$/, "");
  const cached = discoveryCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const url = `${cacheKey}/.well-known/openid-configuration`;
  const body = await fetchJson(url, "OIDC discovery document");
  const value = {
    issuer: String(body.issuer ?? ""),
    authorization_endpoint: String(body.authorization_endpoint ?? ""),
    token_endpoint: String(body.token_endpoint ?? ""),
    jwks_uri: String(body.jwks_uri ?? ""),
  };
  if (value.issuer.replace(/\/+$/, "") !== cacheKey) {
    throw new Error("OIDC discovery issuer does not match the configured issuer.");
  }
  if (!value.authorization_endpoint || !value.token_endpoint || !value.jwks_uri) {
    throw new Error("OIDC discovery document is missing required endpoints.");
  }
  await assertSafeOutboundUrl(value.authorization_endpoint, "OIDC authorization endpoint");
  await assertSafeOutboundUrl(value.token_endpoint, "OIDC token endpoint");
  await assertSafeOutboundUrl(value.jwks_uri, "OIDC JWKS endpoint");
  discoveryCache.set(cacheKey, { value, expiresAt: Date.now() + 10 * 60_000 });
  return value;
}

export function pkceChallenge(verifier: string) {
  return createHash("sha256").update(verifier).digest("base64url");
}

export async function oidcAuthorizeUrl(
  connection: { id: string },
  config: OidcConfig,
  input: { state: string; nonce: string; codeChallenge: string },
) {
  const discovery = await oidcDiscovery(config.issuer);
  const url = new URL(discovery.authorization_endpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", ssoCallbackUrl(connection.id));
  url.searchParams.set("scope", config.scopes || "openid email profile");
  url.searchParams.set("state", input.state);
  url.searchParams.set("nonce", input.nonce);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export async function exchangeOidcCode(
  connection: { id: string },
  config: OidcConfig,
  input: { code: string; verifier: string; nonce: string },
): Promise<SsoProfile> {
  const discovery = await oidcDiscovery(config.issuer);
  const tokenUrl = await assertSafeOutboundUrl(discovery.token_endpoint, "OIDC token endpoint");
  const form = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: ssoCallbackUrl(connection.id),
    code_verifier: input.verifier,
  });
  const headers: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded",
    accept: "application/json",
  };
  if ((config.tokenAuth ?? "client_secret_basic") === "client_secret_basic") {
    headers.authorization = `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`;
  } else {
    form.set("client_id", config.clientId);
    form.set("client_secret", config.clientSecret);
  }
  const response = await fetch(tokenUrl, {
    method: "POST",
    redirect: "manual",
    signal: AbortSignal.timeout(8000),
    headers,
    body: form.toString(),
  });
  const body = (await response.json().catch(() => ({}))) as { id_token?: string; error?: string };
  if (!response.ok || !body.id_token) {
    throw new Error(`OIDC token exchange failed${body.error ? `: ${body.error}` : "."}`);
  }

  const jwks = await fetchJson(discovery.jwks_uri, "OIDC JWKS");
  const keys = createLocalJWKSet(jwks as unknown as Parameters<typeof createLocalJWKSet>[0]);
  const { payload } = await jwtVerify(body.id_token, keys, {
    issuer: discovery.issuer,
    audience: config.clientId,
    clockTolerance: 60,
  });
  if (input.nonce && payload.nonce !== input.nonce) {
    throw new Error("OIDC nonce mismatch.");
  }
  return normalizeOidcProfile(payload, config);
}

function stringClaim(payload: JWTPayload, claim: string | undefined, fallback: string) {
  const raw = claim ? payload[claim] : payload[fallback];
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw) && typeof raw[0] === "string") return raw[0];
  return "";
}

function groupClaim(payload: JWTPayload, claim: string) {
  const raw = payload[claim];
  if (Array.isArray(raw)) return raw.filter((entry): entry is string => typeof entry === "string");
  if (typeof raw === "string") return raw.split(/[,\s]+/).filter(Boolean);
  return [];
}

export function normalizeOidcProfile(payload: JWTPayload, config: OidcConfig): SsoProfile {
  const email = stringClaim(payload, config.emailClaim, "email").trim().toLowerCase();
  if (!email) throw new Error("The identity provider did not return an email address.");
  if (payload.email_verified === false) {
    throw new Error("The identity provider reports this email as unverified.");
  }
  const name =
    stringClaim(payload, config.nameClaim, "name") ||
    stringClaim(payload, "preferred_username", "email").split("@")[0] ||
    email;
  const groups = groupClaim(payload, config.groupsClaim || "groups");
  const amr = Array.isArray(payload.amr) ? payload.amr.map(String) : [];
  const acr = typeof payload.acr === "string" ? payload.acr : "";
  const mfa =
    Boolean(config.assumeMfa) ||
    amr.some((entry) => ["mfa", "otp", "hwk", "swk", "totp"].includes(entry)) ||
    /mfa|multi.?factor|urn:.*:mfa/i.test(acr);
  return {
    subject: String(payload.sub ?? ""),
    email,
    name,
    groups,
    mfa,
  };
}

/* ------------------------------------------------------------------ */
/* SAML                                                                */
/* ------------------------------------------------------------------ */

export function samlClient(connection: { id: string }, config: SamlConfig) {
  const entityId = samlEntityId(connection.id);
  return new SAML({
    idpCert: config.idpCert,
    entryPoint: config.entryPoint,
    issuer: entityId,
    audience: entityId,
    callbackUrl: samlAcsUrl(connection.id),
    idpIssuer: config.idpEntityId || undefined,
    wantAssertionsSigned: true,
    wantAuthnResponseSigned: false,
    validateInResponseTo: ValidateInResponseTo.never,
    disableRequestedAuthnContext: true,
    identifierFormat: null,
    acceptedClockSkewMs: 60_000,
    maxAssertionAgeMs: 5 * 60_000,
  });
}

export async function samlAuthorizeUrl(
  connection: { id: string },
  config: SamlConfig,
  relayState: string,
) {
  const client = samlClient(connection, config);
  return client.getAuthorizeUrlAsync(relayState, undefined);
}

function attributeValues(profile: Profile, name: string | undefined) {
  if (!name) return [];
  const raw = profile[name];
  const values = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
  return values.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.trim()).filter(Boolean);
}

export async function validateSamlResponse(
  connection: { id: string },
  config: SamlConfig,
  body: Record<string, string>,
): Promise<{ profile: SsoProfile; relayState: string }> {
  const client = samlClient(connection, config);
  const { profile: raw } = await client.validatePostResponseAsync(body);
  if (!raw) throw new Error("The SAML response did not contain a profile.");

  const emailCandidates = [
    ...attributeValues(raw, config.emailAttribute),
    ...attributeValues(raw, "email"),
    ...attributeValues(raw, "mail"),
    ...attributeValues(raw, "urn:oid:0.9.2342.19200300.100.1.3"),
    raw.mail ?? "",
    raw.email ?? "",
    raw["urn:oid:0.9.2342.19200300.100.1.3"] ?? "",
  ].filter((entry): entry is string => typeof entry === "string" && entry.includes("@"));
  const email = (emailCandidates[0] ?? "").trim().toLowerCase();
  if (!email) throw new Error("The SAML assertion did not contain an email address.");

  const name =
    attributeValues(raw, config.nameAttribute)[0] ||
    attributeValues(raw, "displayName")[0] ||
    attributeValues(raw, "cn")[0] ||
    email.split("@")[0];

  const groups = [
    ...attributeValues(raw, config.groupAttribute),
    ...attributeValues(raw, config.groupAttribute ? undefined : "groups"),
    ...attributeValues(raw, config.groupAttribute ? undefined : "memberOf"),
  ];

  return {
    relayState: String(body.RelayState ?? ""),
    profile: {
      subject: raw.nameID || email,
      email,
      name,
      groups: [...new Set(groups)],
      mfa: Boolean(config.assumeMfa),
    },
  };
}

export function samlMetadata(connection: { id: string }, config: SamlConfig) {
  return samlClient(connection, config).generateServiceProviderMetadata(null, null);
}

/* ------------------------------------------------------------------ */
/* State + domain checks                                               */
/* ------------------------------------------------------------------ */

export type SsoState = {
  connectionId: string;
  next: string;
  nonce?: string;
  verifier?: string;
};

export async function createSsoState(input: SsoState) {
  const token = randomToken(32);
  await db.loginToken.create({
    data: {
      tokenHash: sha256(token),
      type: "sso_state",
      metaJson: JSON.stringify(input),
      expiresAt: new Date(Date.now() + STATE_TTL_MS),
    },
  });
  return token;
}

export async function consumeSsoState(token: string | null, connectionId: string): Promise<SsoState | null> {
  if (!token) return null;
  const row = await db.loginToken.findUnique({ where: { tokenHash: sha256(token) } });
  if (!row || row.type !== "sso_state" || row.usedAt || row.expiresAt < new Date()) return null;
  const claimed = await db.loginToken.updateMany({
    where: { id: row.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (claimed.count !== 1) return null;
  let meta: SsoState;
  try {
    meta = JSON.parse(row.metaJson) as SsoState;
  } catch {
    return null;
  }
  if (meta.connectionId !== connectionId) return null;
  meta.next = safeNextPath(meta.next);
  return meta;
}

export function parseDomains(domainsJson: string) {
  try {
    const parsed = JSON.parse(domainsJson) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim().toLowerCase().replace(/^@/, ""))
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function emailMatchesConnection(connection: { domainsJson: string }, email: string) {
  const domains = parseDomains(connection.domainsJson);
  if (!domains.length) return true;
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  return domains.includes(domain);
}

export function mapSsoRole(
  connection: { defaultRole: string; groupMappingJson: string },
  groups: string[],
) {
  let mapping: Record<string, string> = {};
  try {
    const parsed = JSON.parse(connection.groupMappingJson) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      mapping = Object.fromEntries(
        Object.entries(parsed as Record<string, unknown>).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      );
    }
  } catch {
    mapping = {};
  }
  const assigned = groups.map((group) => mapping[group]).find(Boolean);
  const candidates = [assigned, connection.defaultRole, "developer"];
  for (const candidate of candidates) {
    if (candidate && ROLES.includes(candidate as Role) && candidate !== "owner") {
      return candidate as Role;
    }
  }
  return "developer" as Role;
}

/* ------------------------------------------------------------------ */
/* Login completion                                                    */
/* ------------------------------------------------------------------ */

export type SsoLoginResult =
  | { ok: true; outcome: LoginOutcome; userId: string; orgId: string; role: Role; created: boolean }
  | {
      ok: false;
      reason:
        | "domain"
        | "deleted"
        | "suspended"
        | "limit"
        | "identity_conflict"
        | "missing_subject";
    };

export async function completeSsoLogin(input: {
  connection: {
    id: string;
    orgId: string;
    domainsJson: string;
    defaultRole: string;
    groupMappingJson: string;
  };
  profile: SsoProfile;
  meta: LoginMeta;
  next?: string;
  assumeMfa: boolean;
}): Promise<SsoLoginResult> {
  const { connection, profile, meta } = input;
  if (!profile.email || !profile.email.includes("@")) return { ok: false, reason: "domain" };
  if (!profile.subject) return { ok: false, reason: "missing_subject" };
  if (!emailMatchesConnection(connection, profile.email)) return { ok: false, reason: "domain" };

  const role = mapSsoRole(connection, profile.groups);

  const existingIdentity = await db.ssoIdentity.findUnique({
    where: { connectionId_subject: { connectionId: connection.id, subject: profile.subject } },
    include: { user: true },
  });

  let user = existingIdentity?.user ?? (await db.user.findUnique({ where: { email: profile.email } }));
  let created = false;

  if (user?.deletedAt) return { ok: false, reason: "deleted" };

  const membership = user
    ? await db.membership.findUnique({ where: { orgId_userId: { orgId: connection.orgId, userId: user.id } } })
    : null;
  if (membership && membership.status !== "active") return { ok: false, reason: "suspended" };

  if (!membership) {
    const org = await db.organization.findUnique({
      where: { id: connection.orgId },
      select: { plan: true, planStatus: true },
    });
    if (!org) return { ok: false, reason: "deleted" };
    const quota = await checkPlanLimit(connection.orgId, "members", org.plan, org.planStatus);
    if (!quota.allowed) return { ok: false, reason: "limit" };
  }

  if (!user) {
    user = await db.user.create({
      data: {
        id: crypto.randomUUID(),
        email: profile.email,
        name: profile.name || profile.email.split("@")[0],
        emailVerifiedAt: new Date(),
      },
    });
    created = true;
  } else {
    const updates: { name?: string; emailVerifiedAt?: Date } = {};
    if (!user.emailVerifiedAt) updates.emailVerifiedAt = new Date();
    if (!user.name) updates.name = profile.name;
    if (Object.keys(updates).length) {
      user = await db.user.update({ where: { id: user.id }, data: updates });
    }
  }

  if (existingIdentity) {
    await db.ssoIdentity.update({
      where: { id: existingIdentity.id },
      data: { email: profile.email, lastLoginAt: new Date() },
    });
  } else {
    const linked = await db.ssoIdentity.findFirst({
      where: { connectionId: connection.id, userId: user.id },
    });
    if (linked) {
      if (linked.subject !== profile.subject) {
        const clash = await db.ssoIdentity.findUnique({
          where: { connectionId_subject: { connectionId: connection.id, subject: profile.subject } },
        });
        if (clash) return { ok: false, reason: "identity_conflict" };
        await db.ssoIdentity.update({
          where: { id: linked.id },
          data: { subject: profile.subject, email: profile.email, lastLoginAt: new Date() },
        });
      } else {
        await db.ssoIdentity.update({ where: { id: linked.id }, data: { lastLoginAt: new Date() } });
      }
    } else {
      await db.ssoIdentity.create({
        data: {
          id: crypto.randomUUID(),
          connectionId: connection.id,
          userId: user.id,
          subject: profile.subject,
          email: profile.email,
        },
      });
    }
  }

  if (!membership) {
    await db.membership.create({
      data: {
        id: crypto.randomUUID(),
        orgId: connection.orgId,
        userId: user.id,
        role,
        scimExternalId: null,
      },
    });
  } else if (membership.role !== "owner" && membership.role !== role) {
    await db.membership.update({ where: { id: membership.id }, data: { role } });
  }

  if (!user.onboardedAt) {
    user = await db.user.update({ where: { id: user.id }, data: { onboardedAt: new Date() } });
  }

  await db.ssoConnection.update({ where: { id: connection.id }, data: { lastLoginAt: new Date() } });

  const outcome = await beginLogin(
    user,
    meta,
    {
      next: input.next,
      authMethod: "sso",
      ssoConnectionId: connection.id,
      mfaSatisfied: profile.mfa || input.assumeMfa,
    },
  );

  return { ok: true, outcome, userId: user.id, orgId: connection.orgId, role, created };
}
