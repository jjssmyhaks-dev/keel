import { db } from "./db";

export const MAX_DELEGATION_DEPTH = 4;

export function scopeListFromJson(value: string): string[] {
  try {
    const parsed = JSON.parse(value || "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

export function restrictionsFromJson(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value || "{}") as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export type DelegationClaims = {
  parentChain: string[];
  delegationId: string | null;
};

type DelegationClaimCheck =
  | ({ ok: true } & DelegationClaims)
  | { ok: false; code: string; message: string };

/**
 * Re-checks the delegation claims carried by an exchanged token so revocation
 * and expiry apply immediately, without waiting for the token to expire.
 */
export async function verifyDelegationClaims(
  payload: Record<string, unknown>,
  environmentId: string,
): Promise<DelegationClaimCheck> {
  const rawChain = payload.parent_chain;
  const parentChain = Array.isArray(rawChain)
    ? rawChain.filter((value): value is string => typeof value === "string").slice(0, MAX_DELEGATION_DEPTH)
    : [];
  const delegationId = typeof payload.delegation_id === "string" ? payload.delegation_id : null;

  if (delegationId) {
    const delegation = await db.delegation.findUnique({ where: { id: delegationId } });
    if (
      !delegation ||
      delegation.environmentId !== environmentId ||
      delegation.revokedAt ||
      (delegation.expiresAt && delegation.expiresAt.getTime() <= Date.now())
    ) {
      return {
        ok: false,
        code: "delegation_inactive",
        message: "The delegation behind this token was revoked or expired.",
      };
    }
  }

  if (parentChain.length) {
    const revoked = await db.tokenBlocklist.findFirst({ where: { id: { in: parentChain } } });
    if (revoked) {
      return {
        ok: false,
        code: "token_revoked",
        message: "A token earlier in this delegation chain has been revoked.",
      };
    }
  }

  return { ok: true, parentChain, delegationId };
}
