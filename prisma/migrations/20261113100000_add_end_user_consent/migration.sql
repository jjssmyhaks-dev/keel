-- End-user consent: branding, hosted consent requests, end-user control center,
-- per-end-user credentials and the data-rights queue.
--
-- Consent was unused before this migration, but environmentId is derived from
-- the consent's agent so any row a deployment happens to hold is preserved.

-- AlterTable
ALTER TABLE "AgentEvent" ADD COLUMN     "endUserId" TEXT;

-- AlterTable
ALTER TABLE "Consent" ADD COLUMN     "consentRequestId" TEXT,
ADD COLUMN     "environmentId" TEXT,
ADD COLUMN     "grantIdsJson" TEXT NOT NULL DEFAULT '[]',
ADD COLUMN     "lastUsedAt" TIMESTAMP(3);

UPDATE "Consent" c SET "environmentId" = a."environmentId"
FROM "Agent" a WHERE a."id" = c."agentId";

ALTER TABLE "Consent" ALTER COLUMN "environmentId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Credential" ADD COLUMN     "endUserId" TEXT;

-- AlterTable
ALTER TABLE "EndUser" ADD COLUMN     "lastSeenAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Grant" ADD COLUMN     "consentId" TEXT,
ADD COLUMN     "endUserId" TEXT;

-- CreateTable
CREATE TABLE "ConsentBranding" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "logoDataUri" TEXT,
    "primaryColor" TEXT NOT NULL DEFAULT '#111111',
    "supportUrl" TEXT,
    "privacyUrl" TEXT,
    "consentText" TEXT NOT NULL DEFAULT '',
    "consentTextVersion" INTEGER NOT NULL DEFAULT 1,
    "allowedRedirectUrisJson" TEXT NOT NULL DEFAULT '[]',
    "allowedScopesJson" TEXT NOT NULL DEFAULT '["*"]',
    "maxRisk" TEXT NOT NULL DEFAULT 'write',
    "maxGrantDays" INTEGER NOT NULL DEFAULT 90,
    "verifiedDomain" TEXT,
    "domainVerificationToken" TEXT,
    "domainVerifiedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConsentBranding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsentRequest" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "environmentId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "endUserId" TEXT,
    "externalUserId" TEXT NOT NULL,
    "email" TEXT,
    "scopesJson" TEXT NOT NULL DEFAULT '[]',
    "connectorSlugsJson" TEXT NOT NULL DEFAULT '[]',
    "redirectUri" TEXT NOT NULL,
    "state" TEXT,
    "tokenHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "codeHash" TEXT,
    "codeExpiresAt" TIMESTAMP(3),
    "durationOptionsJson" TEXT NOT NULL DEFAULT '[]',
    "consentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ConsentRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EndUserLink" (
    "id" TEXT NOT NULL,
    "endUserId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT 'control_center',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EndUserLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EndUserSession" (
    "id" TEXT NOT NULL,
    "endUserId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EndUserSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataRequest" (
    "id" TEXT NOT NULL,
    "endUserId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "completedBy" TEXT,

    CONSTRAINT "DataRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ConsentBranding_projectId_key" ON "ConsentBranding"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ConsentRequest_tokenHash_key" ON "ConsentRequest"("tokenHash");

-- CreateIndex
CREATE INDEX "ConsentRequest_projectId_status_idx" ON "ConsentRequest"("projectId", "status");

-- CreateIndex
CREATE INDEX "ConsentRequest_environmentId_idx" ON "ConsentRequest"("environmentId");

-- CreateIndex
CREATE UNIQUE INDEX "EndUserLink_tokenHash_key" ON "EndUserLink"("tokenHash");

-- CreateIndex
CREATE INDEX "EndUserLink_endUserId_idx" ON "EndUserLink"("endUserId");

-- CreateIndex
CREATE UNIQUE INDEX "EndUserSession_tokenHash_key" ON "EndUserSession"("tokenHash");

-- CreateIndex
CREATE INDEX "EndUserSession_endUserId_idx" ON "EndUserSession"("endUserId");

-- CreateIndex
CREATE INDEX "DataRequest_projectId_status_idx" ON "DataRequest"("projectId", "status");

-- CreateIndex
CREATE INDEX "DataRequest_endUserId_idx" ON "DataRequest"("endUserId");

-- CreateIndex
CREATE INDEX "AgentEvent_endUserId_occurredAt_idx" ON "AgentEvent"("endUserId", "occurredAt");

-- CreateIndex
CREATE INDEX "Consent_projectId_endUserId_idx" ON "Consent"("projectId", "endUserId");

-- CreateIndex
CREATE INDEX "Credential_endUserId_idx" ON "Credential"("endUserId");

-- CreateIndex
CREATE INDEX "Grant_endUserId_idx" ON "Grant"("endUserId");

