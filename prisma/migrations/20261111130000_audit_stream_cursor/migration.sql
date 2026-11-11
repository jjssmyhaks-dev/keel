-- DropIndex
DROP INDEX "AuditSinkDelivery_sinkId_createdAt_idx";

-- AlterTable
ALTER TABLE "AuditSinkDelivery" ADD COLUMN     "environmentId" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "AuditSinkDelivery_sinkId_environmentId_seq_idx" ON "AuditSinkDelivery"("sinkId", "environmentId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "AuditSinkDelivery_sinkId_eventId_key" ON "AuditSinkDelivery"("sinkId", "eventId");
