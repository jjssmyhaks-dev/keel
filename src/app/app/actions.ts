"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getContext, destroySession, setActiveEnvironment, requestMeta, ROLES, GRANTABLE_CAPABILITIES } from "@/lib/session";
import { encryptSecret, decryptSecret, generateAgentIdentity, generateApiKey, randomToken, sha256 } from "@/lib/crypto";
import { auditEvent } from "@/lib/audit";
import { dispatchEvent } from "@/lib/webhooks";
import { decideApproval } from "@/lib/approvals";
import { signAgentToken } from "@/lib/jwt";
import { promoteAgent } from "@/lib/promotion";
import { sendEmail, appUrl } from "@/lib/email";
import { PLANS } from "@/lib/plans";
import { checkPlanLimit, productionAccess } from "@/lib/limits";
import {
  ConnectorImportError,
  archiveCustomConnector,
  customConnectorAccess,
  importOpenApiConnector,
  resolveConnector,
  rollbackCustomConnector,
} from "@/lib/custom-connectors";
import { storeCredential } from "@/lib/credentials";
import {
  createCheckoutSession,
  createPortalSession,
  ensureStripeCustomer,
  priceIdFor,
  stripeConfigured,
  updateStripeCustomerBilling,
} from "@/lib/stripe";
import { TRIAL_DAYS, parseBillingAddress, trialEligible } from "@/lib/billing-rules";
import { isAgentType } from "@/lib/agent-types";
import { issueIdentityDocumentSafe } from "@/lib/identity-document";
import { recordRevocation } from "@/lib/revocations";
import { recordPolicyEvent } from "@/lib/policy-events";

function str(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}

function bool(form: FormData, key: string) {
  const value = form.get(key);
  return value === "on" || value === "true" || value === "1";
}

async function orgActor(ctx: Awaited<ReturnType<typeof getContext>>) {
  const meta = await requestMeta();
  return { actorId: ctx.user.id, actorName: ctx.user.name, ip: meta.ip };
}

export async function signOutAction() {
  const ctx = await getContext().catch(() => null);
  await destroySession();
  if (ctx) {
    const env = ctx.environment;
    if (env) {
      await auditEvent({
        environmentId: env.id,
        actorType: "human",
        actorId: ctx.user.id,
        actorName: ctx.user.name,
        action: "auth.logout",
        resourceType: "session",
        resourceId: ctx.session.id,
        outcome: "recorded",
      }).catch(() => null);
    }
  }
  redirect("/sign-in");
}

export async function switchEnvironmentAction(formData: FormData) {
  const ctx = await getContext();
  const environmentId = str(formData, "environmentId");
  const target = ctx.environments.find((env) => env.id === environmentId);
  if (!target) redirect("/app");
  if (target.type === "production" && !productionAccess(ctx.org.plan, ctx.org.planStatus).allowed) {
    redirect("/app/upgrade/production");
  }
  await setActiveEnvironment(target.id);
  await auditEvent({
    environmentId: target.id,
    actorType: "human",
    actorId: ctx.user.id,
    actorName: ctx.user.name,
    action: "environment.switched",
    resourceType: "environment",
    resourceId: target.id,
    outcome: "recorded",
    payloadSummary: { to: target.type },
  }).catch(() => null);
  revalidatePath("/app", "layout");
  redirect("/app");
}

export async function setAgentStatusAction(formData: FormData) {
  const ctx = await getContext();
  const agentId = str(formData, "agentId");
  const status = str(formData, "status");
  const back = str(formData, "back") || `/app/agents/${agentId}`;
  if (!ctx.capabilities.manageAgents) redirect(`${back}?error=permission`);
  if (!["active", "paused", "suspended"].includes(status)) redirect(`${back}?error=invalid`);
  if (ctx.isProduction && !ctx.capabilities.writeProduction) redirect(`${back}?error=production`);

  const agent = await db.agent.findFirst({ where: { id: agentId, environmentId: ctx.environment.id } });
  if (!agent) redirect(`${back}?error=missing`);
  if (agent.status === "revoked") redirect(`${back}?error=revoked`);

  const meta = await orgActor(ctx);
  await db.agent.update({ where: { id: agent.id }, data: { status } });
  await auditEvent({
    environmentId: ctx.environment.id,
    actorType: "human",
    actorId: meta.actorId,
    actorName: meta.actorName,
    agentId: agent.id,
    action: status === "active" ? "agent.resumed" : status === "paused" ? "agent.paused" : "agent.suspended",
    resourceType: "agent",
    resourceId: agent.id,
    outcome: "recorded",
    ip: meta.ip,
    payloadSummary: { name: agent.name, from: agent.status, to: status },
  });
  await dispatchEvent(ctx.environment.id, "agent.status_changed", { agentId: agent.id, name: agent.name, status });
  await issueIdentityDocumentSafe(agent.id);
  revalidatePath("/app", "layout");
  redirect(back);
}

export async function killSwitchAction(formData: FormData) {
  const ctx = await getContext();
  const agentId = str(formData, "agentId");
  const back = str(formData, "back") || `/app/agents/${agentId}`;
  if (!ctx.capabilities.killSwitch) redirect(`${back}?error=permission`);
  if (ctx.isProduction && !ctx.capabilities.writeProduction) redirect(`${back}?error=production`);

  const agent = await db.agent.findFirst({ where: { id: agentId, environmentId: ctx.environment.id } });
  if (!agent) redirect(`${back}?error=missing`);
  if (agent.status === "revoked") redirect(`${back}?error=revoked`);

  const meta = await orgActor(ctx);
  await db.$transaction([
    db.agent.update({ where: { id: agent.id }, data: { status: "revoked" } }),
    db.grant.deleteMany({ where: { agentId: agent.id } }),
    db.agentKey.updateMany({ where: { agentId: agent.id }, data: { status: "retired", retireAt: new Date() } }),
  ]);
  await auditEvent({
    environmentId: ctx.environment.id,
    actorType: "human",
    actorId: meta.actorId,
    actorName: meta.actorName,
    agentId: agent.id,
    action: "agent.kill_switch",
    resourceType: "agent",
    resourceId: agent.id,
    outcome: "recorded",
    ip: meta.ip,
    payloadSummary: { name: agent.name, grantsRevoked: true, keysRetired: true },
  });
  await dispatchEvent(ctx.environment.id, "agent.status_changed", {
    agentId: agent.id,
    name: agent.name,
    status: "revoked",
    killSwitch: true,
  });
  await recordRevocation(agent.id, ctx.environment.id, "owner_revoked");
  await issueIdentityDocumentSafe(agent.id);
  revalidatePath("/app", "layout");
  redirect(back);
}

