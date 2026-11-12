-- Data contribution defaults to true for new organizations. Organizations that
-- already exist when this migration runs are opted out, so no pre-existing
-- customer is counted as having consented.
ALTER TABLE "Organization" ADD COLUMN "dataContributionEnabled" BOOLEAN NOT NULL DEFAULT true;
UPDATE "Organization" SET "dataContributionEnabled" = false;

CREATE TABLE "DataContributionChange" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "changedBy" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DataContributionChange_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DataContributionChange_organizationId_changedAt_idx" ON "DataContributionChange"("organizationId", "changedAt");
