"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { randomToken, sha256 } from "@/lib/crypto";
import { getContext, requestMeta, ROLES, type Role } from "@/lib/session";
import { auditEvent } from "@/lib/audit";
import { assertSafeOutboundUrl } from "@/lib/outbound";
import {
  oidcDiscovery,
  packSsoConfig,
  type OidcConfig,
  type SamlConfig,
  type SsoConfig,
} from "@/lib/sso";

type AssignableRole = Exclude<Role, "owner">;
const ASSIGNABLE_ROLES = ROLES.filter((role): role is AssignableRole => role !== "owner");

function str(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function parseDomainsInput(raw: string): string[] | null {
  if (!raw) return [];
  const domains = raw
    .split(/[,\s]+/)
    .map((entry) => entry.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);
  for (const domain of domains) {
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(domain)) {
      return null;
    }
  }
  return [...new Set(domains)];
}

function parseRole(raw: string, fallback: AssignableRole = "developer"): AssignableRole {
  return ASSIGNABLE_ROLES.includes(raw as AssignableRole) ? (raw as AssignableRole) : fallback;
}

function parseGroupMapping(raw: string): Record<string, string> | null {
  const mapping: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) return null;
    const group = trimmed.slice(0, separator).trim();
    const role = trimmed.slice(separator + 1).trim();
    if (!group || !ASSIGNABLE_ROLES.includes(role as AssignableRole)) return null;
    mapping[group] = role;
  }
  return mapping;
}

async function orgAudit(
  ctx: Awaited<ReturnType<typeof getContext>>,
  action: string,
  resourceId: string,
  payload: Record<string, unknown>,
) {
  const meta = await requestMeta();
  await auditEvent({
    environmentId: ctx.environment.id,
    actorType: "human",
    actorId: ctx.user.id,
    actorName: ctx.user.name,
    action,
    resourceType: "sso_connection",
    resourceId,
    outcome: "recorded",
    ip: meta.ip,
    payloadSummary: payload,
  });
}

export async function createSsoConnectionAction(formData: FormData) {
  const ctx = await getContext();
  if (!ctx.capabilities.manageSecurity) redirect("/app/security/sso?error=permission");

  const type = str(formData, "type") === "saml" ? "saml" : "oidc";
  const name = str(formData, "name").slice(0, 60) || (type === "saml" ? "SAML identity provider" : "OIDC identity provider");
  const domains = parseDomainsInput(str(formData, "domains"));
  if (!domains) redirect("/app/security/sso?error=domains");
  const defaultRole = parseRole(str(formData, "defaultRole"));
  const mapping = parseGroupMapping(str(formData, "groupMapping"));
  if (!mapping) redirect("/app/security/sso?error=mapping");

  let config: SsoConfig;
  try {
    if (type === "oidc") {
      const issuer = str(formData, "issuer").replace(/\/+$/, "");
      const clientId = str(formData, "clientId");
      const clientSecret = str(formData, "clientSecret");
      if (!issuer || !clientId || !clientSecret) redirect("/app/security/sso?error=fields");
      await oidcDiscovery(issuer);
      config = {
        kind: "oidc",
        issuer,
        clientId,
        clientSecret,
        scopes: str(formData, "scopes") || undefined,
        emailClaim: str(formData, "emailClaim") || undefined,
        nameClaim: str(formData, "nameClaim") || undefined,
        groupsClaim: str(formData, "groupsClaim") || undefined,
        assumeMfa: formData.get("assumeMfa") === "on",
      } satisfies OidcConfig;
    } else {
      const entryPoint = str(formData, "entryPoint");
      const idpCert = String(formData.get("idpCert") ?? "").trim();
      if (!entryPoint || !idpCert.includes("BEGIN CERTIFICATE")) {
        redirect("/app/security/sso?error=fields");
      }
      await assertSafeOutboundUrl(entryPoint, "SAML entry point");
      config = {
        kind: "saml",
        entryPoint,
        idpCert,
        idpEntityId: str(formData, "idpEntityId") || undefined,
        emailAttribute: str(formData, "emailAttribute") || undefined,
        nameAttribute: str(formData, "nameAttribute") || undefined,
        groupAttribute: str(formData, "groupAttribute") || undefined,
        assumeMfa: formData.get("assumeMfa") === "on",
      } satisfies SamlConfig;
    }
  } catch (error) {
    console.error("[authab:sso:create]", error);
    redirect("/app/security/sso?error=config");
  }

  const id = randomUUID();
  const sealed = packSsoConfig(config, id);
  await db.ssoConnection.create({
    data: {
      id,
      orgId: ctx.org.id,
      name,
      type,
      domainsJson: JSON.stringify(domains),
      defaultRole,
      groupMappingJson: JSON.stringify(mapping),
      configEncrypted: sealed.configEncrypted,
      configDataKey: sealed.configDataKey,
      createdBy: ctx.user.id,
    },
  });
  await orgAudit(ctx, "sso.connection_created", id, { name, type, domains });
  revalidatePath("/app/security/sso");
  redirect("/app/security/sso?created=1");
}

