"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { auditEvent } from "@/lib/audit";
import { getContext, requestMeta } from "@/lib/session";
import { assertSafeOutboundUrl } from "@/lib/outbound";
import { isSinkKind, packSinkSecret, processAuditSinks, testAuditSink } from "@/lib/audit-sinks";

function str(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

async function orgAudit(
  ctx: Awaited<ReturnType<typeof getContext>>,
  action: string,
  resourceId: string,
  payload: Record<string, unknown>,
) {
  const meta = await requestMeta();
  await auditEvent({
    environmentId: ctx.environment.id,
    actorType: "human",
    actorId: ctx.user.id,
    actorName: ctx.user.name,
    action,
    resourceType: "audit_sink",
    resourceId,
    outcome: "recorded",
    ip: meta.ip,
    payloadSummary: payload,
  });
}

export async function createAuditSinkAction(formData: FormData) {
  const ctx = await getContext();
  if (!ctx.capabilities.manageSecurity) redirect("/app/security/streaming?error=permission");

  const name = str(formData, "name").slice(0, 60) || "SIEM destination";
  const type = str(formData, "type");
  const url = str(formData, "url");
  const secret = String(formData.get("secret") ?? "").trim();
  if (!isSinkKind(type)) redirect("/app/security/streaming?error=type");
  if (!url || !secret) redirect("/app/security/streaming?error=fields");

  try {
    await assertSafeOutboundUrl(url, "Audit sink URL");
  } catch {
    redirect("/app/security/streaming?error=url");
  }

  const id = randomUUID();
  const sealed = packSinkSecret(secret, id);
  await db.auditSink.create({
    data: { id, orgId: ctx.org.id, name, type, url, ...sealed },
  });
  await orgAudit(ctx, "sink.created", id, { name, type, url });
  revalidatePath("/app/security/streaming");
  redirect("/app/security/streaming?created=1");
}

export async function toggleAuditSinkAction(formData: FormData) {
  const ctx = await getContext();
  if (!ctx.capabilities.manageSecurity) redirect("/app/security/streaming?error=permission");
  const id = str(formData, "sinkId");
  const sink = await db.auditSink.findUnique({ where: { id } });
  if (!sink || sink.orgId !== ctx.org.id) redirect("/app/security/streaming?error=missing");
  const enable = str(formData, "toggle") === "enable";
  await db.auditSink.update({ where: { id: sink.id }, data: { enabled: enable } });
  await orgAudit(ctx, "sink.updated", sink.id, { name: sink.name, enabled: enable });
  revalidatePath("/app/security/streaming");
  redirect("/app/security/streaming?saved=1");
}

export async function deleteAuditSinkAction(formData: FormData) {
  const ctx = await getContext();
  if (!ctx.capabilities.manageSecurity) redirect("/app/security/streaming?error=permission");
  const id = str(formData, "sinkId");
  const sink = await db.auditSink.findUnique({ where: { id } });
  if (!sink || sink.orgId !== ctx.org.id) redirect("/app/security/streaming?error=missing");
  await db.auditSink.delete({ where: { id: sink.id } });
  await orgAudit(ctx, "sink.deleted", sink.id, { name: sink.name, type: sink.type });
  revalidatePath("/app/security/streaming");
  redirect("/app/security/streaming?deleted=1");
}

export async function testAuditSinkAction(formData: FormData) {
  const ctx = await getContext();
  if (!ctx.capabilities.manageSecurity) redirect("/app/security/streaming?error=permission");
  const id = str(formData, "sinkId");
  const sink = await db.auditSink.findUnique({ where: { id } });
  if (!sink || sink.orgId !== ctx.org.id) redirect("/app/security/streaming?error=missing");
  const result = await testAuditSink(sink);
  revalidatePath("/app/security/streaming");
  redirect(`/app/security/streaming?${result.ok ? "tested=ok" : "tested=failed"}`);
}

export async function deliverAuditSinksAction() {
  const ctx = await getContext();
  if (!ctx.capabilities.manageSecurity) redirect("/app/security/streaming?error=permission");
  const result = await processAuditSinks({ limit: 100 });
  revalidatePath("/app/security/streaming");
  redirect(`/app/security/streaming?delivered=${result.delivered}&failed=${result.failed}`);
}
