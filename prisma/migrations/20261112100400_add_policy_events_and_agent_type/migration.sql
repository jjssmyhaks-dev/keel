-- Agent type for policy capture, and one record per permission change.
ALTER TABLE "Agent" ADD COLUMN "agentType" TEXT NOT NULL DEFAULT 'other';

CREATE TABLE "PolicyEvent" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "environmentId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "agentType" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "grantId" TEXT,
    "approvalPolicyId" TEXT,
    "connectorSlug" TEXT,
    "actionSetJson" TEXT NOT NULL DEFAULT '[]',
    "resourceShape" TEXT NOT NULL,
    "approvalMode" TEXT,
    "conditionKeysJson" TEXT NOT NULL DEFAULT '[]',
    "changeKind" TEXT NOT NULL,
    "changedFromEventId" TEXT,
    "isSandbox" BOOLEAN NOT NULL DEFAULT false,
    "contributes" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "PolicyEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PolicyEvent_environmentId_createdAt_idx" ON "PolicyEvent"("environmentId", "createdAt");
CREATE INDEX "PolicyEvent_organizationId_createdAt_idx" ON "PolicyEvent"("organizationId", "createdAt");
