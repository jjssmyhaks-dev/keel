-- Signed, portable agent identity documents. One current row per agent; the
-- previous row is superseded rather than deleted.
CREATE TABLE "AgentIdentityDocument" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "docSeq" INTEGER NOT NULL,
    "documentJson" TEXT NOT NULL,
    "jws" TEXT NOT NULL,
    "issuerKeyId" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersededAt" TIMESTAMP(3),

    CONSTRAINT "AgentIdentityDocument_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AgentIdentityDocument_agentId_docSeq_key" ON "AgentIdentityDocument"("agentId", "docSeq");
CREATE INDEX "AgentIdentityDocument_agentId_supersededAt_idx" ON "AgentIdentityDocument"("agentId", "supersededAt");

ALTER TABLE "Agent" ADD COLUMN "verificationVisibility" TEXT NOT NULL DEFAULT 'public';