export async function rotateAgentKeyAction(formData: FormData) {
  const ctx = await getContext();
  const agentId = str(formData, "agentId");
  const back = str(formData, "back") || `/app/agents/${agentId}`;
  if (!ctx.capabilities.manageAgents) redirect(`${back}?error=permission`);

  const agent = await db.agent.findFirst({ where: { id: agentId, environmentId: ctx.environment.id } });
  if (!agent) redirect(`${back}?error=missing`);
  if (agent.kind === "external") redirect(`${back}?error=external`);
  if (agent.keyMode === "client") redirect(`${back}?error=client_key`);

  const identity = generateAgentIdentity();
  const sealed = await encryptSecret(ctx.project.id, { privateKey: identity.privateKey });
  const meta = await orgActor(ctx);

  await db.$transaction(async (tx) => {
    await tx.agent.update({
      where: { id: agent.id },
      data: { publicKey: identity.publicKey, fingerprint: identity.fingerprint },
    });
    const newKey = await tx.agentKey.create({
      data: {
        agentId: agent.id,
        publicKey: identity.publicKey,
        encryptedPrivateKey: JSON.stringify(sealed),
        status: "active",
      },
    });
    await tx.agentKey.updateMany({
      where: { agentId: agent.id, id: { not: newKey.id } },
      data: { status: "rotating", retireAt: new Date(Date.now() + 7 * 86400_000) },
    });
  });

  await auditEvent({
    environmentId: ctx.environment.id,
    actorType: "human",
    actorId: meta.actorId,
    actorName: meta.actorName,
    agentId: agent.id,
    action: "agent.key_rotated",
    resourceType: "agent",
    resourceId: agent.id,
    outcome: "recorded",
    ip: meta.ip,
    payloadSummary: { oldFingerprint: agent.fingerprint, newFingerprint: identity.fingerprint, graceDays: 7 },
  });
  await issueIdentityDocumentSafe(agent.id);
  revalidatePath(back);
  redirect(`${back}?rotated=1`);
}

export async function createAgentAction(formData: FormData) {
  const ctx = await getContext();
  if (!ctx.capabilities.manageAgents) redirect("/app/agents?error=permission");
  if (ctx.isProduction && !ctx.capabilities.writeProduction) redirect("/app/agents?error=production");
  if (ctx.isProduction && !productionAccess(ctx.org.plan, ctx.org.planStatus).allowed) redirect("/app/agents/new?error=plan");
  if (!(await checkPlanLimit(ctx.org.id, "agents", ctx.org.plan, ctx.org.planStatus)).allowed) {
    redirect("/app/agents/new?error=limit");
  }

  const name = str(formData, "name").slice(0, 60);
  const description = str(formData, "description").slice(0, 400);
  const framework = str(formData, "framework").slice(0, 60);
  const agentType = str(formData, "type") || "other";
  if (!isAgentType(agentType)) redirect("/app/agents/new?error=type");
  const tags = str(formData, "tags")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 12);
  if (name.length < 2) redirect("/app/agents/new?error=name");

  const exists = await db.agent.findFirst({ where: { environmentId: ctx.environment.id, name } });
  if (exists) redirect("/app/agents/new?error=duplicate");

  const identity = generateAgentIdentity();
  const sealed = await encryptSecret(ctx.project.id, { privateKey: identity.privateKey });
  const agent = await db.agent.create({
    data: {
      environmentId: ctx.environment.id,
      name,
      description: description || null,
      ownerUserId: ctx.user.id,
      publicKey: identity.publicKey,
      fingerprint: identity.fingerprint,
      agentType,
      keyMode: "platform",
      tagsJson: JSON.stringify(tags),
      framework: framework || null,
      keys: {
        create: {
          publicKey: identity.publicKey,
          encryptedPrivateKey: JSON.stringify(sealed),
          status: "active",
        },
      },
    },
  });

  const meta = await orgActor(ctx);
  await auditEvent({
    environmentId: ctx.environment.id,
    actorType: "human",
    actorId: meta.actorId,
    actorName: meta.actorName,
    agentId: agent.id,
    action: "agent.registered",
    resourceType: "agent",
    resourceId: agent.id,
    outcome: "recorded",
    ip: meta.ip,
    payloadSummary: { name, keyMode: "platform", fingerprint: identity.fingerprint, type: agentType },
  });
  await dispatchEvent(ctx.environment.id, "agent.registered", {
    agentId: agent.id,
    name,
    fingerprint: identity.fingerprint,
    environment: ctx.environment.type,
  });
  await issueIdentityDocumentSafe(agent.id);
  revalidatePath("/app", "layout");
  redirect(`/app/agents/${agent.id}?created=1`);
}

export async function updateAgentAction(formData: FormData) {
  const ctx = await getContext();
  const agentId = str(formData, "agentId");
  const back = `/app/agents/${agentId}`;
  if (!ctx.capabilities.manageAgents) redirect(`${back}?error=permission`);

  const agent = await db.agent.findFirst({ where: { id: agentId, environmentId: ctx.environment.id } });
  if (!agent) redirect(`${back}?error=missing`);

  const description = str(formData, "description").slice(0, 400);
  const framework = str(formData, "framework").slice(0, 60);
  const tags = str(formData, "tags")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 12);
  const autonomousMode = bool(formData, "autonomousMode");
  const agentType = str(formData, "type") || agent.agentType;
  if (!isAgentType(agentType)) redirect(`${back}?error=type`);
  const meta = await orgActor(ctx);

  await db.agent.update({
    where: { id: agent.id },
    data: {
      description: description || null,
      framework: framework || null,
      tagsJson: JSON.stringify(tags),
      autonomousMode,
      agentType,
    },
  });
  await auditEvent({
    environmentId: ctx.environment.id,
    actorType: "human",
    actorId: meta.actorId,
    actorName: meta.actorName,
    agentId: agent.id,
    action: "agent.updated",
    resourceType: "agent",
    resourceId: agent.id,
    outcome: "recorded",
    ip: meta.ip,
    payloadSummary: { name: agent.name, autonomousMode, tags, type: agentType },
  });
  revalidatePath(back);
  redirect(`${back}?saved=1`);
}

export async function createCredentialAction(formData: FormData) {
  const ctx = await getContext();
  if (!ctx.capabilities.manageCredentials) redirect("/app/vault?error=permission");
  if (ctx.isProduction && !ctx.capabilities.writeProduction) redirect("/app/vault?error=production");

  const connectorSlug = str(formData, "connector");
  const name = str(formData, "name").slice(0, 80);

  if (ctx.isProduction && !productionAccess(ctx.org.plan, ctx.org.planStatus).allowed) {
    redirect(`/app/vault/new?connector=${connectorSlug}&error=plan`);
  }
  if (!(await checkPlanLimit(ctx.org.id, "credentials", ctx.org.plan, ctx.org.planStatus)).allowed) {
    redirect(`/app/vault/new?connector=${connectorSlug}&error=limit`);
  }

  const connectorDef = await resolveConnector(connectorSlug, ctx.environment.id);
  if (!connectorDef) redirect("/app/vault/new?error=connector");
  const secretsPath = `/app/vault/new?connector=${connectorSlug}&error=secret`;

  const type = str(formData, "type") || connectorDef.defaultAuth;
  const fields: Record<string, string> = {};
  if (connectorDef.credentialFields?.length) {
    for (const field of connectorDef.credentialFields) {
      const value = str(formData, `field_${field.key}`);
      if (value) fields[field.key] = value;
    }
  } else {
    const secret = str(formData, "secret");
    if (secret) fields.secret = secret;
  }

  const stored = await storeCredential({
    projectId: ctx.project.id,
    environmentId: ctx.environment.id,
    connectorSlug,
    name: name || connectorDef.name,
    type,
    fields,
    createdBy: ctx.user.id,
  });
  if (!stored.ok) redirect(secretsPath);
  const credential = stored.credential;

  const meta = await orgActor(ctx);
  await auditEvent({
    environmentId: ctx.environment.id,
    actorType: "human",
    actorId: meta.actorId,
    actorName: meta.actorName,
    action: "credential.created",
    resourceType: "credential",
    resourceId: credential.id,
    outcome: "recorded",
    ip: meta.ip,
    payloadSummary: { connector: connectorSlug, name: credential.name, type: credential.type },
  });
  revalidatePath("/app", "layout");
  redirect(`/app/vault/${credential.id}?created=1`);
}

