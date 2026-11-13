import { db } from "./db";
import { parseStringArray } from "./consent";
import { globMatch } from "./policy";
import { notify } from "./notifications";
import { sendEmail, emailLayout, appUrl } from "./email";

export const TRUST_STATUSES = ["invited", "active", "declined", "revoked"] as const;
export type TrustStatus = (typeof TRUST_STATUSES)[number];

export const TRUST_TOKEN_TTL_SECONDS = 300;
export const TRUST_MAX_SCOPE_COUNT = 100;
export const TRUST_MAX_NOTE_LENGTH = 500;

export function isTrustStatus(value: unknown): value is TrustStatus {
  return typeof value === "string" && (TRUST_STATUSES as readonly string[]).includes(value);
}

export function normalizeTrustScopes(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return [
    ...new Set(
      input
        .filter((scope): scope is string => typeof scope === "string")
        .map((scope) => scope.trim())
        .filter((scope) => scope.length > 0 && scope.length <= 160),
    ),
  ].slice(0, TRUST_MAX_SCOPE_COUNT);
}

/** A scope is usable through trust when the owner capped nothing or the cap matches it. */
export function trustScopeAllowed(scope: string, maxScopes: string[]): boolean {
  if (!maxScopes.length) return true;
  return maxScopes.some((pattern) => pattern === scope || globMatch(pattern, scope) || globMatch(scope, pattern));
}

/**
 * The token may only carry scopes the shadow agent's grants already allow,
 * narrowed further by the relationship cap and any narrowing request.
 */
export function intersectTrustScopes(input: {
  grantScopes: string[];
  maxScopes?: string[] | null;
  requested?: string[] | null;
}): string[] {
  const max = input.maxScopes ?? [];
  const requested = input.requested ?? [];
  return [
    ...new Set(
      input.grantScopes.filter((scope) => {
        if (!trustScopeAllowed(scope, max)) return false;
        if (!requested.length) return true;
        return requested.some((pattern) => pattern === scope || globMatch(pattern, scope));
      }),
    ),
  ];
}

export function shadowAgentName(externalName: string, externalOrgName: string) {
  return `${externalName} (${externalOrgName})`;
}

/** In-app notification plus email for every active owner and admin of the invited organization. */
export async function notifyTrustAdmins(input: {
  externalOrgId: string;
  externalOrgName: string;
  ownerOrgName: string;
  externalAgentName: string;
  note: string | null;
}) {
  const admins = await db.membership.findMany({
    where: { orgId: input.externalOrgId, role: { in: ["owner", "admin"] }, status: "active" },
    include: { user: { select: { id: true, email: true, name: true } } },
  });
  for (const member of admins) {
    await notify({
      orgId: input.externalOrgId,
      userId: member.userId,
      type: "trust",
      title: `${input.ownerOrgName} wants to use ${input.externalAgentName}`,
      body: `${input.ownerOrgName} invited ${input.externalAgentName} to act in its environment. Review the invitation in Trust.`,
      href: "/app/trust",
    }).catch(() => null);
    await sendEmail({
      to: member.user.email,
      subject: `${input.ownerOrgName} invited ${input.externalAgentName} to a trust relationship`,
      html: emailLayout(
        "Cross-organization trust invitation",
        `<p><strong>${input.ownerOrgName}</strong> wants to use <strong>${input.externalAgentName}</strong> in its environment.</p>${
          input.note ? `<p>Note: ${input.note}</p>` : ""
        }<p>An owner or admin of ${input.externalOrgName} can accept or decline from the trust page.</p><p><a href="${appUrl("/app/trust")}">Review the invitation</a></p>`,
      ),
      text: `${input.ownerOrgName} wants to use ${input.externalAgentName}. Review: ${appUrl("/app/trust")}`,
    }).catch(() => null);
  }
}

export type TrustRelationshipView = {
  id: string;
  status: string;
  note: string | null;
  maxScopes: string[];
  ownerEnvironmentId: string;
  externalEnvironmentId: string;
  shadowAgentId: string | null;
  invitedAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  externalAgent: { id: string; name: string; status: string; orgName: string | null } | null;
  shadowAgent: { id: string; name: string; status: string } | null;
};

export function trustRelationshipView(input: {
  relationship: {
    id: string;
    status: string;
    note: string | null;
    maxScopesJson: string;
    ownerEnvironmentId: string;
    externalEnvironmentId: string;
    shadowAgentId: string | null;
    invitedAt: Date;
    acceptedAt: Date | null;
    revokedAt: Date | null;
  };
  externalAgent?: { id: string; name: string; status: string; externalOrgName?: string | null } | null;
  externalOrgName?: string | null;
  shadowAgent?: { id: string; name: string; status: string } | null;
}): TrustRelationshipView {
  const { relationship } = input;
  return {
    id: relationship.id,
    status: relationship.status,
    note: relationship.note,
    maxScopes: parseStringArray(relationship.maxScopesJson),
    ownerEnvironmentId: relationship.ownerEnvironmentId,
    externalEnvironmentId: relationship.externalEnvironmentId,
    shadowAgentId: relationship.shadowAgentId,
    invitedAt: relationship.invitedAt.toISOString(),
    acceptedAt: relationship.acceptedAt?.toISOString() ?? null,
    revokedAt: relationship.revokedAt?.toISOString() ?? null,
    externalAgent: input.externalAgent
      ? {
          id: input.externalAgent.id,
          name: input.externalAgent.name,
          status: input.externalAgent.status,
          orgName: input.externalOrgName ?? input.externalAgent.externalOrgName ?? null,
        }
      : null,
    shadowAgent: input.shadowAgent ?? null,
  };
}
