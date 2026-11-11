"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { auditEvent } from "@/lib/audit";
import { getContext, requestMeta } from "@/lib/session";
import {
  isIncidentImpact,
  isIncidentStatus,
  isStatusComponent,
} from "@/lib/status";

function str(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

async function platformAdmin() {
  const ctx = await getContext();
  if (!ctx.user.isPlatformAdmin) redirect("/app");
  return ctx;
}

async function record(
  ctx: Awaited<ReturnType<typeof getContext>>,
  action: string,
  incidentId: string,
  payload: Record<string, unknown>,
) {
  const meta = await requestMeta();
  await auditEvent({
    environmentId: ctx.environment.id,
    actorType: "human",
    actorId: ctx.user.id,
    actorName: ctx.user.name,
    action,
    resourceType: "incident",
    resourceId: incidentId,
    outcome: "recorded",
    ip: meta.ip,
    payloadSummary: payload,
  });
}

export async function createIncidentAction(formData: FormData) {
  const ctx = await platformAdmin();
  const title = str(formData, "title").slice(0, 140);
  const component = str(formData, "component");
  const impact = str(formData, "impact");
  const status = str(formData, "status") || "investigating";
  const body = str(formData, "body").slice(0, 4000);

  if (title.length < 3 || body.length < 3) redirect("/app/admin/status?error=fields");
  if (!isStatusComponent(component)) redirect("/app/admin/status?error=component");
  if (!isIncidentImpact(impact)) redirect("/app/admin/status?error=impact");
  if (!isIncidentStatus(status) || status === "resolved") redirect("/app/admin/status?error=status");

  const id = randomUUID();
  await db.incident.create({
    data: {
      id,
      title,
      component,
      impact,
      status,
      body,
      createdBy: ctx.user.id,
    },
  });
  await record(ctx, "incident.created", id, { title, component, impact, status });
  revalidatePath("/status");
  revalidatePath("/app/admin/status");
  redirect("/app/admin/status?created=1");
}

export async function postIncidentUpdateAction(formData: FormData) {
  const ctx = await platformAdmin();
  const incidentId = str(formData, "incidentId");
  const status = str(formData, "status");
  const body = str(formData, "body").slice(0, 4000);
  if (!isIncidentStatus(status)) redirect("/app/admin/status?error=status");
  if (body.length < 3) redirect("/app/admin/status?error=fields");

  const incident = await db.incident.findUnique({ where: { id: incidentId } });
  if (!incident) redirect("/app/admin/status?error=missing");

  const resolvedAt = status === "resolved" ? incident.resolvedAt ?? new Date() : null;
  await db.$transaction([
    db.incident.update({
      where: { id: incident.id },
      data: { status, resolvedAt },
    }),
    db.incidentUpdate.create({
      data: { id: randomUUID(), incidentId: incident.id, status, body },
    }),
  ]);
  await record(ctx, status === "resolved" ? "incident.resolved" : "incident.updated", incident.id, {
    title: incident.title,
    status,
    body,
  });
  revalidatePath("/status");
  revalidatePath("/app/admin/status");
  redirect(`/app/admin/status?${status === "resolved" ? "resolved=1" : "updated=1"}`);
}