export async function rotateCredentialAction(formData: FormData) {
  const ctx = await getContext();
  const credentialId = str(formData, "credentialId");
  const back = `/app/vault/${credentialId}`;
  if (!ctx.capabilities.manageCredentials) redirect(`${back}?error=permission`);

  const credential = await db.credential.findFirst({
    where: { id: credentialId, environmentId: ctx.environment.id, endUserId: null },
  });
  if (!credential) redirect(`${back}?error=missing`);
  if (credential.revokedAt) redirect(`${back}?error=revoked`);

  const connectorDef = await resolveConnector(credential.connectorSlug, ctx.environment.id);
  let sealed: { encryptedPayload: string; dataKeyEncrypted: string };
  let maskedHint = credential.maskedHint;
  let metadata: Record<string, unknown> = {};
  try {
    metadata = JSON.parse(credential.metadataJson || "{}") as Record<string, unknown>;
  } catch {}

  if (connectorDef?.credentialFields?.length) {
    let existing: Record<string, unknown> = {};
    if (credential.encryptedPayload && credential.dataKeyEncrypted) {
      existing = (await decryptSecret(
        ctx.project.id,
        credential.encryptedPayload,
        credential.dataKeyEncrypted,
      )) as Record<string, unknown>;
    }
    const payload = { ...existing };
    let changed = false;
    for (const field of connectorDef.credentialFields) {
      const value = str(formData, `field_${field.key}`);
      if (!value) continue;
      payload[field.key] = value;
      changed = true;
      if (field.secret) {
        maskedHint = `••••${value.slice(-4)}`;
      } else {
        metadata[field.key] = value;
      }
    }
    if (!changed) redirect(`${back}?error=secret`);
    if (connectorDef.credentialFields.some((field) => field.required && !payload[field.key])) {
      redirect(`${back}?error=secret`);
    }
    if (connectorDef.requireAnyFields?.length && !connectorDef.requireAnyFields.some((key) => payload[key])) {
      redirect(`${back}?error=secret`);
    }
    sealed = await encryptSecret(ctx.project.id, payload);
  } else {
    const secret = str(formData, "secret");
    if (!secret) redirect(`${back}?error=secret`);
    const key =
      credential.type === "api_key" ? "apiKey" : credential.type === "oauth" ? "accessToken" : "token";
    sealed = await encryptSecret(ctx.project.id, { [key]: secret });
    maskedHint = `••••${secret.slice(-4)}`;
  }
  const meta = await orgActor(ctx);

  await db.credential.update({
    where: { id: credential.id },
    data: {
      encryptedPayload: sealed.encryptedPayload,
      dataKeyEncrypted: sealed.dataKeyEncrypted,
      metadataJson: JSON.stringify(metadata),
      maskedHint,
      status: "unverified",
      healthDetail: null,
      revokedAt: null,
      healthEvents: { create: { result: "stored", detail: "Secret replaced. Not yet verified by a provider call." } },
    },
  });
  await auditEvent({
    environmentId: ctx.environment.id,
    actorType: "human",
    actorId: meta.actorId,
    actorName: meta.actorName,
    action: "credential.rotated",
    resourceType: "credential",
    resourceId: credential.id,
    outcome: "recorded",
    ip: meta.ip,
    payloadSummary: { connector: credential.connectorSlug, name: credential.name },
  });
  revalidatePath(back);
  redirect(`${back}?rotated=1`);
}

export async function revokeCredentialAction(formData: FormData) {
  const ctx = await getContext();
  const credentialId = str(formData, "credentialId");
  if (!ctx.capabilities.manageCredentials) redirect(`/app/vault/${credentialId}?error=permission`);

  const credential = await db.credential.findFirst({
    where: { id: credentialId, environmentId: ctx.environment.id, endUserId: null },
  });
  if (!credential) redirect("/app/vault?error=missing");

  const meta = await orgActor(ctx);
  await db.credential.update({
    where: { id: credential.id },
    data: {
      revokedAt: new Date(),
      status: "revoked",
      encryptedPayload: "",
      dataKeyEncrypted: "",
    },
  });
  await auditEvent({
    environmentId: ctx.environment.id,
    actorType: "human",
    actorId: meta.actorId,
    actorName: meta.actorName,
    action: "credential.revoked",
    resourceType: "credential",
    resourceId: credential.id,
    outcome: "recorded",
    ip: meta.ip,
    payloadSummary: { connector: credential.connectorSlug, name: credential.name },
  });
  revalidatePath("/app", "layout");
  redirect("/app/vault");
}

