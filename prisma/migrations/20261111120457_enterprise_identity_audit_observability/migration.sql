-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "hostedUrl" TEXT,
ADD COLUMN     "paidAt" TIMESTAMP(3),
ADD COLUMN     "pdfUrl" TEXT;

-- AlterTable
ALTER TABLE "LoginToken" ADD COLUMN     "metaJson" TEXT NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "Membership" ADD COLUMN     "deactivatedAt" TIMESTAMP(3),
ADD COLUMN     "permissionsJson" TEXT NOT NULL DEFAULT '[]',
ADD COLUMN     "scimExternalId" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'active';

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "billingAddressJson" TEXT NOT NULL DEFAULT '{}',
ADD COLUMN     "dunningStartedAt" TIMESTAMP(3),
ADD COLUMN     "requireMfa" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "requireSso" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "ssoDefaultRole" TEXT NOT NULL DEFAULT 'developer',
ADD COLUMN     "taxId" TEXT,
ADD COLUMN     "trialEndsAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "authMethod" TEXT NOT NULL DEFAULT 'password',
ADD COLUMN     "mfaVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "ssoConnectionId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "mfaRecoveryCodesJson" TEXT NOT NULL DEFAULT '[]',
ADD COLUMN     "twoFactorDataKey" TEXT;

-- CreateTable
CREATE TABLE "SsoConnection" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "domainsJson" TEXT NOT NULL DEFAULT '[]',
    "defaultRole" TEXT NOT NULL DEFAULT 'developer',
    "groupMappingJson" TEXT NOT NULL DEFAULT '{}',
    "configEncrypted" TEXT NOT NULL,
    "configDataKey" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "enforced" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SsoConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SsoIdentity" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SsoIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScimToken" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "createdBy" TEXT,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScimToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditSink" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secretEncrypted" TEXT,
    "secretDataKey" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastDeliveryAt" TIMESTAMP(3),
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuditSink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditSinkDelivery" (
    "id" TEXT NOT NULL,
    "sinkId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "statusCode" INTEGER,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "nextRetryAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditSinkDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Incident" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "component" TEXT NOT NULL,
    "impact" TEXT NOT NULL DEFAULT 'minor',
    "status" TEXT NOT NULL DEFAULT 'investigating',
    "body" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Incident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidentUpdate" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncidentUpdate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErrorEvent" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "environmentId" TEXT,
    "requestId" TEXT NOT NULL,
    "traceId" TEXT,
    "route" TEXT NOT NULL,
    "method" TEXT,
    "message" TEXT NOT NULL,
    "digest" TEXT,
    "stack" TEXT,
    "userAgent" TEXT,
    "ip" TEXT,
    "userId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ErrorEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SsoConnection_orgId_idx" ON "SsoConnection"("orgId");

-- CreateIndex
CREATE INDEX "SsoIdentity_userId_idx" ON "SsoIdentity"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "SsoIdentity_connectionId_subject_key" ON "SsoIdentity"("connectionId", "subject");

-- CreateIndex
CREATE UNIQUE INDEX "ScimToken_tokenHash_key" ON "ScimToken"("tokenHash");

-- CreateIndex
CREATE INDEX "ScimToken_orgId_idx" ON "ScimToken"("orgId");

-- CreateIndex
CREATE INDEX "AuditSink_orgId_idx" ON "AuditSink"("orgId");

-- CreateIndex
CREATE INDEX "AuditSinkDelivery_sinkId_createdAt_idx" ON "AuditSinkDelivery"("sinkId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditSinkDelivery_nextRetryAt_idx" ON "AuditSinkDelivery"("nextRetryAt");

-- CreateIndex
CREATE INDEX "Incident_startedAt_idx" ON "Incident"("startedAt");

-- CreateIndex
CREATE INDEX "IncidentUpdate_incidentId_idx" ON "IncidentUpdate"("incidentId");

-- CreateIndex
CREATE INDEX "ErrorEvent_createdAt_idx" ON "ErrorEvent"("createdAt");

-- CreateIndex
CREATE INDEX "ErrorEvent_orgId_createdAt_idx" ON "ErrorEvent"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "Membership_scimExternalId_idx" ON "Membership"("scimExternalId");

-- AddForeignKey
ALTER TABLE "SsoConnection" ADD CONSTRAINT "SsoConnection_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SsoIdentity" ADD CONSTRAINT "SsoIdentity_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "SsoConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SsoIdentity" ADD CONSTRAINT "SsoIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScimToken" ADD CONSTRAINT "ScimToken_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditSink" ADD CONSTRAINT "AuditSink_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditSinkDelivery" ADD CONSTRAINT "AuditSinkDelivery_sinkId_fkey" FOREIGN KEY ("sinkId") REFERENCES "AuditSink"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentUpdate" ADD CONSTRAINT "IncidentUpdate_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErrorEvent" ADD CONSTRAINT "ErrorEvent_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- WORM retention: the audit table is append-only. Rows may only be mutated by a
-- documented maintenance job that opts in per-transaction with
-- SET LOCAL app.audit_maintenance = 'on'.
CREATE OR REPLACE FUNCTION authab_audit_events_immutable() RETURNS trigger AS $$
BEGIN
  IF current_setting('app.audit_maintenance', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'AuditEvent is append-only; % is blocked by WORM retention', TG_OP
    USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_events_immutable
  BEFORE UPDATE OR DELETE ON "AuditEvent"
  FOR EACH ROW EXECUTE FUNCTION authab_audit_events_immutable();
