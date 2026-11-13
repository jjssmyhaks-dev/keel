"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getContext, requestMeta } from "@/lib/session";
import { auditEvent } from "@/lib/audit";
import { revokeConsentRecord } from "@/lib/consent";
import { revokeEndUserCredential } from "@/lib/control-center";

function back(id: string, query: string) {
  redirect(`/app/end-users/${id}?${query}`);
}

async function scopedEndUser(id: string) {
  const ctx = await getContext();
  const endUser = await db.endUser.findFirst({ where: { id, projectId: ctx.project.id } });
  if (!endUser) redirect("/app/end-users?error=missing");
  return { ctx, endUser };
}

export async function revokeEndUserConsentAction(formData: FormData) {
  const consentId = String(formData.get("consentId") ?? "");
  const ctx = await getContext();
  if (!ctx.can("manage_agents")) redirect("/app/end-users?error=permission");
  const consent = await db.consent.findFirst({
    where: { id: consentId, projectId: ctx.project.id },
    select: { id: true, endUserId: true },
  });
  if (!consent) redirect("/app/end-users?error=missing");
  const meta = await requestMeta();
  await revokeConsentRecord(
    consent.id,
    { actorType: "human", actorId: ctx.user.id, actorName: ctx.user.name },
    { reason: "admin_revoked", ip: meta.ip },
  );
  revalidatePath(`/app/end-users/${consent.endUserId}`);
  back(consent.endUserId, "revoked=1");
}

export async function disconnectEndUserCredentialAction(formData: FormData) {
  const credentialId = String(formData.get("credentialId") ?? "");
  const ctx = await getContext();
  if (!ctx.can("manage_credentials")) redirect("/app/end-users?error=permission");
  const credential = await db.credential.findFirst({
    where: { id: credentialId, endUserId: { not: null }, environment: { projectId: ctx.project.id } },
    select: { id: true, endUserId: true },
  });
  if (!credential?.endUserId) redirect("/app/end-users?error=missing");
  const meta = await requestMeta();
  await revokeEndUserCredential({
    credentialId: credential.id,
    endUserId: credential.endUserId,
    ip: meta.ip,
    actor: { actorType: "human", actorId: ctx.user.id, actorName: ctx.user.name },
  });
  revalidatePath(`/app/end-users/${credential.endUserId}`);
  back(credential.endUserId, "disconnected=1");
}

export async function completeDataRequestAction(formData: FormData) {
  const requestId = String(formData.get("requestId") ?? "");
  const ctx = await getContext();
  if (!ctx.can("manage_security")) redirect("/app/end-users?error=permission");
  const request = await db.dataRequest.findFirst({ where: { id: requestId, projectId: ctx.project.id } });
  if (!request) redirect("/app/end-users?error=missing");
  const updated = await db.dataRequest.updateMany({
    where: { id: request.id, status: "open" },
    data: { status: "completed", completedAt: new Date(), completedBy: ctx.user.name },
  });
  if (updated.count) {
    await auditEvent({
      environmentId: ctx.environment.id,
      actorType: "human",
      actorId: ctx.user.id,
      actorName: ctx.user.name,
      action: "end_user.data_request",
      resourceType: "data_request",
      resourceId: request.id,
      outcome: "recorded",
      payloadSummary: { kind: request.kind, status: "completed", endUserId: request.endUserId },
    }).catch(() => null);
  }
  revalidatePath(`/app/end-users/${request.endUserId}`);
  back(request.endUserId, "request=completed");
}

/**
 * Deletes the end user's data across this project: consents revoked, grants
 * expired, connections destroyed and the profile anonymized. Audit rows stay —
 * the log is append-only and holds ids, never the person's email.
 */
export async function deleteEndUserAction(formData: FormData) {
  const id = String(formData.get("endUserId") ?? "");
  const ctx = await getContext();
  if (!ctx.can("manage_security")) redirect(`/app/end-users/${id}?error=permission`);
  const endUser = await db.endUser.findFirst({ where: { id, projectId: ctx.project.id } });
  if (!endUser || endUser.deletedAt) redirect("/app/end-users?error=missing");
  const confirmation = String(formData.get("confirm") ?? "").trim();
  if (confirmation !== endUser.externalUserId) {
    back(id, "error=confirm");
  }

  const [consents, credentials] = await Promise.all([
    db.consent.findMany({ where: { endUserId: id }, select: { id: true, environmentId: true } }),
    db.credential.findMany({
      where: { endUserId: id, environment: { projectId: ctx.project.id } },
      select: { id: true, environmentId: true, connectorSlug: true },
    }),
  ]);
  const now = new Date();
  await db.$transaction(async (tx) => {
    await tx.consent.updateMany({ where: { endUserId: id, revokedAt: null }, data: { revokedAt: now } });
    await tx.grant.updateMany({
      where: { endUserId: id, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      data: { expiresAt: now },
    });
    await tx.credential.deleteMany({ where: { endUserId: id, environment: { projectId: ctx.project.id } } });
    await tx.dataRequest.updateMany({
      where: { endUserId: id, projectId: ctx.project.id, status: "open" },
      data: { status: "completed", completedAt: now, completedBy: ctx.user.name },
    });
    await tx.endUser.update({
      where: { id },
      data: { deletedAt: now, email: null },
    });
  });

  const environmentIds = [...new Set([...consents.map((consent) => consent.environmentId), ...credentials.map((row) => row.environmentId)])];
  const auditEnvironmentIds = environmentIds.length ? environmentIds : [ctx.environment.id];
  for (const environmentId of auditEnvironmentIds) {
    await auditEvent({
      environmentId,
      actorType: "human",
      actorId: ctx.user.id,
      actorName: ctx.user.name,
      action: "end_user.deleted",
      resourceType: "end_user",
      resourceId: id,
      outcome: "recorded",
      payloadSummary: {
        externalUserId: endUser.externalUserId,
        consentsRevoked: consents.length,
        connectionsDeleted: credentials.length,
        connectors: credentials.map((row) => row.connectorSlug),
        dataRequestsCompleted: true,
      },
    }).catch(() => null);
  }

  revalidatePath("/app/end-users");
  redirect("/app/end-users?deleted=1");
}