export async function saveGrantAction(formData: FormData) {
  const ctx = await getContext();
  const agentId = str(formData, "agentId");
  const credentialId = str(formData, "credentialId");
  const back = `/app/permissions/${agentId}`;
  if (!ctx.capabilities.manageGrants) redirect(`${back}?error=permission`);

  const [agent, credential] = await Promise.all([
    db.agent.findFirst({ where: { id: agentId, environmentId: ctx.environment.id } }),
    db.credential.findFirst({ where: { id: credentialId, environmentId: ctx.environment.id, endUserId: null } }),
  ]);
  if (!agent || !credential) redirect(`${back}?error=missing`);

  const actions = formData.getAll("actions").map(String).filter(Boolean);
  if (!actions.length) {
    const removed = await db.grant.findUnique({
      where: { agentId_credentialId: { agentId: agent.id, credentialId: credential.id } },
    });
    await db.grant.deleteMany({ where: { agentId: agent.id, credentialId: credential.id } });
    const meta = await orgActor(ctx);
    if (removed) {
      await recordPolicyEvent({
        environmentId: ctx.environment.id,
        organizationId: ctx.org.id,
        agentId: agent.id,
        agentType: agent.agentType,
        subject: "grant",
        grantId: removed.id,
        connectorSlug: credential.connectorSlug,
        actions: JSON.parse(removed.actionsJson || "[]"),
        resourcePattern: removed.resourcePattern,
        approvalMode: removed.approvalMode,
        conditions: JSON.parse(removed.conditionsJson || "{}"),
        changeKind: "delete",
      });
    }
    await auditEvent({
      environmentId: ctx.environment.id,
      actorType: "human",
      actorId: meta.actorId,
      actorName: meta.actorName,
      agentId: agent.id,
      action: "grant.deleted",
      resourceType: "grant",
      resourceId: credential.id,
      outcome: "recorded",
      ip: meta.ip,
      payloadSummary: { agent: agent.name, connector: credential.connectorSlug, reason: "no actions selected" },
    });
    revalidatePath(back);
    redirect(`${back}?removed=1`);
  }

  const resourcePattern = str(formData, "resourcePattern") || "*";
  const approvalModeRaw = str(formData, "approvalMode");
  const approvalMode = ["allow", "require_approval", "deny"].includes(approvalModeRaw) ? approvalModeRaw : null;
  const purpose = str(formData, "purpose").slice(0, 200) || null;
  const expiresRaw = str(formData, "expiresAt");
  const justInTime = bool(formData, "justInTime");
  const conditionsJson = str(formData, "conditions") || "{}";
  try {
    JSON.parse(conditionsJson);
  } catch {
    redirect(`${back}?error=conditions`);
  }

  const before = await db.grant.findUnique({
    where: { agentId_credentialId: { agentId: agent.id, credentialId: credential.id } },
  });
  const grant = await db.grant.upsert({
    where: { agentId_credentialId: { agentId: agent.id, credentialId: credential.id } },
    update: {
      actionsJson: JSON.stringify(actions),
      resourcePattern,
      approvalMode,
      purpose,
      conditionsJson,
      expiresAt: expiresRaw ? new Date(expiresRaw) : null,
      justInTime,
      ...(justInTime ? { activatedAt: null } : before?.justInTime ? { activatedAt: new Date() } : {}),
    },
    create: {
      environmentId: ctx.environment.id,
      agentId: agent.id,
      credentialId: credential.id,
      actionsJson: JSON.stringify(actions),
      resourcePattern,
      approvalMode,
      purpose,
      conditionsJson,
      expiresAt: expiresRaw ? new Date(expiresRaw) : null,
      justInTime,
      activatedAt: justInTime ? null : new Date(),
      createdBy: ctx.user.id,
    },
  });

  const meta = await orgActor(ctx);
  await db.permissionChange.create({
    data: {
      environmentId: ctx.environment.id,
      agentId: agent.id,
      credentialId: credential.id,
      actorId: meta.actorId,
      actorName: meta.actorName,
      change: before ? "Grant updated" : "Grant created",
      beforeJson: before ? JSON.stringify({ actions: JSON.parse(before.actionsJson), resource: before.resourcePattern, approvalMode: before.approvalMode, justInTime: before.justInTime }) : "{}",
      afterJson: JSON.stringify({ actions, resource: resourcePattern, approvalMode, justInTime }),
    },
  });

  await recordPolicyEvent({
    environmentId: ctx.environment.id,
    organizationId: ctx.org.id,
    agentId: agent.id,
    agentType: agent.agentType,
    subject: "grant",
    grantId: grant.id,
    connectorSlug: credential.connectorSlug,
    actions,
    resourcePattern,
    approvalMode,
    conditions: JSON.parse(conditionsJson),
    changeKind: before ? "update" : "create",
  });

  await auditEvent({
    environmentId: ctx.environment.id,
    actorType: "human",
    actorId: meta.actorId,
    actorName: meta.actorName,
    agentId: agent.id,
    action: before ? "grant.updated" : "grant.created",
    resourceType: "grant",
    resourceId: grant.id,
    outcome: "recorded",
    ip: meta.ip,
    payloadSummary: { agent: agent.name, connector: credential.connectorSlug, actions, resource: resourcePattern, approvalMode, justInTime },
  });
  revalidatePath("/app", "layout");
  redirect(`${back}?saved=1`);
}

export async function activateGrantAction(formData: FormData) {
  const ctx = await getContext();
  const agentId = str(formData, "agentId");
  const grantId = str(formData, "grantId");
  const back = `/app/permissions/${agentId}`;
  if (!ctx.capabilities.manageGrants) redirect(`${back}?error=permission`);

  const grant = await db.grant.findFirst({ where: { id: grantId, agentId, environmentId: ctx.environment.id } });
  if (!grant) redirect(`${back}?error=missing`);
  if (!grant.justInTime) redirect(`${back}?error=not_jit`);

  const activatedAt = new Date();
  const expiresAt = new Date(activatedAt.getTime() + 60 * 60_000);
  await db.grant.update({
    where: { id: grant.id },
    data: { activatedAt, expiresAt },
  });

  const meta = await orgActor(ctx);
  await auditEvent({
    environmentId: ctx.environment.id,
    actorType: "human",
    actorId: meta.actorId,
    actorName: meta.actorName,
    agentId,
    action: "grant.activated",
    resourceType: "grant",
    resourceId: grant.id,
    outcome: "recorded",
    ip: meta.ip,
    payloadSummary: { agent: agentId, expiresAt: expiresAt.toISOString(), manual: true },
  });
  revalidatePath("/app", "layout");
  redirect(`${back}?activated=1`);
}

export async function decideApprovalAction(formData: FormData) {
  const ctx = await getContext();
  const approvalId = str(formData, "approvalId");
  const back = `/app/approvals/${approvalId}`;
  if (!ctx.capabilities.approve) redirect(`${back}?error=permission`);
  if (ctx.isProduction && !ctx.capabilities.writeProduction) redirect(`${back}?error=production`);

  const approval = await db.approvalRequest.findFirst({
    where: { id: approvalId, environmentId: ctx.environment.id },
  });
  if (!approval) redirect(`/app/approvals?error=missing`);

  const decision = str(formData, "decision") === "approve" ? "approve" : "deny";
  const meta = await requestMeta();
  const result = await decideApproval({
    approvalId: approval.id,
    decision,
    note: str(formData, "note").slice(0, 500) || undefined,
    userId: ctx.user.id,
    userName: ctx.user.name,
    approveAlways: bool(formData, "approveAlways"),
    ip: meta.ip,
  });
  if (!result.ok) redirect(`${back}?error=closed`);
  revalidatePath("/app", "layout");
  redirect(`${back}?decided=${result.status}`);
}

export async function issueTokenAction(
  _prev: { token?: string; expiresAt?: string; error?: string },
  formData: FormData,
): Promise<{ token?: string; expiresAt?: string; error?: string }> {
  const ctx = await getContext();
  if (!ctx.capabilities.manageAgents) return { error: "Only owners, admins and developers can issue agent tokens." };
  const agentId = str(formData, "agentId");
  const agent = await db.agent.findFirst({
    where: { id: agentId, environmentId: ctx.environment.id },
    include: { grants: { where: { endUserId: null } } },
  });
  if (!agent) return { error: "Agent not found." };
  if (agent.kind === "external") return { error: "Shadow agents can only receive tokens through trust-exchange." };
  if (agent.status !== "active") return { error: `Agent is ${agent.status}.` };
  if (agent.keyMode === "client") return { error: "This agent uses a client-held key. Issue tokens from the API with a signed challenge." };

  const scopes = [...new Set(agent.grants.flatMap((grant) => JSON.parse(grant.actionsJson || "[]") as string[]))];
  const issued = await signAgentToken(
    {
      agentId: agent.id,
      environmentId: ctx.environment.id,
      projectId: ctx.project.id,
      organizationId: ctx.org.id,
      principalId: ctx.user.id,
      scopes,
    },
    300,
  );
  const meta = await requestMeta();
  await auditEvent({
    environmentId: ctx.environment.id,
    actorType: "human",
    actorId: ctx.user.id,
    actorName: ctx.user.name,
    agentId: agent.id,
    action: "token.issued",
    resourceType: "token",
    resourceId: issued.tokenId,
    outcome: "recorded",
    ip: meta.ip,
    payloadSummary: { ttl: issued.expiresIn, scopes, method: "dashboard" },
  });
  return { token: issued.token, expiresAt: issued.expiresAt };
}

