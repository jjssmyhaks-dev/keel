import { db } from "./db";

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

export type RateLimitResult = { allowed: boolean; remaining: number; resetAt: number };

export function checkRateLimit(key: string, limit: number, windowMs = 60_000): RateLimitResult {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, resetAt: now + windowMs };
  }
  if (bucket.count >= limit) {
    return { allowed: false, remaining: 0, resetAt: bucket.resetAt };
  }
  bucket.count += 1;
  return { allowed: true, remaining: limit - bucket.count, resetAt: bucket.resetAt };
}

export async function consumeRateLimit(
  key: string,
  limit: number,
  windowMs = 60_000,
): Promise<RateLimitResult> {
  const now = new Date();
  const resetAt = new Date(now.getTime() + windowMs);
  try {
    const rows = await db.$queryRaw<{ count: number; resetAt: Date }[]>`
      INSERT INTO "RateLimitCounter" ("key", "count", "resetAt")
      VALUES (${key}, 1, ${resetAt})
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE WHEN "RateLimitCounter"."resetAt" <= ${now} THEN 1 ELSE "RateLimitCounter"."count" + 1 END,
        "resetAt" = CASE WHEN "RateLimitCounter"."resetAt" <= ${now} THEN ${resetAt} ELSE "RateLimitCounter"."resetAt" END
      RETURNING "count", "resetAt"
    `;
    const row = rows[0];
    if (!row) return { allowed: true, remaining: limit - 1, resetAt: resetAt.getTime() };
    const count = Number(row.count);
    return {
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
      resetAt: new Date(row.resetAt).getTime(),
    };
  } catch (error) {
    console.error("[authab] durable rate limiter unavailable, using in-memory fallback", error);
    return checkRateLimit(key, limit, windowMs);
  }
}

export async function pruneRateLimitCounters(olderThanMs = 86_400_000) {
  return db.rateLimitCounter.deleteMany({ where: { resetAt: { lt: new Date(Date.now() - olderThanMs) } } });
}

setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt < now) buckets.delete(key);
  }
}, 60_000).unref?.();
