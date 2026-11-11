"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { auditEvent } from "@/lib/audit";
import { getContext, requestMeta } from "@/lib/session";

export async function resolveErrorAction(formData: FormData) {
  const ctx = await getContext();
  if (!ctx.capabilities.manageSecurity) redirect("/app/observability?error=permission");
  const id = String(formData.get("errorId") ?? "");
  const event = await db.errorEvent.findUnique({ where: { id } });
  if (!event || event.orgId !== ctx.org.id) redirect("/app/observability?error=missing");
  await db.errorEvent.update({ where: { id: event.id }, data: { resolvedAt: new Date() } });
  const meta = await requestMeta();
  await auditEvent({
    environmentId: ctx.environment.id,
    actorType: "human",
    actorId: ctx.user.id,
    actorName: ctx.user.name,
    action: "error.resolved",
    resourceType: "error_event",
    resourceId: event.id,
    outcome: "recorded",
    ip: meta.ip,
    payloadSummary: { route: event.route, requestId: event.requestId },
  });
  revalidatePath("/app/observability");
  redirect("/app/observability?saved=1");
}

export async function resolveAllErrorsAction() {
  const ctx = await getContext();
  if (!ctx.capabilities.manageSecurity) redirect("/app/observability?error=permission");
  const result = await db.errorEvent.updateMany({
    where: { orgId: ctx.org.id, resolvedAt: null },
    data: { resolvedAt: new Date() },
  });
  if (result.count) {
    const meta = await requestMeta();
    await auditEvent({
      environmentId: ctx.environment.id,
      actorType: "human",
      actorId: ctx.user.id,
      actorName: ctx.user.name,
      action: "error.resolved_all",
      resourceType: "error_event",
      resourceId: null,
      outcome: "recorded",
      ip: meta.ip,
      payloadSummary: { resolved: result.count },
    });
  }
  revalidatePath("/app/observability");
  redirect(`/app/observability?resolved=${result.count}`);
}
