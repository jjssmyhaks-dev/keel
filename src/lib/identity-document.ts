import { createHmac, createPublicKey, hkdfSync, type KeyObject } from "node:crypto";
import type { JWK } from "jose";
import { db } from "./db";
import { auditEvent } from "./audit";
import { ISSUER, getSigningKeyId, signPlatformJws } from "./jwt";
import { masterKeyBytes } from "./secrets";

export const IDENTITY_DOCUMENT_VERSION = 1;
export const VERIFICATION_VISIBILITY = ["public", "limited", "private"] as const;
export type VerificationVisibility = (typeof VERIFICATION_VISIBILITY)[number];

export function isVerificationVisibility(value: unknown): value is VerificationVisibility {
  return typeof value === "string" && (VERIFICATION_VISIBILITY as readonly string[]).includes(value);
}

export function visibilityOf(value: string | null | undefined): VerificationVisibility {
  return isVerificationVisibility(value) ? value : "public";
}

/** Unknown statuses are treated as revoked: a document must never overstate access. */
export function documentStatus(status: string): "active" | "paused" | "suspended" | "revoked" {
  if (status === "active" || status === "paused" || status === "suspended" || status === "revoked") {
    return status;
  }
  return "revoked";
}

let orgRefKey: Buffer | null = null;

function orgReferenceKey() {
  if (!orgRefKey) {
    orgRefKey = Buffer.from(
      hkdfSync("sha256", masterKeyBytes(), Buffer.alloc(0), Buffer.from("authab.org-ref.v1"), 32),
    );
  }
  return orgRefKey;
}

/**
 * Stable, non-reversible organization reference. 24 hex characters of
 * HMAC-SHA256(key, orgId); the organization id and name never appear.
 */
export function organizationReference(organizationId: string) {
  return createHmac("sha256", orgReferenceKey()).update(organizationId).digest("hex").slice(0, 24);
}

export function publicJwkFromPem(publicKey: string): JWK {
  const key = createPublicKey(publicKey) as KeyObject;
  const jwk = key.export({ format: "jwk" }) as JWK;
  if (jwk.kty !== "OKP" || jwk.crv !== "Ed25519" || !jwk.x) {
    throw new Error("The agent public key is not an Ed25519 key.");
  }
  return { kty: "OKP", crv: "Ed25519", x: jwk.x };
}

export type IdentityDocumentPayload = {
  v: number;
  iss: string;
  iat: number;
  doc_seq: number;
  agent_id: string;
  key_fingerprint: string;
  public_jwk: JWK;
  org_ref: string;
  environment: "development" | "production";
  status: "active" | "paused" | "suspended" | "revoked";
  visibility: VerificationVisibility;
  created_at: string;
};

export type IdentityDocumentAgent = {
  id: string;
  status: string;
  fingerprint: string;
  publicKey: string | null;
  verificationVisibility: string | null;
  createdAt: Date;
  environment: { type: string; project: { orgId: string } };
};

export function buildIdentityDocumentPayload(
  agent: IdentityDocumentAgent,
  opts: { docSeq: number; now?: Date },
): IdentityDocumentPayload {
  if (!agent.publicKey) throw new Error(`Agent ${agent.id} has no public key to publish.`);
  const now = opts.now ?? new Date();
  return {
    v: IDENTITY_DOCUMENT_VERSION,
    iss: ISSUER,
    iat: Math.floor(now.getTime() / 1000),
    doc_seq: opts.docSeq,
    agent_id: agent.id,
    key_fingerprint: agent.fingerprint,
    public_jwk: publicJwkFromPem(agent.publicKey),
    org_ref: organizationReference(agent.environment.project.orgId),
    environment: agent.environment.type === "production" ? "production" : "development",
    status: documentStatus(agent.status),
    visibility: visibilityOf(agent.verificationVisibility),
    created_at: agent.createdAt.toISOString(),
  };
}

/**
 * Minimal structural client so issuance can run inside a Prisma transaction
 * and against an in-memory store in tests.
 */
export type IdentityDocumentStore = {
  agent: { findUnique(args: any): Promise<any> };
  agentIdentityDocument: {
    findFirst(args: any): Promise<any>;
    create(args: any): Promise<any>;
    updateMany(args: any): Promise<any>;
  };
};

