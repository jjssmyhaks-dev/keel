import type { Credential, Grant } from "@prisma/client";
import { db } from "./db";
import { auditEvent } from "./audit";

const SANDBOX_SLUG = "sandbox";

export async function ensureSandboxConnection(opts: {
  environmentId: string;
  userId: string;
  actorName: string;
  ip?: string | null;
}): Promise<{ credential: Credential; created: boolean }> {
  const existing = await db.credential.findFirst({
    where: { environmentId: opts.environmentId, connectorSlug: SANDBOX_SLUG },
    orderBy: { createdAt: "asc" },
  });
  if (existing) return { credential: existing, created: false };

  // The sandbox executor never reads or decrypts credential material, so the row
  // carries inert placeholders instead of ciphertext; it exists only so the proxy's
  // credential lookup, grant, rate-limit and audit stages run unchanged.
  const credential = await db.credential.create({
    data: {
      environmentId: opts.environmentId,
      connectorSlug: SANDBOX_SLUG,
      name: "Sandbox (no secret)",
      type: "sandbox",
      encryptedPayload: "sandbox:no-secret",
      dataKeyEncrypted: "sandbox:no-secret",
      metadataJson: JSON.stringify({ sandbox: true }),
      maskedHint: "no secret",
      status: "healthy",
      createdBy: opts.userId,
    },
  });

  await auditEvent({
    environmentId: opts.environmentId,
    actorType: "human",
    actorId: opts.userId,
    actorName: opts.actorName,
    action: "credential.created",
    resourceType: "credential",
    resourceId: credential.id,
    outcome: "recorded",
    ip: opts.ip,
    payloadSummary: { connector: SANDBOX_SLUG, name: credential.name, sandbox: true },
  });

  return { credential, created: true };
}

export async function ensureSandboxGrant(opts: {
  environmentId: string;
  agentId: string;
  credentialId: string;
  userId: string;
  actorName: string;
  ip?: string | null;
}): Promise<{ grant: Grant; created: boolean }> {
  const existing = await db.grant.findUnique({
    where: { agentId_credentialId: { agentId: opts.agentId, credentialId: opts.credentialId } },
  });
  if (existing) return { grant: existing, created: false };

  const grant = await db.grant.create({
    data: {
      environmentId: opts.environmentId,
      agentId: opts.agentId,
      credentialId: opts.credentialId,
      actionsJson: JSON.stringify(["sandbox.*"]),
      resourcePattern: "*",
      purpose: "Sandbox playground",
      createdBy: opts.userId,
    },
  });

  await auditEvent({
    environmentId: opts.environmentId,
    actorType: "human",
    actorId: opts.userId,
    actorName: opts.actorName,
    agentId: opts.agentId,
    action: "grant.created",
    resourceType: "grant",
    resourceId: grant.id,
    outcome: "recorded",
    ip: opts.ip,
    payloadSummary: {
      agentId: opts.agentId,
      credentialId: opts.credentialId,
      actions: ["sandbox.*"],
      resource: "*",
      sandbox: true,
    },
  });

  return { grant, created: true };
}
