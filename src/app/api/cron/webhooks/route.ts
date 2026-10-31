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

  const retried = await retryPendingWebhooks(25);
  const [challenges, counters] = await Promise.all([
    db.challengeUse.deleteMany({ where: { usedAt: { lt: new Date(Date.now() - 24 * 60 * 60_000) } } }),
    pruneRateLimitCounters(),
  ]);

  return NextResponse.json({
    ok: true,
    webhooks: retried,
    prunedChallenges: challenges.count,
    prunedRateLimits: counters.count,
  });
}

export async function GET(req: Request) {
  return run(req);
}

export async function POST(req: Request) {
  return run(req);
}