export type IssuedIdentityDocument = {
  id: string;
  agentId: string;
  docSeq: number;
  document: IdentityDocumentPayload;
  jws: string;
  issuerKeyId: string;
  issuedAt: Date;
};

export async function issueIdentityDocumentWith(
  store: IdentityDocumentStore,
  agentId: string,
): Promise<IssuedIdentityDocument | null> {
  const agent = (await store.agent.findUnique({
    where: { id: agentId },
    include: { environment: { include: { project: true } } },
  })) as IdentityDocumentAgent | null;
  if (!agent) return null;

  const latest = (await store.agentIdentityDocument.findFirst({
    where: { agentId },
    orderBy: { docSeq: "desc" },
    select: { id: true, docSeq: true },
  })) as { id: string; docSeq: number } | null;
  const docSeq = (latest?.docSeq ?? 0) + 1;
  const document = buildIdentityDocumentPayload(agent, { docSeq });
  const jws = await signPlatformJws(document as unknown as Record<string, unknown>, "agent-identity+jwt");
  const issuerKeyId = await getSigningKeyId();
  const now = new Date();

  if (latest) {
    await store.agentIdentityDocument.updateMany({
      where: { agentId, supersededAt: null },
      data: { supersededAt: now },
    });
  }
  const row = (await store.agentIdentityDocument.create({
    data: {
      agentId,
      docSeq,
      documentJson: JSON.stringify(document),
      jws,
      issuerKeyId,
      issuedAt: now,
    },
  })) as { id: string; issuedAt: Date };

  return { id: row.id, agentId, docSeq, document, jws, issuerKeyId, issuedAt: row.issuedAt };
}

/**
 * Never throws. A failed re-issue must not fail the user's action, so callers
 * use this wrapper and the failure is logged and audited instead.
 */
export async function issueIdentityDocumentSafe(agentId: string): Promise<IssuedIdentityDocument | null> {
  try {
    return await db.$transaction((tx) => issueIdentityDocumentWith(tx, agentId));
  } catch (error) {
    console.error(`[authab] identity document issue failed for ${agentId}`, error);
  }
  try {
    const agent = await db.agent.findUnique({
      where: { id: agentId },
      select: { environmentId: true, name: true },
    });
    if (agent) {
      await auditEvent({
        environmentId: agent.environmentId,
        actorType: "system",
        actorName: "Identity documents",
        agentId,
        action: "identity.issue_failed",
        resourceType: "agent",
        resourceId: agentId,
        outcome: "error",
        payloadSummary: { name: agent.name },
      });
    }
  } catch (error) {
    console.error("[authab] could not record identity.issue_failed", error);
  }
  return null;
}

export async function currentIdentityDocument(agentId: string) {
  return db.agentIdentityDocument.findFirst({
    where: { agentId, supersededAt: null },
    orderBy: { docSeq: "desc" },
  });
}

/**
 * Background repair: re-issue documents that are missing, or whose embedded
 * status, key fingerprint or visibility no longer matches the agent row.
 * Comparing the document (not the row's updatedAt) avoids re-issuing on every
 * lastActiveAt touch.
 */
export async function reissueStaleIdentityDocuments(limit = 200) {
  const agents = await db.agent.findMany({
    select: { id: true, status: true, fingerprint: true, verificationVisibility: true },
    orderBy: { updatedAt: "desc" },
    take: limit,
  });
  if (!agents.length) return 0;
  const current = await db.agentIdentityDocument.findMany({
    where: { agentId: { in: agents.map((agent) => agent.id) }, supersededAt: null },
    select: { agentId: true, documentJson: true },
  });
  const byAgent = new Map(current.map((row) => [row.agentId, row.documentJson]));
  let reissued = 0;
  for (const agent of agents) {
    const raw = byAgent.get(agent.id);
    let stale = !raw;
    if (raw) {
      try {
        const doc = JSON.parse(raw) as Partial<IdentityDocumentPayload>;
        stale =
          doc.status !== documentStatus(agent.status) ||
          doc.key_fingerprint !== agent.fingerprint ||
          doc.visibility !== visibilityOf(agent.verificationVisibility);
      } catch {
        stale = true;
      }
    }
    if (stale && (await issueIdentityDocumentSafe(agent.id))) reissued += 1;
  }
  return reissued;
}