export async function updateSsoConnectionAction(formData: FormData) {
  const ctx = await getContext();
  if (!ctx.capabilities.manageSecurity) redirect("/app/security/sso?error=permission");
  const id = str(formData, "connectionId");
  const connection = await db.ssoConnection.findUnique({ where: { id } });
  if (!connection || connection.orgId !== ctx.org.id) redirect("/app/security/sso?error=missing");

  const domains = parseDomainsInput(str(formData, "domains"));
  if (!domains) redirect("/app/security/sso?error=domains");
  const defaultRole = parseRole(str(formData, "defaultRole"));
  const mapping = parseGroupMapping(str(formData, "groupMapping"));
  if (!mapping) redirect("/app/security/sso?error=mapping");
  const name = str(formData, "name").slice(0, 60) || connection.name;

  await db.ssoConnection.update({
    where: { id: connection.id },
    data: { name, domainsJson: JSON.stringify(domains), defaultRole, groupMappingJson: JSON.stringify(mapping) },
  });
  await orgAudit(ctx, "sso.connection_updated", connection.id, { name, domains, defaultRole });
  revalidatePath("/app/security/sso");
  redirect("/app/security/sso?saved=1");
}

export async function toggleSsoConnectionAction(formData: FormData) {
  const ctx = await getContext();
  if (!ctx.capabilities.manageSecurity) redirect("/app/security/sso?error=permission");
  const id = str(formData, "connectionId");
  const connection = await db.ssoConnection.findUnique({ where: { id } });
  if (!connection || connection.orgId !== ctx.org.id) redirect("/app/security/sso?error=missing");

  const enable = str(formData, "toggle") === "enable";
  await db.ssoConnection.update({ where: { id: connection.id }, data: { enabled: enable } });
  if (!enable && connection.enforced) {
    await db.ssoConnection.update({ where: { id: connection.id }, data: { enforced: false } });
    await db.organization.update({ where: { id: ctx.org.id }, data: { requireSso: false } });
  }
  await orgAudit(ctx, enable ? "sso.connection_enabled" : "sso.connection_disabled", connection.id, {
    name: connection.name,
  });
  revalidatePath("/app/security/sso");
  redirect(`/app/security/sso?saved=1`);
}

