import type { Agent } from "@prisma/client";
import { encryptSecret, fingerprintFor, generateAgentIdentity } from "../crypto";
import { auditEvent } from "../audit";
import { storeOf, type ServiceActor, type ServiceStore } from "./types";

export type RegisterAgentInput = {
  name: string;
  description?: string | null;
  tags?: string[];
  type?: string;
  framework?: string | null;
  ownerUserId?: string | null;
  publicKey?: string | null;
  keyMode?: "client" | "platform";
  autonomousMode?: boolean;
};

export async function registerAgentService(
  actor: ServiceActor & { projectId: string },
  input: RegisterAgentInput,
  store?: ServiceStore,
): Promise<{ agent: Agent; privateKey: string | null; fingerprint: string; requestId: string }> {
  const client = storeOf(store);
  let publicKey = input.publicKey?.trim() || null;
  let privateKey: string | null = null;
  let fingerprint: string;
  let encryptedPrivateKey: string | null = null;

  if (publicKey) {
    fingerprint = fingerprintFor(publicKey);
  } else {
    const identity = generateAgentIdentity();
    publicKey = identity.publicKey;
    privateKey = identity.privateKey;
    fingerprint = identity.fingerprint;
    if ((input.keyMode ?? "client") === "platform") {
      const sealed = await encryptSecret(actor.projectId, { privateKey: identity.privateKey });
      encryptedPrivateKey = JSON.stringify(sealed);
    }
  }

  const agent = await client.agent.create({
    data: {
      environmentId: actor.environmentId,
      name: input.name,
      description: input.description?.trim() || null,
      ownerUserId: input.ownerUserId ?? null,
      publicKey,
      fingerprint,
      agentType: input.type ?? "other",
      autonomousMode: input.autonomousMode === true,
      keyMode: input.keyMode === "platform" ? "platform" : "client",
      tagsJson: JSON.stringify((input.tags ?? []).filter((tag) => typeof tag === "string").slice(0, 12)),
      framework: input.framework?.trim() || null,
      keys: {
        create: {
          publicKey: publicKey!,
          encryptedPrivateKey,
        },
      },
    },
  });

  const requestId = `req_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  await auditEvent(
    {
      environmentId: actor.environmentId,
      actorType: "human",
      actorId: actor.actorId,
      actorName: actor.actorName,
      action: "agent.registered",
      resourceType: "agent",
      resourceId: agent.id,
      outcome: "recorded",
      requestId,
      ip: actor.ip,
      payloadSummary: { name: input.name, keyMode: agent.keyMode, fingerprint },
    },
    store,
  );

  return { agent, privateKey, fingerprint, requestId };
}

export type UpdateAgentConfigInput = {
  description?: string | null;
  tags?: string[];
  type?: string;
  autonomousMode?: boolean;
};

export async function updateAgentConfigService(
  actor: ServiceActor,
  agent: Agent,
  input: UpdateAgentConfigInput,
  store?: ServiceStore,
): Promise<{ agent: Agent; changed: string[]; requestId: string }> {
  const client = storeOf(store);
  const data: Record<string, unknown> = {};
  if (input.description !== undefined) data.description = input.description?.slice(0, 280) || null;
  if (input.tags !== undefined) data.tagsJson = JSON.stringify(input.tags.slice(0, 12));
  if (input.type !== undefined) data.agentType = input.type;
  if (input.autonomousMode !== undefined) data.autonomousMode = Boolean(input.autonomousMode);
  if (!Object.keys(data).length) {
    return { agent, changed: [], requestId: "" };
  }

  const updated = await client.agent.update({ where: { id: agent.id }, data });
  const requestId = `req_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  await auditEvent(
    {
      environmentId: actor.environmentId,
      actorType: "human",
      actorId: actor.actorId,
      actorName: actor.actorName,
      agentId: agent.id,
      action: "agent.updated",
      resourceType: "agent",
      resourceId: agent.id,
      outcome: "recorded",
      requestId,
      ip: actor.ip,
      payloadSummary: {
        name: updated.name,
        type: updated.agentType,
        autonomousMode: updated.autonomousMode,
        via: "config",
      },
    },
    store,
  );

  return { agent: updated, changed: Object.keys(data), requestId };
}