export async function inviteMemberAction(formData: FormData) {
  const ctx = await getContext();
  if (!ctx.capabilities.manageTeam) redirect("/app/team?error=permission");
  if (!(await checkPlanLimit(ctx.org.id, "members", ctx.org.plan, ctx.org.planStatus)).allowed) redirect("/app/team?error=limit");
  const email = str(formData, "email").toLowerCase();
  const role = str(formData, "role") || "developer";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) redirect("/app/team?error=email");
  if (!["admin", "developer", "approver", "auditor", "billing", "viewer"].includes(role)) redirect("/app/team?error=role");

  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    const membership = await db.membership.findUnique({
      where: { orgId_userId: { orgId: ctx.org.id, userId: existing.id } },
    });
    if (membership) redirect("/app/team?error=already_member");
  }

  const token = randomToken(24);
  await db.invitation.create({
    data: {
      orgId: ctx.org.id,
      email,
      role,
      tokenHash: sha256(token),
      invitedBy: ctx.user.id,
      expiresAt: new Date(Date.now() + 7 * 86400_000),
    },
  });
  const meta = await orgActor(ctx);
  await auditEvent({
    environmentId: ctx.environment.id,
    actorType: "human",
    actorId: meta.actorId,
    actorName: meta.actorName,
    action: "member.invited",
    resourceType: "invitation",
    resourceId: email,
    outcome: "recorded",
    ip: meta.ip,
    payloadSummary: { email, role },
  });
  const delivery = await sendEmail({
    to: email,
    subject: `${ctx.user.name} invited you to ${ctx.org.name} on Authab`,
    html: `<p>${ctx.user.name} invited you to join <strong>${ctx.org.name}</strong> as a ${role}.</p><p><a href="${appUrl(`/invite/${token}`)}">Accept the invitation</a>. This link expires in 7 days.</p>`,
    text: `${ctx.user.name} invited you to ${ctx.org.name} as a ${role}. Accept: ${appUrl(`/invite/${token}`)}`,
  }).catch(() => ({ delivered: false, reason: "error" }));
  revalidatePath("/app/team");
  if (!delivery.delivered) {
    redirect(
      `/app/team?invited=${encodeURIComponent(email)}&delivery=${delivery.reason}&link=${encodeURIComponent(`/invite/${token}`)}`,
    );
  }
  redirect(`/app/team?invited=${encodeURIComponent(email)}`);
}

export async function changeRoleAction(formData: FormData) {
  const ctx = await getContext();
  if (!ctx.capabilities.manageTeam) redirect("/app/team?error=permission");
  const userId = str(formData, "userId");
  const role = str(formData, "role");
  if (!ROLES.includes(role as (typeof ROLES)[number])) redirect("/app/team?error=role");
  const membership = await db.membership.findUnique({
    where: { orgId_userId: { orgId: ctx.org.id, userId } },
  });
  if (!membership) redirect("/app/team?error=missing");
  if (membership.role === "owner" && ctx.role !== "owner") redirect("/app/team?error=permission");
  if (role === "owner" && ctx.role !== "owner") redirect("/app/team?error=permission");
  if (membership.role === "owner" && role !== "owner") {
    const owners = await db.membership.count({ where: { orgId: ctx.org.id, role: "owner" } });
    if (owners <= 1) redirect("/app/team?error=last_owner");
  }

  await db.membership.update({ where: { id: membership.id }, data: { role } });
  const meta = await orgActor(ctx);
  await auditEvent({
    environmentId: ctx.environment.id,
    actorType: "human",
    actorId: meta.actorId,
    actorName: meta.actorName,
    action: "member.role_changed",
    resourceType: "membership",
    resourceId: membership.id,
    outcome: "recorded",
    ip: meta.ip,
    payloadSummary: { userId, from: membership.role, to: role },
  });
  revalidatePath("/app/team");
  redirect("/app/team?saved=1");
}

export async function changePermissionsAction(formData: FormData) {
  const ctx = await getContext();
  if (!ctx.capabilities.manageTeam) redirect("/app/team?error=permission");
  const userId = str(formData, "userId");
  const membership = await db.membership.findUnique({
    where: { orgId_userId: { orgId: ctx.org.id, userId } },
  });
  if (!membership) redirect("/app/team?error=missing");
  if (membership.role === "owner") redirect("/app/team?error=owner");

  const requested = formData
    .getAll("permissions")
    .map(String)
    .filter((capability) => GRANTABLE_CAPABILITIES.includes(capability as (typeof GRANTABLE_CAPABILITIES)[number]));
  // Nobody can hand out a capability they do not hold themselves.
  const granted = [...new Set(requested.filter((capability) => ctx.can(capability as Parameters<typeof ctx.can>[0])))];

  await db.membership.update({
    where: { id: membership.id },
    data: { permissionsJson: JSON.stringify(granted) },
  });
  const meta = await orgActor(ctx);
  await auditEvent({
    environmentId: ctx.environment.id,
    actorType: "human",
    actorId: meta.actorId,
    actorName: meta.actorName,
    action: "member.permissions_changed",
    resourceType: "membership",
    resourceId: membership.id,
    outcome: "recorded",
    ip: meta.ip,
    payloadSummary: {
      userId,
      role: membership.role,
      before: membership.permissionsJson,
      after: granted,
    },
  });
  revalidatePath("/app/team");
  redirect("/app/team?permissions_saved=1");
}

export async function removeMemberAction(formData: FormData) {
  const ctx = await getContext();
  if (!ctx.capabilities.manageTeam) redirect("/app/team?error=permission");
  const userId = str(formData, "userId");
  if (userId === ctx.user.id) redirect("/app/team?error=self");
  const membership = await db.membership.findUnique({
    where: { orgId_userId: { orgId: ctx.org.id, userId } },
  });
  if (!membership) redirect("/app/team?error=missing");
  if (membership.role === "owner") redirect("/app/team?error=owner");

  await db.membership.delete({ where: { id: membership.id } });
  const meta = await orgActor(ctx);
  await auditEvent({
    environmentId: ctx.environment.id,
    actorType: "human",
    actorId: meta.actorId,
    actorName: meta.actorName,
    action: "member.removed",
    resourceType: "membership",
    resourceId: membership.id,
    outcome: "recorded",
    ip: meta.ip,
    payloadSummary: { userId, role: membership.role },
  });
  revalidatePath("/app/team");
  redirect("/app/team?removed=1");
}

export async function cancelInvitationAction(formData: FormData) {
  const ctx = await getContext();
  if (!ctx.capabilities.manageTeam) redirect("/app/team?error=permission");
  const invitationId = str(formData, "invitationId");
  await db.invitation.deleteMany({ where: { id: invitationId, orgId: ctx.org.id } });
  revalidatePath("/app/team");
  redirect("/app/team?cancelled=1");
}

export async function createApiKeyAction(
  _prev: { key?: string; prefix?: string; type?: string; error?: string },
  formData: FormData,
): Promise<{ key?: string; prefix?: string; type?: string; error?: string }> {
  const ctx = await getContext();
  if (!ctx.capabilities.manageSecurity) return { error: "Only owners and admins can create API keys." };
  if (ctx.isProduction && !ctx.user.emailVerifiedAt) {
    return { error: "Verify your email address before creating production API keys." };
  }
  const type = str(formData, "type") === "publishable" ? "publishable" : "secret";
  if (type === "secret" && ctx.isProduction && !ctx.capabilities.writeProduction) {
    return { error: "You cannot create production secret keys with this role." };
  }
  const name = str(formData, "name").slice(0, 60) || (type === "secret" ? "Server secret key" : "Client publishable key");
  const generated = generateApiKey(ctx.environment.type, type);
  await db.apiKey.create({
    data: {
      environmentId: ctx.environment.id,
      name,
      type,
      keyHash: generated.keyHash,
      prefix: generated.prefix,
    },
  });
  const meta = await requestMeta();
  await auditEvent({
    environmentId: ctx.environment.id,
    actorType: "human",
    actorId: ctx.user.id,
    actorName: ctx.user.name,
    action: "api_key.created",
    resourceType: "api_key",
    resourceId: generated.prefix,
    outcome: "recorded",
    ip: meta.ip,
    payloadSummary: { name, type, environment: ctx.environment.type },
  });
  revalidatePath("/app/developers");
  return { key: generated.key, prefix: generated.prefix, type };
}

