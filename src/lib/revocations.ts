import { createHash } from "node:crypto";
import { db } from "./db";
import { canonical } from "./audit";
import { ISSUER } from "./jwt";

export const REVOCATION_REASONS = ["owner_revoked", "compromised", "abuse", "expired"] as const;
export type RevocationReason = (typeof REVOCATION_REASONS)[number];

export function isRevocationReason(value: unknown): value is RevocationReason {
  return typeof value === "string" && (REVOCATION_REASONS as readonly string[]).includes(value);
}

export type RevocationEntry = {
  agent_id: string;
  revoked_at: string;
  reason: RevocationReason;
};

export function revocationEntry(row: {
  agentId: string;
  revokedAt: Date;
  reasonCode: string;
}): RevocationEntry {
  return {
    agent_id: row.agentId,
    revoked_at: row.revokedAt.toISOString(),
    reason: isRevocationReason(row.reasonCode) ? row.reasonCode : "owner_revoked",
  };
}

/**
 * Recorded inside the kill/revoke/delete paths. A failure is logged rather
 * than thrown so it can never block the revocation itself; the cron re-issue
 * path and the audit trail still show the state change.
 */
export async function recordRevocation(
  agentId: string,
  environmentId: string,
  reasonCode: RevocationReason,
): Promise<boolean> {
  try {
    await db.revocation.upsert({
      where: { agentId },
      create: { agentId, environmentId, reasonCode },
      update: {},
    });
    return true;
  } catch (error) {
    console.error(`[authab] could not record revocation for ${agentId}`, error);
    return false;
  }
}

export type RevocationJwsPayload = {
  v: number;
  iss: string;
  iat: number;
  exp: number;
  environment: "development" | "production";
  revoked: RevocationEntry[];
};

export function buildRevocationJwsPayload(
  entries: RevocationEntry[],
  opts: { environmentType: string; now?: Date },
): RevocationJwsPayload {
  const iat = Math.floor((opts.now ?? new Date()).getTime() / 1000);
  return {
    v: 1,
    iss: ISSUER,
    iat,
    exp: iat + 600,
    environment: opts.environmentType === "production" ? "production" : "development",
    revoked: entries,
  };
}

/** ETag covers the revoked list only, so it is stable while iat and exp move. */
export function revocationsEtag(entries: RevocationEntry[]) {
  return createHash("sha256").update(canonical(entries)).digest("hex");
}

export function nextAfter(rows: { id: string }[], limit: number) {
  return rows.length === limit ? rows[rows.length - 1].id : null;
}