export async function enforceSsoConnectionAction(formData: FormData) {
  const ctx = await getContext();
  if (!ctx.capabilities.manageSecurity) redirect("/app/security/sso?error=permission");
  if (ctx.role !== "owner") redirect("/app/security/sso?error=owner");
  const id = str(formData, "connectionId");
  const connection = await db.ssoConnection.findUnique({ where: { id } });
  if (!connection || connection.orgId !== ctx.org.id) redirect("/app/security/sso?error=missing");
  const enforce = str(formData, "toggle") === "on";
  if (enforce && !connection.enabled) redirect("/app/security/sso?error=disabled");

  await db.$transaction([
    db.ssoConnection.updateMany({ where: { orgId: ctx.org.id }, data: { enforced: false } }),
    db.ssoConnection.update({ where: { id: connection.id }, data: { enforced: enforce } }),
    db.organization.update({ where: { id: ctx.org.id }, data: { requireSso: enforce } }),
  ]);
  await orgAudit(ctx, "sso.enforcement_changed", connection.id, { enforced: enforce, name: connection.name });
  revalidatePath("/app/security/sso");
  redirect(`/app/security/sso?saved=1`);
}

export async function updateHumanIdentityPolicyAction(formData: FormData) {
  const ctx = await getContext();
  if (!ctx.capabilities.manageSecurity) redirect("/app/security/sso?error=permission");
  if (ctx.role !== "owner") redirect("/app/security/sso?error=owner");
  const requireMfa = formData.get("requireMfa") === "on";

  await db.organization.update({ where: { id: ctx.org.id }, data: { requireMfa } });
  const meta = await requestMeta();
  await auditEvent({
    environmentId: ctx.environment.id,
    actorType: "human",
    actorId: ctx.user.id,
    actorName: ctx.user.name,
    action: "sso.enforcement_changed",
    resourceType: "organization",
    resourceId: ctx.org.id,
    outcome: "recorded",
    ip: meta.ip,
    payloadSummary: { requireMfa },
  });
  revalidatePath("/app/security/sso");
  redirect("/app/security/sso?saved=1");
}

export async function deleteSsoConnectionAction(formData: FormData) {
  const ctx = await getContext();
  if (!ctx.capabilities.manageSecurity) redirect("/app/security/sso?error=permission");
  const id = str(formData, "connectionId");
  const connection = await db.ssoConnection.findUnique({ where: { id } });
  if (!connection || connection.orgId !== ctx.org.id) redirect("/app/security/sso?error=missing");

  await db.$transaction([
    db.ssoConnection.delete({ where: { id: connection.id } }),
    db.organization.update({
      where: { id: ctx.org.id },
      data: connection.enforced ? { requireSso: false } : {},
    }),
  ]);
  await orgAudit(ctx, "sso.connection_deleted", connection.id, { name: connection.name, type: connection.type });
  revalidatePath("/app/security/sso");
  redirect("/app/security/sso?deleted=1");
}

export type ScimTokenState = { token?: string; prefix?: string; error?: string };

export async function createScimTokenAction(
  _prev: ScimTokenState,
  formData: FormData,
): Promise<ScimTokenState> {
  const ctx = await getContext();
  if (!ctx.capabilities.manageSecurity) return { error: "Only owners and admins can create SCIM tokens." };
  const name = str(formData, "name").slice(0, 60) || "Identity provider";
  const raw = `scim_${randomToken(24)}`;
  const prefix = `${raw.slice(0, 12)}…${raw.slice(-4)}`;
  await db.scimToken.create({
    data: {
      orgId: ctx.org.id,
      name,
      tokenHash: sha256(raw),
      prefix,
      createdBy: ctx.user.id,
    },
  });
  await orgAudit(ctx, "scim.token_created", prefix, { name });
  revalidatePath("/app/security/sso");
  return { token: raw, prefix };
}

export async function revokeScimTokenAction(formData: FormData) {
  const ctx = await getContext();
  if (!ctx.capabilities.manageSecurity) redirect("/app/security/sso?error=permission");
  const id = str(formData, "tokenId");
  const token = await db.scimToken.findUnique({ where: { id } });
  if (!token || token.orgId !== ctx.org.id) redirect("/app/security/sso?error=missing");
  await db.scimToken.update({ where: { id: token.id }, data: { revokedAt: new Date() } });
  await orgAudit(ctx, "scim.token_revoked", token.prefix, { name: token.name });
  revalidatePath("/app/security/sso");
  redirect("/app/security/sso?saved=1");
}