export async function revokeApiKeyAction(formData: FormData) {
  const ctx = await getContext();
  if (!ctx.capabilities.manageSecurity) redirect("/app/developers?error=permission");
  const apiKeyId = str(formData, "apiKeyId");
  const key = await db.apiKey.findFirst({ where: { id: apiKeyId, environmentId: ctx.environment.id } });
  if (!key) redirect("/app/developers?error=missing");
  await db.apiKey.update({ where: { id: key.id }, data: { revokedAt: new Date() } });
  const meta = await orgActor(ctx);
  await auditEvent({
    environmentId: ctx.environment.id,
    actorType: "human",
    actorId: meta.actorId,
    actorName: meta.actorName,
    action: "api_key.revoked",
    resourceType: "api_key",
    resourceId: key.id,
    outcome: "recorded",
    ip: meta.ip,
    payloadSummary: { name: key.name, type: key.type },
  });
  revalidatePath("/app/developers");
  redirect("/app/developers?revoked=1");
}

export async function createWebhookAction(formData: FormData) {
  const ctx = await getContext();
  if (!ctx.capabilities.manageSecurity) redirect("/app/developers?error=permission");
  const url = str(formData, "url");
  const { WEBHOOK_EVENTS, assertSafeWebhookUrl } = await import("@/lib/webhooks");
  const known = WEBHOOK_EVENTS.map((event) => event.value) as string[];
  const events = formData.getAll("events").map(String).filter((event) => known.includes(event));
  if (!events.length) redirect("/app/developers?error=events");
  try {
    await assertSafeWebhookUrl(url);
  } catch {
    redirect("/app/developers?error=url");
  }

  const { generateWebhookSecret, storeWebhookSecret } = await import("@/lib/webhooks");
  const secret = generateWebhookSecret();
  const stored = await storeWebhookSecret(ctx.project.id, secret);
  const endpoint = await db.webhookEndpoint.create({
    data: { environmentId: ctx.environment.id, url, secret: stored, eventsJson: JSON.stringify(events) },
  });
  const meta = await orgActor(ctx);
  await auditEvent({
    environmentId: ctx.environment.id,
    actorType: "human",
    actorId: meta.actorId,
    actorName: meta.actorName,
    action: "webhook.created",
    resourceType: "webhook",
    resourceId: endpoint.id,
    outcome: "recorded",
    ip: meta.ip,
    payloadSummary: { url, events },
  });
  revalidatePath("/app/developers");
  redirect(`/app/developers?webhook=${encodeURIComponent(secret)}`);
}

export async function deleteWebhookAction(formData: FormData) {
  const ctx = await getContext();
  if (!ctx.capabilities.manageSecurity) redirect("/app/developers?error=permission");
  const webhookId = str(formData, "webhookId");
  await db.webhookEndpoint.deleteMany({ where: { id: webhookId, environmentId: ctx.environment.id } });
  revalidatePath("/app/developers");
  redirect("/app/developers?deleted=1");
}

export async function revokeSessionAction(formData: FormData) {
  const ctx = await getContext();
  const sessionId = str(formData, "sessionId");
  if (sessionId === ctx.session.id) {
    await destroySession();
    redirect("/sign-in");
  }
  const session = await db.session.findFirst({ where: { id: sessionId, userId: ctx.user.id, revokedAt: null } });
  if (!session) redirect("/app/settings?error=missing");
  await db.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
  const meta = await requestMeta();
  await auditEvent({
    environmentId: ctx.environment.id,
    actorType: "human",
    actorId: ctx.user.id,
    actorName: ctx.user.name,
    action: "auth.logout",
    resourceType: "session",
    resourceId: session.id,
    outcome: "recorded",
    ip: meta.ip,
    payloadSummary: { device: session.device, revokedBy: "self-service" },
  }).catch(() => null);
  revalidatePath("/app/settings");
  redirect("/app/settings?saved=1");
}

export async function updateOrganizationAction(formData: FormData) {
  const ctx = await getContext();
  if (!ctx.capabilities.manageBilling && ctx.role !== "admin") redirect("/app/settings?error=permission");
  const name = str(formData, "name").slice(0, 80);
  const billingEmail = str(formData, "billingEmail").toLowerCase();
  const currency = str(formData, "currency") === "INR" ? "INR" : "USD";
  const taxId = str(formData, "taxId").slice(0, 40);
  const address = {
    line1: str(formData, "billingLine1").slice(0, 120),
    city: str(formData, "billingCity").slice(0, 80),
    postalCode: str(formData, "billingPostalCode").slice(0, 20),
    country: str(formData, "billingCountry").toUpperCase().slice(0, 2),
  };
  if (!name) redirect("/app/settings?error=name");
  if (billingEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(billingEmail)) redirect("/app/settings?error=email");
  if (address.country && !/^[A-Z]{2}$/.test(address.country)) redirect("/app/settings?error=country");

  const billingFields = ctx.capabilities.manageBilling
    ? {
        billingEmail: billingEmail || null,
        billingCurrency: currency,
        taxId: taxId || null,
        billingAddressJson: JSON.stringify(address),
      }
    : {};

  await db.organization.update({
    where: { id: ctx.org.id },
    data: { name, ...billingFields },
  });
  if (ctx.capabilities.manageBilling && stripeConfigured() && ctx.org.stripeCustomerId) {
    await updateStripeCustomerBilling({
      customerId: ctx.org.stripeCustomerId,
      orgName: name,
      email: billingEmail || undefined,
      address,
    }).catch(() => null);
  }
  const meta = await orgActor(ctx);
  await auditEvent({
    environmentId: ctx.environment.id,
    actorType: "human",
    actorId: meta.actorId,
    actorName: meta.actorName,
    action: "settings.updated",
    resourceType: "organization",
    resourceId: ctx.org.id,
    outcome: "recorded",
    ip: meta.ip,
    payloadSummary: {
      name,
      ...(ctx.capabilities.manageBilling ? { billingEmail, currency, taxId, address } : {}),
    },
  });
  revalidatePath("/app", "layout");
  redirect("/app/settings?saved=1");
}

