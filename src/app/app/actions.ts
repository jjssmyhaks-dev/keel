"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getContext, destroySession, setActiveEnvironment, requestMeta } from "@/lib/session";
import { encryptSecret, decryptSecret, generateAgentIdentity, generateApiKey, randomToken, sha256 } from "@/lib/crypto";
import { auditEvent } from "@/lib/audit";
import { dispatchEvent } from "@/lib/webhooks";
import { decideApproval } from "@/lib/approvals";
import { signAgentToken } from "@/lib/jwt";
import { promoteAgent } from "@/lib/promotion";
import { sendEmail, appUrl } from "@/lib/email";
import { PLANS } from "@/lib/plans";

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
  if (agent.keyMode === "client") redirect(`${back}?error=client_key`);

  const identity = generateAgentIdentity();
  const sealed = await encryptSecret(ctx.project.id, { privateKey: identity.privateKey });
  const meta = await orgActor(ctx);

  await db.$transaction([
    db.agent.update({
      where: { id: agent.id },
      data: { publicKey: identity.publicKey, fingerprint: identity.fingerprint },
    }),
    db.agentKey.create({
      data: {
        agentId: agent.id,
        publicKey: identity.publicKey,
        encryptedPrivateKey: JSON.stringify(sealed),
        status: "active",
      },
    }),
    db.agentKey.updateMany({
      where: { agentId: agent.id },
      data: { status: "rotating", retireAt: new Date(Date.now() + 7 * 86400_000) },
    }),
  ]);

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
  revalidatePath(back);
  redirect(`${back}?rotated=1`);
}

export async function createAgentAction(formData: FormData) {
  const ctx = await getContext();
  if (!ctx.capabilities.manageAgents) redirect("/app/agents?error=permission");
  if (ctx.isProduction && !ctx.capabilities.writeProduction) redirect("/app/agents?error=production");

  const name = str(formData, "name").slice(0, 60);
  const description = str(formData, "description").slice(0, 400);
  const framework = str(formData, "framework").slice(0, 60);
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
    payloadSummary: { name, keyMode: "platform", fingerprint: identity.fingerprint },
  });
  await dispatchEvent(ctx.environment.id, "agent.registered", {
    agentId: agent.id,
    name,
    fingerprint: identity.fingerprint,
    environment: ctx.environment.type,
  });
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
  const meta = await orgActor(ctx);

  await db.agent.update({
    where: { id: agent.id },
    data: {
      description: description || null,
      framework: framework || null,
      tagsJson: JSON.stringify(tags),
      autonomousMode,
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
    payloadSummary: { name: agent.name, autonomousMode, tags },
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

  const { connector } = await import("@/lib/connectors");
  const connectorDef = connector(connectorSlug);
  if (!connectorDef) redirect("/app/vault/new?error=connector");
  const secretsPath = `/app/vault/new?connector=${connectorSlug}&error=secret`;

  const type = str(formData, "type") || connectorDef.defaultAuth;
  const payload: Record<string, unknown> = {};
  const metadata: Record<string, unknown> = {};
  let maskedHint = "";

  if (connectorDef.credentialFields?.length) {
    for (const field of connectorDef.credentialFields) {
      const value = str(formData, `field_${field.key}`);
      if (!value) continue;
      payload[field.key] = value;
      if (field.secret) {
        if (!maskedHint) maskedHint = `••••${value.slice(-4)}`;
      } else {
        metadata[field.key] = value;
      }
    }
    const missing = connectorDef.credentialFields.filter((field) => field.required && !payload[field.key]);
    if (missing.length) redirect(secretsPath);
    if (connectorDef.requireAnyFields?.length && !connectorDef.requireAnyFields.some((key) => payload[key])) {
      redirect(secretsPath);
    }
    if (!maskedHint && connectorDef.credentialFields.some((field) => field.secret)) redirect(secretsPath);
  } else {
    const secret = str(formData, "secret");
    if (!secret) redirect(secretsPath);
    const key = type === "api_key" ? "apiKey" : type === "oauth" ? "accessToken" : "token";
    payload[key] = secret;
    maskedHint = `••••${secret.slice(-4)}`;
  }

  const sealed = await encryptSecret(ctx.project.id, payload);
  const credential = await db.credential.create({
    data: {
      environmentId: ctx.environment.id,
      connectorSlug,
      name: name || connectorDef.name,
      type,
      encryptedPayload: sealed.encryptedPayload,
      dataKeyEncrypted: sealed.dataKeyEncrypted,
      metadataJson: JSON.stringify(metadata),
      maskedHint,
      status: "healthy",
      createdBy: ctx.user.id,
      healthEvents: { create: { result: "ok", detail: "Connection stored and encrypted." } },
    },
  });

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
    payloadSummary: { connector: connectorSlug, name: credential.name, type },
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
    where: { id: credentialId, environmentId: ctx.environment.id },
  });
  if (!credential) redirect(`${back}?error=missing`);
  if (credential.revokedAt) redirect(`${back}?error=revoked`);

  const { connector } = await import("@/lib/connectors");
  const connectorDef = connector(credential.connectorSlug);
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
      status: "healthy",
      healthDetail: null,
      revokedAt: null,
      healthEvents: { create: { result: "ok", detail: "Secret rotated by a human." } },
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
    where: { id: credentialId, environmentId: ctx.environment.id },
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
    db.credential.findFirst({ where: { id: credentialId, environmentId: ctx.environment.id } }),
  ]);
  if (!agent || !credential) redirect(`${back}?error=missing`);

  const actions = formData.getAll("actions").map(String).filter(Boolean);
  if (!actions.length) {
    await db.grant.deleteMany({ where: { agentId: agent.id, credentialId: credential.id } });
    const meta = await orgActor(ctx);
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
      beforeJson: before ? JSON.stringify({ actions: JSON.parse(before.actionsJson), resource: before.resourcePattern, approvalMode: before.approvalMode }) : "{}",
      afterJson: JSON.stringify({ actions, resource: resourcePattern, approvalMode }),
    },
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
    payloadSummary: { agent: agent.name, connector: credential.connectorSlug, actions, resource: resourcePattern, approvalMode },
  });
  revalidatePath("/app", "layout");
  redirect(`${back}?saved=1`);
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
    include: { grants: true },
  });
  if (!agent) return { error: "Agent not found." };
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
  const email = str(formData, "email").toLowerCase();
  const role = str(formData, "role") || "developer";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) redirect("/app/team?error=email");
  if (!["admin", "developer", "approver", "viewer"].includes(role)) redirect("/app/team?error=role");

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
  await sendEmail({
    to: email,
    subject: `${ctx.user.name} invited you to ${ctx.org.name} on Keel`,
    html: `<p>${ctx.user.name} invited you to join <strong>${ctx.org.name}</strong> as a ${role}.</p><p><a href="${appUrl(`/invite/${token}`)}">Accept the invitation</a>. This link expires in 7 days.</p>`,
    text: `${ctx.user.name} invited you to ${ctx.org.name} as a ${role}. Accept: ${appUrl(`/invite/${token}`)}`,
  }).catch(() => null);
  revalidatePath("/app/team");
  redirect(`/app/team?invited=${encodeURIComponent(email)}`);
}

