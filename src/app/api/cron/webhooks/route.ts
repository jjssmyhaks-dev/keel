import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { retryPendingWebhooks } from "@/lib/webhooks";
import { pruneRateLimitCounters } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

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
  const retried = await retryPendingWebhooks(25);
  const [challenges, counters, blocklist, idempotency, loginTokens, deliveries] = await Promise.all([
    db.challengeUse.deleteMany({ where: { usedAt: { lt: new Date(now - 24 * 60 * 60_000) } } }),
    pruneRateLimitCounters(),
    db.tokenBlocklist.deleteMany({ where: { expiresAt: { lt: new Date(now) } } }),
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
  ]);

  return NextResponse.json({
    ok: true,
    webhooks: retried,
    prunedChallenges: challenges.count,
    prunedRateLimits: counters.count,
    prunedBlocklist: blocklist.count,
    prunedIdempotency: idempotency.count,
    prunedLoginTokens: loginTokens.count,
    prunedDeliveries: deliveries.count,
  });
}

export async function GET(req: Request) {
  return run(req);
}

export async function POST(req: Request) {
  return run(req);
}