export async function requestPlanChangeAction(formData: FormData) {
  const ctx = await getContext();
  if (!ctx.capabilities.manageBilling) redirect("/app/billing?error=permission");
  const planKey = str(formData, "plan");
  const plan = PLANS.find((candidate) => candidate.key === planKey && candidate.key !== "enterprise");
  if (!plan) redirect("/app/billing?error=plan");

  const meta = await orgActor(ctx);
  await db.notification.create({
    data: {
      orgId: ctx.org.id,
      type: "billing",
      title: `Plan change requested: ${plan.name}`,
      body: `${ctx.user.name} requested a move from ${ctx.org.plan} to ${plan.name}. Billing will follow up with the workspace owner.`,
      href: "/app/billing",
    },
  });
  await auditEvent({
    environmentId: ctx.environment.id,
    actorType: "human",
    actorId: meta.actorId,
    actorName: meta.actorName,
    action: "billing.plan_requested",
    resourceType: "organization",
    resourceId: ctx.org.id,
    outcome: "recorded",
    ip: meta.ip,
    payloadSummary: { from: ctx.org.plan, to: plan.key, billingEmail: ctx.org.billingEmail ?? ctx.user.email },
  });

  const to = ctx.org.billingEmail || ctx.user.email;
  await sendEmail({
    to,
    subject: `Authab plan change requested — ${plan.name}`,
    text: `Hi ${ctx.user.name},\n\nWe received a request to move ${ctx.org.name} from ${ctx.org.plan} to ${plan.name}. A member of the billing team will reply to confirm pricing and activation.\n\nCurrent workspace: ${appUrl("/app/billing")}\n\n— Authab`,
    html: `<p>Hi ${ctx.user.name},</p><p>We received a request to move <strong>${ctx.org.name}</strong> from ${ctx.org.plan} to <strong>${plan.name}</strong>. A member of the billing team will reply to confirm pricing and activation.</p><p><a href="${appUrl("/app/billing")}">Open billing</a></p><p>— Authab</p>`,
  }).catch(() => null);

  revalidatePath("/app/billing");
  revalidatePath("/app/notifications");
  redirect(`/app/billing?requested=${plan.key}`);
}

export async function startCheckoutAction(formData: FormData) {
  const ctx = await getContext();
  if (!ctx.capabilities.manageBilling) redirect("/app/billing?error=permission");
  const planKey = str(formData, "plan");
  const plan = PLANS.find((candidate) => candidate.key === planKey && (candidate.key === "pro" || candidate.key === "scale"));
  if (!plan) redirect("/app/billing?error=plan");
  if (!stripeConfigured()) redirect("/app/billing?error=stripe");

  const currency = ctx.org.billingCurrency === "INR" ? "INR" : "USD";
  const priceId = priceIdFor(plan.key, currency);
  if (!priceId) redirect("/app/billing?error=price");

  let checkoutUrl = "";
  try {
    const customerId = await ensureStripeCustomer({
      orgId: ctx.org.id,
      orgName: ctx.org.name,
      email: ctx.org.billingEmail || ctx.user.email,
      existingCustomerId: ctx.org.stripeCustomerId,
      address: parseBillingAddress(ctx.org.billingAddressJson),
    });
    const session = await createCheckoutSession({
      orgId: ctx.org.id,
      plan: plan.key,
      priceId,
      customerId,
      successUrl: appUrl("/app/billing?checkout=success"),
      cancelUrl: appUrl("/app/billing?checkout=cancelled"),
      trialPeriodDays: trialEligible(ctx.org) ? TRIAL_DAYS : 0,
    });
    checkoutUrl = session.url;
  } catch (error) {
    console.error("[authab:stripe] checkout session failed", error);
    redirect("/app/billing?error=stripe");
  }

  const meta = await orgActor(ctx);
  await auditEvent({
    environmentId: ctx.environment.id,
    actorType: "human",
    actorId: meta.actorId,
    actorName: meta.actorName,
    action: "billing.checkout_started",
    resourceType: "organization",
    resourceId: ctx.org.id,
    outcome: "recorded",
    ip: meta.ip,
    payloadSummary: { plan: plan.key, currency, priceId },
  }).catch(() => null);

  redirect(checkoutUrl);
}

export async function openBillingPortalAction() {
  const ctx = await getContext();
  if (!ctx.capabilities.manageBilling) redirect("/app/billing?error=permission");
  if (!stripeConfigured() || !ctx.org.stripeCustomerId) redirect("/app/billing?error=subscription");

  let portalUrl = "";
  try {
    const session = await createPortalSession({
      customerId: ctx.org.stripeCustomerId,
      returnUrl: appUrl("/app/billing"),
    });
    portalUrl = session.url;
  } catch (error) {
    console.error("[authab:stripe] portal session failed", error);
    redirect("/app/billing?error=stripe");
  }

  redirect(portalUrl);
}

export async function updateProjectAction(formData: FormData) {
  const ctx = await getContext();
  if (!ctx.capabilities.manageSecurity) redirect("/app/settings?error=permission");
  const name = str(formData, "name").slice(0, 80);
  if (!name) redirect("/app/settings?error=name");
  await db.project.update({ where: { id: ctx.project.id }, data: { name } });
  revalidatePath("/app", "layout");
  redirect("/app/settings?saved=1");
}

export async function updateDataContributionAction(formData: FormData) {
  const ctx = await getContext();
  if (!ctx.capabilities.manageSecurity) redirect("/app/settings?error=permission");
  const enabled = bool(formData, "enabled");
  if (enabled !== ctx.org.dataContributionEnabled) {
    const meta = await orgActor(ctx);
    await db.$transaction([
      db.organization.update({ where: { id: ctx.org.id }, data: { dataContributionEnabled: enabled } }),
      db.dataContributionChange.create({
        data: { organizationId: ctx.org.id, enabled, changedBy: ctx.user.id },
      }),
    ]);
    await auditEvent({
      environmentId: ctx.environment.id,
      actorType: "human",
      actorId: meta.actorId,
      actorName: meta.actorName,
      action: "org.data_contribution_changed",
      resourceType: "organization",
      resourceId: ctx.org.id,
      outcome: "recorded",
      ip: meta.ip,
      payloadSummary: { enabled },
    });
  }
  revalidatePath("/app", "layout");
  redirect("/app/settings?saved=1");
}

export async function updateEnvironmentSettingsAction(formData: FormData) {
  const ctx = await getContext();
  if (!ctx.capabilities.manageSecurity) redirect("/app/security?error=permission");
  let current: Record<string, unknown> = {};
  try {
    current = JSON.parse(ctx.environment.settingsJson || "{}");
  } catch {}
  const approvalExpiryMinutes = Math.min(Math.max(Number(str(formData, "approvalExpiryMinutes") || 60), 5), 1440);
  const agentRateLimitPerMinute = Math.min(Math.max(Number(str(formData, "agentRateLimitPerMinute") || 120), 10), 5000);
  const allowedDomains = str(formData, "allowedDomains");
  const ipAllowlist = str(formData, "ipAllowlist");
  const slackWebhookUrl = str(formData, "slackWebhookUrl");
  if (slackWebhookUrl && !/^https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]+$/.test(slackWebhookUrl)) {
    redirect("/app/security?error=slack");
  }
  const next: Record<string, unknown> = {
    ...current,
    approvalExpiryMinutes,
    agentRateLimitPerMinute,
    allowedDomains,
    ipAllowlist,
    slackWebhookUrl,
  };
  delete next.mockMode;
  await db.environment.update({
    where: { id: ctx.environment.id },
    data: { settingsJson: JSON.stringify(next) },
  });
  const meta = await orgActor(ctx);
  await auditEvent({
    environmentId: ctx.environment.id,
    actorType: "human",
    actorId: meta.actorId,
    actorName: meta.actorName,
    action: "security.updated",
    resourceType: "environment",
    resourceId: ctx.environment.id,
    outcome: "recorded",
    ip: meta.ip,
    payloadSummary: { approvalExpiryMinutes, agentRateLimitPerMinute },
  });
  revalidatePath("/app/security");
  redirect("/app/security?saved=1");
}

