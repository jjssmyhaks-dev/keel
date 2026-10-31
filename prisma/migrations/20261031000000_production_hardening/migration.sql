-- Replay protection for signed agent challenges.
CREATE TABLE "ChallengeUse" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChallengeUse_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ChallengeUse_key_key" ON "ChallengeUse"("key");
CREATE INDEX "ChallengeUse_agentId_idx" ON "ChallengeUse"("agentId");
CREATE INDEX "ChallengeUse_usedAt_idx" ON "ChallengeUse"("usedAt");

-- Durable fixed-window counters for authentication throttling.
CREATE TABLE "RateLimitCounter" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "resetAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimitCounter_pkey" PRIMARY KEY ("key")
);

CREATE INDEX "RateLimitCounter_resetAt_idx" ON "RateLimitCounter"("resetAt");
