"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getContext, requestMeta } from "@/lib/session";
import { auditEvent } from "@/lib/audit";
import { dispatchEvent } from "@/lib/webhooks";
import { issueIdentityDocumentSafe, visibilityOf } from "@/lib/identity-document";
import { recordRevocation } from "@/lib/revocations";
import {
  TRUST_MAX_NOTE_LENGTH,
  normalizeTrustScopes,
  notifyTrustAdmins,
  shadowAgentName,
} from "@/lib/trust-engine";

function str(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}

async function actor() {
  const ctx = await getContext();
  if (!ctx.can("manage_agents")) redirect("/app/trust?error=capability");
  const meta = await requestMeta();
  return { ctx, meta };
}

function done(query: string): never {
  revalidatePath("/app/trust");
  revalidatePath("/app/agents");
  redirect(`/app/trust?${query}`);
}

export async function inviteTrustAction(formData: FormData) {
  const { ctx, meta } = await actor();
  const externalAgentId = str(formData, "externalAgentId");
  if (!externalAgentId) done("error=agent");
  const note = str(formData, "note").slice(0, TRUST_MAX_NOTE_LENGTH) || null;
  const maxScopes = normalizeTrustScopes(str(formData, "maxScopes").split(/[\n,]+/));

  const external = await db.agent.findUnique({
    where: { id: externalAgentId },
    include: { environment: { include: { project: { include: { org: true } } } } },
  });
  if (!external) done("error=agent_not_found");
  if (external.kind !== "internal") done("error=agent_not_internal");
  if (external.status !== "active") done("error=agent_inactive");
  if (visibilityOf(external.verificationVisibility) === "private") done("error=agent_private");
  if (external.environment.type !== ctx.environment.type) done("error=environment_mismatch");
  if (external.environment.project.orgId === ctx.organizationId) done("error=same_organization");

  const existing = await db.trustRelationship.findUnique({
    where: {
      ownerEnvironmentId_externalAgentId: {
        ownerEnvironmentId: ctx.environment.id,
        externalAgentId: external.id,
      },
    },
  });
  if (existing && (existing.status === "invited" || existing.status === "active")) done("error=exists");

  const data = {
    ownerEnvironmentId: ctx.environment.id,
    externalAgentId: external.id,
    externalEnvironmentId: external.environmentId,
    shadowAgentId: null,
    status: "invited",
    maxScopesJson: JSON.stringify(maxScopes),
    note,
    invitedBy: ctx.user.id,
    invitedAt: new Date(),
    acceptedBy: null,
    acceptedAt: null,
    revokedBy: null,
    revokedAt: null,
  };
  const relationship = existing
    ? await db.trustRelationship.update({ where: { id: existing.id }, data })
    : await db.trustRelationship.create({ data });

  const externalOrg = external.environment.project.org;
  await auditEvent({
    environmentId: ctx.environment.id,
    actorType: "human",
    actorId: ctx.user.id,
    actorName: ctx.user.name,
    action: "trust.invited",
    resourceType: "trust",
    resourceId: relationship.id,
    outcome: "recorded",
    ip: meta.ip,
    payloadSummary: {
      externalAgentId: external.id,
      externalEnvironmentId: external.environmentId,
      externalOrgName: externalOrg.name,
      maxScopes,
    },
  }).catch(() => null);
  await dispatchEvent(ctx.environment.id, "trust.invited", {
    trustRelationshipId: relationship.id,
    externalAgentId: external.id,
    externalAgentName: external.name,
    externalOrgName: externalOrg.name,
    note,
  }).catch(() => null);
  await notifyTrustAdmins({
    externalOrgId: externalOrg.id,
    externalOrgName: externalOrg.name,
    ownerOrgName: ctx.org.name,
    externalAgentName: external.name,
    note,
  }).catch(() => null);

  done("invited=1");
}