export async function verifyAuditAction(formData: FormData) {
  const ctx = await getContext();
  const back = str(formData, "back") || "/app/activity";
  const { verifyAuditChain } = await import("@/lib/audit");
  const result = await verifyAuditChain(ctx.environment.id);
  const meta = await requestMeta();
  await auditEvent({
    environmentId: ctx.environment.id,
    actorType: "human",
    actorId: ctx.user.id,
    actorName: ctx.user.name,
    action: "audit.verified",
    resourceType: "environment",
    resourceId: ctx.environment.id,
    outcome: result.valid ? "recorded" : "error",
    ip: meta.ip,
    payloadSummary: { checked: result.checked, valid: result.valid },
  });
  revalidatePath(back);
  revalidatePath("/app/security");
  redirect(`${back}?verified=${result.valid ? "ok" : "broken"}&checked=${result.checked}`);
}

export async function promoteAgentAction(formData: FormData) {
  const ctx = await getContext();
  const devAgentId = str(formData, "agentId");
  const back = `/app/promote/${devAgentId}`;
  if (!ctx.capabilities.writeProduction) redirect(`${back}?error=permission`);
  if (ctx.environment.type !== "development") redirect(`${back}?error=environment`);

  const user = ctx.user;
  const result = await promoteAgent({
    devAgentId,
    userId: user.id,
    userName: user.name,
    userEmailVerified: Boolean(user.emailVerifiedAt),
    ip: (await requestMeta()).ip,
  });
  if (!result.ok) redirect(`${back}?error=${encodeURIComponent(result.error)}`);

  const prodEnv = ctx.environments.find((env) => env.type === "production");
  if (prodEnv) await setActiveEnvironment(prodEnv.id);
  revalidatePath("/app", "layout");
  redirect(`/app/agents/${result.agent.id}?promoted=1`);
}

export async function addAlertRuleAction(formData: FormData) {
  const ctx = await getContext();
  if (!ctx.capabilities.manageSecurity) redirect("/app/security?error=permission");
  const type = str(formData, "type");
  const allowed = ["call_spike", "repeated_denials", "new_host", "credential_expiring"];
  if (!allowed.includes(type)) redirect("/app/security?error=type");
  const threshold = Math.max(Number(str(formData, "threshold") || 3), 1);
  const windowMinutes = Math.max(Number(str(formData, "windowMinutes") || 60), 5);
  const channels = formData.getAll("channels").map(String).filter((channel) => ["email", "slack"].includes(channel));
  if (!channels.length) redirect("/app/security?error=channels");
  await db.alertRule.create({
    data: {
      environmentId: ctx.environment.id,
      type,
      configJson: JSON.stringify({ threshold, windowMinutes }),
      channelsJson: JSON.stringify(channels),
    },
  });
  revalidatePath("/app/security");
  redirect("/app/security?saved=1");
}

export async function toggleAlertRuleAction(formData: FormData) {
  const ctx = await getContext();
  if (!ctx.capabilities.manageSecurity) redirect("/app/security?error=permission");
  const id = str(formData, "ruleId");
  const rule = await db.alertRule.findFirst({ where: { id, environmentId: ctx.environment.id } });
  if (!rule) redirect("/app/security?error=missing");
  await db.alertRule.update({ where: { id: rule.id }, data: { enabled: !rule.enabled } });
  revalidatePath("/app/security");
  redirect("/app/security");
}

export async function runAlertChecksAction() {
  const ctx = await getContext();
  if (!ctx.capabilities.manageSecurity) redirect("/app/security?error=permission");
  const { evaluateAlerts } = await import("@/lib/alerts");
  const fired = await evaluateAlerts(ctx.environment.id);
  revalidatePath("/app/security");
  redirect(`/app/security?checked=${fired.length}`);
}

export async function markNotificationsReadAction(formData: FormData) {
  const ctx = await getContext();
  const back = str(formData, "back") || "/app";
  await db.notification.updateMany({
    where: { orgId: ctx.org.id, readAt: null, OR: [{ userId: ctx.user.id }, { userId: null }] },
    data: { readAt: new Date() },
  });
  revalidatePath("/app", "layout");
  redirect(back);
}

export async function importCustomConnectorAction(formData: FormData) {
  const ctx = await getContext();
  if (!ctx.capabilities.manageSecurity) redirect("/app/connectors?error=permission");
  const access = customConnectorAccess(ctx.org.plan, ctx.org.planStatus);
  if (!access.allowed) redirect(`/app/connectors?error=plan&detail=${encodeURIComponent(access.message)}`);

  const spec = String(formData.get("spec") ?? "");
  if (!spec.trim()) redirect("/app/connectors?error=spec");

  let outcome: { slug: string; version: number; warnings: number };
  try {
    const result = await importOpenApiConnector({
      environmentId: ctx.environment.id,
      specText: spec,
      slug: str(formData, "slug") || undefined,
      name: str(formData, "name") || undefined,
      category: str(formData, "category") || undefined,
      color: str(formData, "color") || undefined,
      baseUrl: str(formData, "baseUrl") || undefined,
      authScheme: str(formData, "authScheme") || undefined,
      createdBy: ctx.user.id,
    });
    outcome = { slug: result.connector.slug, version: result.version, warnings: result.warnings.length };
  } catch (error) {
    if (error instanceof ConnectorImportError) {
      redirect(`/app/connectors?error=import&detail=${encodeURIComponent(error.message).slice(0, 300)}`);
    }
    throw error;
  }

  revalidatePath("/app/connectors");
  revalidatePath("/app/vault/new");
  const suffix = outcome.warnings ? `&warnings=${outcome.warnings}` : "";
  redirect(`/app/connectors?imported=${outcome.slug}&version=${outcome.version}${suffix}`);
}

export async function rollbackCustomConnectorAction(formData: FormData) {
  const ctx = await getContext();
  if (!ctx.capabilities.manageSecurity) redirect("/app/connectors?error=permission");
  const access = customConnectorAccess(ctx.org.plan, ctx.org.planStatus);
  if (!access.allowed) redirect(`/app/connectors?error=plan&detail=${encodeURIComponent(access.message)}`);
  const slug = str(formData, "slug");
  const version = Number(str(formData, "version"));
  if (!slug || !Number.isInteger(version) || version < 1) redirect("/app/connectors?error=missing");
  const result = await rollbackCustomConnector({
    environmentId: ctx.environment.id,
    slug,
    version,
    createdBy: ctx.user.id,
  });
  if (!result) redirect("/app/connectors?error=missing");
  revalidatePath("/app/connectors");
  redirect(`/app/connectors?restored=${slug}&version=${result.version}`);
}

export async function archiveCustomConnectorAction(formData: FormData) {
  const ctx = await getContext();
  if (!ctx.capabilities.manageSecurity) redirect("/app/connectors?error=permission");
  const slug = str(formData, "slug");
  if (!slug) redirect("/app/connectors?error=missing");
  const archived = await archiveCustomConnector({
    environmentId: ctx.environment.id,
    slug,
    createdBy: ctx.user.id,
  });
  if (!archived) redirect("/app/connectors?error=missing");
  revalidatePath("/app/connectors");
  revalidatePath("/app/vault/new");
  redirect(`/app/connectors?archived=${slug}`);
}
