import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { retryPendingWebhooks } from "@/lib/webhooks";
import { pruneRateLimitCounters } from "@/lib/rate-limit";
import { expireStaleApprovals, escalateOverdueApprovals } from "@/lib/approvals";
import { evaluateAlerts } from "@/lib/alerts";
import { refreshExpiringOAuthTokens, runHealthChecks } from "@/lib/credential-health";
import { planFor } from "@/lib/plans";
import { processAuditSinks } from "@/lib/audit-sinks";
import { sweepBilling } from "@/lib/billing";
import { reissueStaleIdentityDocuments } from "@/lib/identity-document";
import { pruneAgentEvents } from "@/lib/agent-events";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function sameSecret(expected: string, provided: string) {
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function run(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "cron_not_configured" }, { status: 503 });
  }
  const header = req.headers.get("authorization") || "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : new URL(req.url).searchParams.get("secret") || "";
  if (!sameSecret(secret, provided)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const now = Date.now();
  const nowDate = new Date(now);
  const retried = await retryPendingWebhooks(25);
  const auditSinks = await processAuditSinks({ limit: 100 });
  const billing = await sweepBilling();

  await expireStaleApprovals();
  const approvalsEscalated = await escalateOverdueApprovals();
  const tokenRefreshes = await refreshExpiringOAuthTokens(25);
  const alerts = await evaluateAlerts();
  const health = await runHealthChecks({ limit: 25 });
  const identityDocuments = await reissueStaleIdentityDocuments(200);
  const prunedAgentEvents = await pruneAgentEvents(new Date(now - 400 * 86_400_000));

  const expiring = await db.credential.updateMany({
    where: {
      revokedAt: null,
      NOT: { type: "oauth", refreshable: true },
      expiresAt: { gt: nowDate, lte: new Date(now + 7 * 86_400_000) },
      status: { notIn: ["expiring", "expired", "revoked"] },
    },
    data: { status: "expiring" },
  });
  const expired = await db.credential.updateMany({
    where: {
      revokedAt: null,
      NOT: { type: "oauth", refreshable: true },
      expiresAt: { lte: nowDate },
      status: { notIn: ["expired", "revoked"] },
    },
    data: { status: "expired" },
  });

  const orgs = await db.organization.findMany({ where: { deletedAt: null }, select: { id: true, plan: true } });
  let prunedAudit = 0;
  for (const org of orgs) {
    const retentionDays = planFor(org.plan).limits.retentionDays;
    if (retentionDays < 0) continue;
    const result = await db.$transaction(async (tx) => {
      // WORM trigger: retention is the only sanctioned mutation of the audit table.
      await tx.$executeRawUnsafe(`SET LOCAL app.audit_maintenance = 'on'`);
      return tx.auditEvent.deleteMany({
        where: {
          environment: { project: { orgId: org.id } },
          timestamp: { lt: new Date(now - retentionDays * 86_400_000) },
        },
      });
    });
    prunedAudit += result.count;
  }

  const [challenges, counters, blocklist, idempotency, loginTokens, deliveries, sessions, invitations, requestErrors] = await Promise.all([
    db.challengeUse.deleteMany({ where: { usedAt: { lt: new Date(now - 24 * 60 * 60_000) } } }),
    pruneRateLimitCounters(),
    db.tokenBlocklist.deleteMany({ where: { expiresAt: { lt: nowDate } } }),
    db.idempotencyRecord.deleteMany({ where: { createdAt: { lt: new Date(now - 7 * 24 * 60 * 60_000) } } }),
    db.loginToken.deleteMany({
      where: {
        OR: [
          { expiresAt: { lt: new Date(now - 24 * 60 * 60_000) } },
          { usedAt: { lt: new Date(now - 24 * 60 * 60_000) } },
        ],
      },
    }),
    db.webhookDelivery.deleteMany({ where: { createdAt: { lt: new Date(now - 30 * 24 * 60 * 60_000) } } }),
    db.session.deleteMany({
      where: {
        OR: [
          { expiresAt: { lt: new Date(now - 7 * 24 * 60 * 60_000) } },
          { revokedAt: { lt: new Date(now - 30 * 24 * 60 * 60_000) } },
        ],
      },
    }),
    db.invitation.deleteMany({ where: { expiresAt: { lt: new Date(now - 30 * 24 * 60 * 60_000) } } }),
    db.errorEvent.deleteMany({ where: { createdAt: { lt: new Date(now - 30 * 24 * 60 * 60_000) } } }),
  ]);

  return NextResponse.json({
    ok: true,
    webhooks: retried,
    auditSinks,
    billing,
    tokenRefreshes,
    approvalsEscalated,
    health,
    identityDocuments,
    prunedAgentEvents,
    alertsFired: alerts.length,
    credentialsExpiring: expiring.count,
    credentialsExpired: expired.count,
    prunedAudit,
    prunedChallenges: challenges.count,
    prunedRateLimits: counters.count,
    prunedBlocklist: blocklist.count,
    prunedIdempotency: idempotency.count,
    prunedLoginTokens: loginTokens.count,
    prunedDeliveries: deliveries.count,
    prunedSessions: sessions.count,
    prunedInvitations: invitations.count,
    prunedRequestErrors: requestErrors.count,
  });
}

export async function GET(req: Request) {
  return run(req);
}

export async function POST(req: Request) {
  return run(req);
}
