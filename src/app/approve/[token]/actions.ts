"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getSession, can } from "@/lib/session";
import { decideApproval } from "@/lib/approvals";
import { verifyApprovalLink } from "@/lib/signed-links";

export async function decideApprovalAction(formData: FormData) {
  const link = String(formData.get("token") || "");
  const token = verifyApprovalLink(link);
  const decision = formData.get("decision") === "approve" ? "approve" : "deny";
  const note = String(formData.get("note") || "").slice(0, 500);
  const approveAlways = formData.get("approveAlways") === "on";

  if (!token) redirect("/approve/invalid");

  const approval = await db.approvalRequest.findUnique({
    where: { token },
    include: { environment: { include: { project: true } } },
  });
  if (!approval) redirect(`/approve/${link}?error=not_found`);

  const session = await getSession();
  if (!session) {
    redirect(`/sign-in?next=${encodeURIComponent(`/approve/${link}`)}`);
  }

  const membership = await db.membership.findUnique({
    where: { orgId_userId: { orgId: approval.environment.project.orgId, userId: session.user.id } },
  });
  if (!membership || !can(membership.role, "approve")) {
    redirect(`/approve/${link}?error=permission`);
  }

  const result = await decideApproval({
    approvalId: approval.id,
    decision,
    note: note || undefined,
    userId: session.user.id,
    userName: session.user.name,
    approveAlways,
  });

  if (!result.ok) redirect(`/approve/${link}?error=closed`);
  redirect(`/approve/${link}?decided=${result.status}`);
}
