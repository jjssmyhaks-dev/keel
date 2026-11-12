-- Payload-free record of one agent decision. No request or response content.
CREATE TABLE "AgentEvent" (
    "id" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "environmentId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "agentType" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "connectorSlug" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "riskClass" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "decisionReasonCode" TEXT NOT NULL,
    "approvalLatencyMs" INTEGER,
    "upstreamStatusClass" TEXT,
    "latencyMs" INTEGER,
    "costUnits" INTEGER NOT NULL DEFAULT 1,
    "delegationDepth" INTEGER NOT NULL DEFAULT 0,
    "isSandbox" BOOLEAN NOT NULL DEFAULT false,
    "contributes" BOOLEAN NOT NULL DEFAULT false,
    "credentialId" TEXT,

    CONSTRAINT "AgentEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AgentEvent_environmentId_occurredAt_idx" ON "AgentEvent"("environmentId", "occurredAt");
CREATE INDEX "AgentEvent_agentId_occurredAt_idx" ON "AgentEvent"("agentId", "occurredAt");
CREATE INDEX "AgentEvent_organizationId_occurredAt_idx" ON "AgentEvent"("organizationId", "occurredAt");
CREATE INDEX "AgentEvent_connectorSlug_action_idx" ON "AgentEvent"("connectorSlug", "action");
