import { db } from "./db";
import { planFor } from "./plans";

export type LimitKind = "agents" | "credentials" | "members" | "calls";

export type LimitCheck = {
  allowed: boolean;
  used: number;
  limit: number;
  plan: string;
  planName: string;
  message: string;
};

export function monthPeriod(date = new Date()) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

const NOUN: Record<LimitKind, string> = {
  agents: "agents",
  credentials: "connections",
  members: "team members",
  calls: "proxy calls this month",
};

async function usedFor(orgId: string, kind: LimitKind) {
  switch (kind) {
    case "agents":
      return db.agent.count({ where: { environment: { project: { orgId } } } });
    case "credentials":
      return db.credential.count({ where: { environment: { project: { orgId } }, revokedAt: null } });
    case "members": {
      const [memberships, invitations] = await Promise.all([
        db.membership.count({ where: { orgId } }),
        db.invitation.count({ where: { orgId, acceptedAt: null, expiresAt: { gt: new Date() } } }),
      ]);
      return memberships + invitations;
    }
    case "calls": {
      const usage = await db.usageRecord.aggregate({
        where: { orgId, metric: "proxy_calls", period: monthPeriod() },
        _sum: { quantity: true },
      });
      return usage._sum.quantity ?? 0;
    }
  }
}

export async function checkPlanLimit(
  orgId: string,
  kind: LimitKind,
  knownPlan?: string,
): Promise<LimitCheck> {
  let planKey = knownPlan;
  if (!planKey) {
    const org = await db.organization.findUnique({ where: { id: orgId }, select: { plan: true } });
    planKey = org?.plan ?? "free";
  }
  const plan = planFor(planKey);
  const limit =
    kind === "agents"
      ? plan.limits.agents
      : kind === "credentials"
        ? plan.limits.credentials
        : kind === "members"
          ? plan.limits.members
          : plan.limits.callsPerMonth;
  const used = await usedFor(orgId, kind);
  const allowed = limit < 0 || used < limit;
  return {
    allowed,
    used,
    limit,
    plan: plan.key,
    planName: plan.name,
    message: allowed
      ? ""
      : `The ${plan.name} plan includes ${limit.toLocaleString("en-IN")} ${NOUN[kind]}. ${used.toLocaleString("en-IN")} ${
          used === 1 ? "is" : "are"
        } already in use — upgrade the workspace to raise the limit.`,
  };
}

export function productionAccess(planKey: string) {
  const plan = planFor(planKey);
  return {
    allowed: plan.production,
    plan: plan.key,
    message: plan.production
      ? ""
      : "Production mode requires a paid plan. Upgrade the workspace before writing to production.",
  };
}

export async function productionAccessFor(orgId: string) {
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { plan: true } });
  return productionAccess(org?.plan ?? "free");
}
