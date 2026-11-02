"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { sha256 } from "@/lib/crypto";
import { inviteState } from "@/lib/invitations";
import { getSession, setActiveOrg } from "@/lib/session";
import { auditEvent } from "@/lib/audit";
import { notify } from "@/lib/notifications";

export async function acceptInviteAction(formData: FormData) {
  const token = String(formData.get("token") || "");
  const invitation = await db.invitation.findUnique({
    where: { tokenHash: sha256(token) },
    include: { org: true },
  });
  if (!invitation) redirect("/invite/invalid");

  const session = await getSession();
  if (!session) {
    redirect(`/sign-in?next=${encodeURIComponent(`/invite/${token}`)}`);
  }

  const state = inviteState({
    expiresAt: invitation.expiresAt,
    acceptedAt: invitation.acceptedAt,
    invitedEmail: invitation.email,
    sessionEmail: session.user.email,
  });
  if (state.emailMismatch) redirect(`/invite/${token}?error=email`);
  if (state.accepted) redirect(`/invite/${token}?error=accepted`);
  if (state.expired) redirect(`/invite/${token}?error=expired`);

  const existing = await db.membership.findUnique({
    where: { orgId_userId: { orgId: invitation.orgId, userId: session.user.id } },
  });

  if (!existing) {
    await db.membership.create({
      data: { orgId: invitation.orgId, userId: session.user.id, role: invitation.role },
    });
    const environment = await db.environment.findFirst({
      where: { project: { orgId: invitation.orgId } },
      orderBy: { createdAt: "asc" },
    });
    if (environment) {
      await auditEvent({
        environmentId: environment.id,
        actorType: "human",
        actorId: session.user.id,
        actorName: session.user.name,
        action: "member.joined",
        resourceType: "membership",
        resourceId: session.user.id,
        outcome: "recorded",
        payloadSummary: { email: session.user.email, role: invitation.role, invitation: invitation.id },
      }).catch(() => null);
    }
  }

  await db.invitation
    .updateMany({ where: { id: invitation.id, acceptedAt: null }, data: { acceptedAt: new Date() } })
    .catch(() => null);

  if (!session.user.onboardedAt) {
    await db.user
      .update({ where: { id: session.user.id }, data: { onboardedAt: new Date() } })
      .catch(() => null);
  }

  if (invitation.invitedBy && invitation.invitedBy !== session.user.id) {
    await notify({
      orgId: invitation.orgId,
      userId: invitation.invitedBy,
      type: "team",
      title: `${session.user.name} joined ${invitation.org.name}`,
      body: `The invitation was accepted.`,
      href: "/app/team",
    }).catch(() => null);
  }

  await setActiveOrg(invitation.orgId);
  redirect(`/app?joined=${encodeURIComponent(invitation.org.name)}`);
}
