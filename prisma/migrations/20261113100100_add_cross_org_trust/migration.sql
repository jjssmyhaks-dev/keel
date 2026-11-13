-- Cross-organization agent trust: external agent markers on Agent, plus the
-- owner/external relationship record that links an external agent to its
-- shadow agent in the owner environment.

-- AlterTable
ALTER TABLE "Agent" ADD COLUMN     "externalAgentId" TEXT,
ADD COLUMN     "externalEnvironmentId" TEXT,
ADD COLUMN     "externalOrgName" TEXT,
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'internal';

-- CreateTable
CREATE TABLE "TrustRelationship" (
    "id" TEXT NOT NULL,
    "ownerEnvironmentId" TEXT NOT NULL,
    "externalAgentId" TEXT NOT NULL,
    "externalEnvironmentId" TEXT NOT NULL,
    "shadowAgentId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'invited',
    "maxScopesJson" TEXT NOT NULL DEFAULT '[]',
    "note" TEXT,
    "invitedBy" TEXT NOT NULL,
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedBy" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "revokedBy" TEXT,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "TrustRelationship_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TrustRelationship_externalEnvironmentId_idx" ON "TrustRelationship"("externalEnvironmentId");

-- CreateIndex
CREATE UNIQUE INDEX "TrustRelationship_ownerEnvironmentId_externalAgentId_key" ON "TrustRelationship"("ownerEnvironmentId", "externalAgentId");

-- CreateIndex
CREATE INDEX "Agent_externalAgentId_idx" ON "Agent"("externalAgentId");
