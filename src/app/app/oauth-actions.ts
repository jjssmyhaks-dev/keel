"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getContext, requestMeta } from "@/lib/session";
import { auditEvent } from "@/lib/audit";
import { encryptSecret } from "@/lib/crypto";
import { refreshCredentialToken } from "@/lib/oauth-connect";
import { checkCredentialHealth, runHealthChecks } from "@/lib/credential-health";
import { builtinProvider } from "@/lib/oauth-providers";

function str(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

async function actor(ctx: Awaited<ReturnType<typeof getContext>>) {
  const meta = await requestMeta();
  return { id: ctx.user.id, name: ctx.user.name, ip: meta.ip };
}

export async function refreshCredentialAction(formData: FormData) {
  const ctx = await getContext();
  const credentialId = str(formData, "credentialId");
  const back = `/app/vault/${credentialId}`;
  if (!ctx.capabilities.manageCredentials) redirect(`${back}?error=permission`);

  const credential = await db.credential.findFirst({
    where: { id: credentialId, environmentId: ctx.environment.id },
  });
  if (!credential) redirect("/app/vault?error=missing");
  if (credential.revokedAt) redirect(`${back}?error=revoked`);

  try {
    const updated = await refreshCredentialToken(credential.id);
    const meta = await actor(ctx);
    await auditEvent({
      environmentId: ctx.environment.id,
      actorType: "human",
      actorId: meta.id,
      actorName: meta.name,
      action: "credential.refreshed",
      resourceType: "credential",
      resourceId: credential.id,
      outcome: "recorded",
      ip: meta.ip,
      payloadSummary: {
        connector: credential.connectorSlug,
        manual: true,
        expiresAt: updated.tokenExpiresAt?.toISOString() ?? null,
      },
    });
    revalidatePath(back);
    redirect(`${back}?refreshed=1`);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Token refresh failed.";
    revalidatePath(back);
    redirect(`${back}?error=refresh&detail=${encodeURIComponent(detail.slice(0, 200))}`);
  }
}

export async function checkCredentialAction(formData: FormData) {
  const ctx = await getContext();
  const credentialId = str(formData, "credentialId");
  const back = `/app/vault/${credentialId}`;
  if (!ctx.capabilities.manageCredentials) redirect(`${back}?error=permission`);

  const credential = await db.credential.findFirst({
    where: { id: credentialId, environmentId: ctx.environment.id },
  });
  if (!credential) redirect("/app/vault?error=missing");

  const meta = await actor(ctx);
  try {
    const result = await checkCredentialHealth(credential.id);
    await auditEvent({
      environmentId: ctx.environment.id,
      actorType: "human",
      actorId: meta.id,
      actorName: meta.name,
      action: "credential.checked",
      resourceType: "credential",
      resourceId: credential.id,
      outcome: result.outcome === "ok" ? "allowed" : result.outcome === "skipped" ? "recorded" : "error",
      ip: meta.ip,
      payloadSummary: { connector: credential.connectorSlug, result: result.outcome, status: result.status },
    });
    revalidatePath(back);
    redirect(`${back}?checked=${result.outcome}`);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Health check failed.";
    revalidatePath(back);
    redirect(`${back}?error=health&detail=${encodeURIComponent(detail.slice(0, 200))}`);
  }
}

export async function runHealthChecksAction() {
  const ctx = await getContext();
  if (!ctx.capabilities.manageCredentials) redirect("/app/vault?error=permission");
  const summary = await runHealthChecks({
    environmentId: ctx.environment.id,
    force: true,
    limit: 30,
  });
  revalidatePath("/app/vault");
  redirect(
    `/app/vault?health=${summary.healthy}&broken=${summary.broken}&warn=${summary.warnings}&skipped=${summary.skipped}`,
  );
}

export async function saveOAuthAppAction(formData: FormData) {
  const ctx = await getContext();
  if (!ctx.capabilities.manageCredentials) redirect("/app/connect?error=permission");
  if (ctx.isProduction && !ctx.capabilities.writeProduction) redirect("/app/connect?error=production");

  const connectorSlug = str(formData, "connector");
  const provider = builtinProvider(connectorSlug);
  if (!provider) redirect("/app/connect?error=connector");

  const clientId = str(formData, "clientId").slice(0, 300);
  if (!clientId) redirect(`/app/connect?connector=${connectorSlug}&error=client`);

  const existing = await db.oAuthApp.findUnique({
    where: { environmentId_connectorSlug: { environmentId: ctx.environment.id, connectorSlug } },
  });
  const clientSecret = str(formData, "clientSecret");
  if (!existing && !clientSecret) redirect(`/app/connect?connector=${connectorSlug}&error=secret`);

  const scopes = str(formData, "scopes")
    .split(/[,\s]+/)
    .map((scope) => scope.trim())
    .filter(Boolean)
    .slice(0, 40);
  const separator = str(formData, "scopeSeparator") === "," ? "," : " ";
  const tokenAuth = str(formData, "tokenAuth") === "basic" ? "basic" : "body";
  const pkce = formData.get("pkce") === "on" || formData.get("pkce") === "1";

  let sealed = existing
    ? { encryptedPayload: existing.clientSecretEncrypted, dataKeyEncrypted: existing.dataKeyEncrypted }
    : null;
  if (clientSecret) {
    sealed = await encryptSecret(ctx.project.id, { clientSecret });
  }
  if (!sealed) redirect(`/app/connect?connector=${connectorSlug}&error=secret`);

  await db.oAuthApp.upsert({
    where: { environmentId_connectorSlug: { environmentId: ctx.environment.id, connectorSlug } },
    create: {
      environmentId: ctx.environment.id,
      connectorSlug,
      provider: connectorSlug,
      clientId,
      clientSecretEncrypted: sealed.encryptedPayload,
      dataKeyEncrypted: sealed.dataKeyEncrypted,
      scopesJson: JSON.stringify(scopes.length ? scopes : provider.scopes),
      scopeSeparator: separator,
      tokenAuth,
      pkce,
      extraAuthParamsJson: JSON.stringify(provider.extraAuthParams ?? {}),
      enabled: true,
    },
    update: {
      clientId,
      ...(clientSecret
        ? {
            clientSecretEncrypted: sealed.encryptedPayload,
            dataKeyEncrypted: sealed.dataKeyEncrypted,
          }
        : {}),
      scopesJson: JSON.stringify(scopes.length ? scopes : provider.scopes),
      scopeSeparator: separator,
      tokenAuth,
      pkce,
      extraAuthParamsJson: JSON.stringify(provider.extraAuthParams ?? {}),
      enabled: true,
    },
  });

  const meta = await actor(ctx);
  await auditEvent({
    environmentId: ctx.environment.id,
    actorType: "human",
    actorId: meta.id,
    actorName: meta.name,
    action: "oauth_app.saved",
    resourceType: "environment",
    resourceId: ctx.environment.id,
    outcome: "recorded",
    ip: meta.ip,
    payloadSummary: {
      connector: connectorSlug,
      clientId,
      secretRotated: Boolean(clientSecret),
      scopes,
      tokenAuth,
      pkce,
    },
  });
  revalidatePath("/app/connect");
  revalidatePath("/app/vault");
  redirect(`/app/connect?connector=${connectorSlug}&saved=1`);
}

export async function removeOAuthAppAction(formData: FormData) {
  const ctx = await getContext();
  if (!ctx.capabilities.manageCredentials) redirect("/app/connect?error=permission");
  const connectorSlug = str(formData, "connector");
  const app = await db.oAuthApp.findUnique({
    where: { environmentId_connectorSlug: { environmentId: ctx.environment.id, connectorSlug } },
  });
  if (!app) redirect("/app/connect?error=missing");
  await db.oAuthApp.delete({ where: { id: app.id } });

  const meta = await actor(ctx);
  await auditEvent({
    environmentId: ctx.environment.id,
    actorType: "human",
    actorId: meta.id,
    actorName: meta.name,
    action: "oauth_app.removed",
    resourceType: "environment",
    resourceId: ctx.environment.id,
    outcome: "recorded",
    ip: meta.ip,
    payloadSummary: { connector: connectorSlug },
  });
  revalidatePath("/app/connect");
  redirect("/app/connect?removed=1");
}
