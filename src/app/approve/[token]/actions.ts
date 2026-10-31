"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getSession, can } from "@/lib/session";
import { decideApproval } from "@/lib/approvals";

export async function decideApprovalAction(formData: FormData) {
  const token = String(formData.get("token") || "");
  const decision = formData.get("decision") === "approve" ? "approve" : "deny";
  const note = String(formData.get("note") || "").slice(0, 500);
  const approveAlways = formData.get("approveAlways") === "on";

  const approval = await db.approvalRequest.findUnique({
    where: { token },
    include: { environment: { include: { project: true } } },
  });
  if (!approval) redirect(`/approve/${token}?error=not_found`);

  const session = await getSession();
  if (!session) {
    redirect(`/sign-in?next=${encodeURIComponent(`/approve/${token}`)}`);
  }

  const membership = await db.membership.findUnique({
    where: { orgId_userId: { orgId: approval.environment.project.orgId, userId: session.user.id } },
  });
  if (!membership || !can(membership.role, "approve")) {
    redirect(`/approve/${token}?error=permission`);
  }

  const result = await decideApproval({
    approvalId: approval.id,
    decision,
    note: note || undefined,
    userId: session.user.id,
    userName: session.user.name,
    approveAlways,
  });

  if (!result.ok) redirect(`/approve/${token}?error=closed`);
  redirect(`/approve/${token}?decided=${result.status}`);
}