export async function acceptTrustAction(formData: FormData) {
  const { ctx, meta } = await actor();
  const id = str(formData, "id");
  const relationship = await db.trustRelationship.findUnique({ where: { id } });
  if (!relationship) done("error=not_found");
  if (relationship.externalEnvironmentId !== ctx.environment.id) done("error=not_external_side");
  if (relationship.status !== "invited") done("error=not_invited");

  const [external, ownerEnvironment] = await Promise.all([
    db.agent.findUnique({ where: { id: relationship.externalAgentId } }),
    db.environment.findUnique({
      where: { id: relationship.ownerEnvironmentId },
      include: { project: { include: { org: true } } },
    }),
  ]);
  if (!external) done("error=agent_not_found");
  if (external.status !== "active") done("error=agent_inactive");
  if (!ownerEnvironment) done("error=owner_missing");

  const { shadow } = await db.$transaction(async (tx) => {
    const shadow = await tx.agent.create({
      data: {
        environmentId: ownerEnvironment.id,
        name: shadowAgentName(external.name, ctx.org.name),
        description: `Cross-organization agent from ${ctx.org.name}. Managed through a trust relationship.`,
        status: "active",
        agentType: external.agentType,
        kind: "external",
        externalAgentId: external.id,
        externalEnvironmentId: external.environmentId,
        externalOrgName: ctx.org.name,
        verificationVisibility: external.verificationVisibility === "private" ? "public" : external.verificationVisibility,
        publicKey: null,
        fingerprint: external.fingerprint,
        keyMode: "external",
        ownerUserId: null,
      },
    });
    await tx.trustRelationship.update({
      where: { id },
      data: { status: "active", shadowAgentId: shadow.id, acceptedBy: ctx.user.id, acceptedAt: new Date() },
    });
    return { shadow };
  });

  await auditEvent({
    environmentId: ownerEnvironment.id,
    actorType: "human",
    actorId: ctx.user.id,
    actorName: ctx.user.name,
    agentId: shadow.id,
    action: "trust.accepted",
    resourceType: "trust",
    resourceId: id,
    outcome: "recorded",
    ip: meta.ip,
    payloadSummary: {
      externalAgentId: external.id,
      externalOrgName: ctx.org.name,
      ownerOrgName: ownerEnvironment.project.org.name,
      shadowAgentId: shadow.id,
    },
  }).catch(() => null);
  await auditEvent({
    environmentId: external.environmentId,
    actorType: "human",
    actorId: ctx.user.id,
    actorName: ctx.user.name,
    agentId: external.id,
    action: "trust.accepted",
    resourceType: "trust",
    resourceId: id,
    outcome: "recorded",
    ip: meta.ip,
    payloadSummary: { ownerOrgName: ownerEnvironment.project.org.name, shadowAgentId: shadow.id },
  }).catch(() => null);
  await dispatchEvent(ownerEnvironment.id, "trust.accepted", {
    trustRelationshipId: id,
    externalAgentId: external.id,
    externalOrgName: ctx.org.name,
    shadowAgentId: shadow.id,
  }).catch(() => null);
  await dispatchEvent(external.environmentId, "trust.accepted", {
    trustRelationshipId: id,
    ownerOrgName: ownerEnvironment.project.org.name,
    shadowAgentId: shadow.id,
  }).catch(() => null);
  await issueIdentityDocumentSafe(shadow.id).catch(() => null);

  done("accepted=1");
}

export async function declineTrustAction(formData: FormData) {
  const { ctx, meta } = await actor();
  const id = str(formData, "id");
  const relationship = await db.trustRelationship.findUnique({ where: { id } });
  if (!relationship) done("error=not_found");
  if (relationship.externalEnvironmentId !== ctx.environment.id) done("error=not_external_side");
  if (relationship.status !== "invited") done("error=not_invited");

  await db.trustRelationship.update({ where: { id }, data: { status: "declined" } });
  for (const environmentId of [relationship.ownerEnvironmentId, relationship.externalEnvironmentId]) {
    await auditEvent({
      environmentId,
      actorType: "human",
      actorId: ctx.user.id,
      actorName: ctx.user.name,
      action: "trust.declined",
      resourceType: "trust",
      resourceId: id,
      outcome: "recorded",
      ip: meta.ip,
      payloadSummary: { externalAgentId: relationship.externalAgentId },
    }).catch(() => null);
  }
  done("declined=1");
}

export async function revokeTrustAction(formData: FormData) {
  const { ctx, meta } = await actor();
  const id = str(formData, "id");
  const relationship = await db.trustRelationship.findUnique({ where: { id } });
  if (!relationship) done("error=not_found");
  const side =
    relationship.ownerEnvironmentId === ctx.environment.id
      ? "owner"
      : relationship.externalEnvironmentId === ctx.environment.id
        ? "external"
        : null;
  if (!side) done("error=not_a_party");
  if (relationship.status === "revoked") done("revoked=1");

  const now = new Date();
  await db.$transaction(async (tx) => {
    await tx.trustRelationship.update({
      where: { id },
      data: { status: "revoked", revokedBy: ctx.user.id, revokedAt: now },
    });
    if (relationship.shadowAgentId) {
      await tx.agent.updateMany({ where: { id: relationship.shadowAgentId }, data: { status: "revoked" } });
    }
  });
  if (relationship.shadowAgentId) {
    await recordRevocation(relationship.shadowAgentId, relationship.ownerEnvironmentId, "owner_revoked");
  }
  for (const environmentId of [relationship.ownerEnvironmentId, relationship.externalEnvironmentId]) {
    await auditEvent({
      environmentId,
      actorType: "human",
      actorId: ctx.user.id,
      actorName: ctx.user.name,
      action: "trust.revoked",
      resourceType: "trust",
      resourceId: id,
      outcome: "recorded",
      ip: meta.ip,
      payloadSummary: {
        externalAgentId: relationship.externalAgentId,
        shadowAgentId: relationship.shadowAgentId,
        revokedBySide: side,
      },
    }).catch(() => null);
    await dispatchEvent(environmentId, "trust.revoked", {
      trustRelationshipId: id,
      externalAgentId: relationship.externalAgentId,
      shadowAgentId: relationship.shadowAgentId,
      revokedBySide: side,
    }).catch(() => null);
  }

  done("revoked=1");
}
