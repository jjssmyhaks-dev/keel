-- Stripe linkage and subscription state on organizations
ALTER TABLE "Organization" ADD COLUMN "planStatus" TEXT NOT NULL DEFAULT 'active';
ALTER TABLE "Organization" ADD COLUMN "stripeCustomerId" TEXT;
ALTER TABLE "Organization" ADD COLUMN "stripeSubscriptionId" TEXT;
CREATE UNIQUE INDEX "Organization_stripeCustomerId_key" ON "Organization"("stripeCustomerId");

-- Alert deduplication: when a rule last fired
ALTER TABLE "AlertRule" ADD COLUMN "lastFiredAt" TIMESTAMP(3);