export async function changeRoleAction(formData: FormData) {
  const ctx = await getContext();
  if (!ctx.capabilities.manageTeam) redirect("/app/team?error=permission");
  const userId = str(formData, "userId");
  const role = str(formData, "role");
  if (!["owner", "admin", "developer", "approver", "viewer"].includes(role)) redirect("/app/team?error=role");
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
  if (!name) redirect("/app/settings?error=name");
  if (billingEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(billingEmail)) redirect("/app/settings?error=email");

  const billingFields = ctx.capabilities.manageBilling
    ? { billingEmail: billingEmail || null, billingCurrency: currency }
    : {};

  await db.organization.update({
    where: { id: ctx.org.id },
    data: { name, ...billingFields },
  });
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
    payloadSummary: { name, ...(ctx.capabilities.manageBilling ? { billingEmail, currency } : {}) },
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
      body: `${ctx.user.name} requested a move from ${ctx.org.plan} to ${plan.name}. Billing will confirm by email.`,
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
    subject: `Keel plan change requested — ${plan.name}`,
    text: `Hi ${ctx.user.name},\n\nWe received a request to move ${ctx.org.name} from ${ctx.org.plan} to ${plan.name}. A member of the billing team will reply to confirm pricing and activation.\n\nCurrent workspace: ${appUrl("/app/billing")}\n\n— Keel`,
    html: `<p>Hi ${ctx.user.name},</p><p>We received a request to move <strong>${ctx.org.name}</strong> from ${ctx.org.plan} to <strong>${plan.name}</strong>. A member of the billing team will reply to confirm pricing and activation.</p><p><a href="${appUrl("/app/billing")}">Open billing</a></p><p>— Keel</p>`,
  }).catch(() => null);

  revalidatePath("/app/billing");
  revalidatePath("/app/notifications");
  redirect(`/app/billing?requested=${plan.key}`);
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

export async function updateEnvironmentSettingsAction(formData: FormData) {
  const ctx = await getContext();
  if (!ctx.capabilities.manageSecurity) redirect("/app/security?error=permission");
  let current: Record<string, unknown> = {};
  try {
    current = JSON.parse(ctx.environment.settingsJson || "{}");
  } catch {}
  const mockMode = bool(formData, "mockMode");
  const approvalExpiryMinutes = Math.min(Math.max(Number(str(formData, "approvalExpiryMinutes") || 60), 5), 1440);
  const agentRateLimitPerMinute = Math.min(Math.max(Number(str(formData, "agentRateLimitPerMinute") || 120), 10), 5000);
  const allowedDomains = str(formData, "allowedDomains");
  const ipAllowlist = str(formData, "ipAllowlist");
  const next = {
    ...current,
    mockMode,
    approvalExpiryMinutes,
    agentRateLimitPerMinute,
    allowedDomains,
    ipAllowlist,
  };
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
    payloadSummary: { mockMode, approvalExpiryMinutes, agentRateLimitPerMinute },
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
  await db.alertRule.create({
    data: {
      environmentId: ctx.environment.id,
      type,
      configJson: JSON.stringify({ threshold, windowMinutes }),
      channelsJson: JSON.stringify(["email"]),
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

export async function markNotificationsReadAction(formData: FormData) {
  const ctx = await getContext();
  const back = str(formData, "back") || "/app";
  await db.notification.updateMany({
    where: { orgId: ctx.org.id, userId: ctx.user.id, readAt: null },
    data: { readAt: new Date() },
  });
  revalidatePath("/app", "layout");
  redirect(back);
}
