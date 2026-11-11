"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getContext } from "@/lib/session";
import { ApiError } from "@/lib/api";
import { validateWorkloadIdentityInput } from "@/lib/workload-identities";
import { auditEvent } from "@/lib/audit";

function errorCode(error: unknown) {
  return error instanceof ApiError ? error.code : "invalid";
}

async function guardedAgent(agentId: string) {
  const ctx = await getContext();
  const back = `/app/agents/${agentId}`;
  if (!ctx.capabilities.manageAgents) redirect(`${back}?wi_error=permission`);
  const agent = await db.agent.findFirst({ where: { id: agentId, environmentId: ctx.environment.id } });
  if (!agent) redirect(`${back}?wi_error=missing`);
  return { ctx, agent, back };
}

export async function createWorkloadIdentityAction(formData: FormData) {
  const agentId = String(formData.get("agentId") ?? "");
  const { ctx, agent, back } = await guardedAgent(agentId);

  try {
    const data = await validateWorkloadIdentityInput(
      {
        name: String(formData.get("name") ?? ""),
        type: String(formData.get("type") ?? "spiffe"),
        issuer: String(formData.get("issuer") ?? ""),
        audience: String(formData.get("audience") ?? ""),
        agentId: agent.id,
        subjectPattern: String(formData.get("subjectPattern") ?? "") || null,
        jwksUrl: String(formData.get("jwksUrl") ?? "") || undefined,
        tokenTtlSeconds: Number(formData.get("tokenTtlSeconds") ?? 300),
      },
      ctx.environment.id,
    );

    const identity = await db.workloadIdentity.create({
      data: {
        environmentId: ctx.environment.id,
        name: String(data.name),
        type: String(data.type ?? "spiffe"),
        issuer: String(data.issuer),
        audience: String(data.audience),
        agentId: agent.id,
        jwksUrl: (data.jwksUrl as string | null) ?? null,
        jwksJson: (data.jwksJson as string | null) ?? null,
        subjectPattern: (data.subjectPattern as string | null) ?? null,
        requiredClaimsJson: String(data.requiredClaimsJson ?? "{}"),
        tokenTtlSeconds: Number(data.tokenTtlSeconds ?? 300),
        enabled: true,
      },
    });

    await auditEvent({
      environmentId: ctx.environment.id,
      actorType: "human",
      actorId: ctx.user.id,
      actorName: ctx.user.name,
      agentId: agent.id,
      action: "workload_identity.created",
      resourceType: "workload_identity",
      resourceId: identity.id,
      outcome: "recorded",
      payloadSummary: {
        name: identity.name,
        type: identity.type,
        issuer: identity.issuer,
        audience: identity.audience,
        subjectPattern: identity.subjectPattern,
      },
    }).catch(() => null);
  } catch (error) {
    redirect(`${back}?wi_error=${errorCode(error)}`);
  }

  revalidatePath(back);
  redirect(`${back}?wi=created`);
}

export async function toggleWorkloadIdentityAction(formData: FormData) {
  const agentId = String(formData.get("agentId") ?? "");
  const identityId = String(formData.get("identityId") ?? "");
  const enabled = String(formData.get("enabled") ?? "") === "1";
  const { ctx, agent, back } = await guardedAgent(agentId);

  const identity = await db.workloadIdentity.findFirst({
    where: { id: identityId, agentId: agent.id, environmentId: ctx.environment.id },
  });
  if (!identity) redirect(`${back}?wi_error=missing`);

  const updated = await db.workloadIdentity.update({
    where: { id: identity.id },
    data: { enabled },
  });
  await auditEvent({
    environmentId: ctx.environment.id,
    actorType: "human",
    actorId: ctx.user.id,
    actorName: ctx.user.name,
    agentId: agent.id,
    action: "workload_identity.updated",
    resourceType: "workload_identity",
    resourceId: updated.id,
    outcome: "recorded",
    payloadSummary: { name: updated.name, enabled },
  }).catch(() => null);

  revalidatePath(back);
  redirect(`${back}?wi=updated`);
}

export async function deleteWorkloadIdentityAction(formData: FormData) {
  const agentId = String(formData.get("agentId") ?? "");
  const identityId = String(formData.get("identityId") ?? "");
  const { ctx, agent, back } = await guardedAgent(agentId);

  const identity = await db.workloadIdentity.findFirst({
    where: { id: identityId, agentId: agent.id, environmentId: ctx.environment.id },
  });
  if (!identity) redirect(`${back}?wi_error=missing`);

  await db.workloadIdentity.delete({ where: { id: identity.id } });
  await auditEvent({
    environmentId: ctx.environment.id,
    actorType: "human",
    actorId: ctx.user.id,
    actorName: ctx.user.name,
    agentId: agent.id,
    action: "workload_identity.deleted",
    resourceType: "workload_identity",
    resourceId: identity.id,
    outcome: "recorded",
    payloadSummary: { name: identity.name, issuer: identity.issuer },
  }).catch(() => null);

  revalidatePath(back);
  redirect(`${back}?wi=deleted`);
}
