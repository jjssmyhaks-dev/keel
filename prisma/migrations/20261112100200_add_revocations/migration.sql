-- Environment-scoped revocation list. agentId is deliberately not a foreign
-- key so an entry survives deletion of the agent row.
CREATE TABLE "Revocation" (
    "id" TEXT NOT NULL,
    "environmentId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Revocation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Revocation_agentId_key" ON "Revocation"("agentId");
CREATE INDEX "Revocation_environmentId_revokedAt_idx" ON "Revocation"("environmentId", "revokedAt");
