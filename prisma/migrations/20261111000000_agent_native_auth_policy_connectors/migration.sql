-- Pillar A: one-click OAuth connections, token lifecycle and health checks
ALTER TABLE "Credential" ADD COLUMN "oauthAppId" TEXT;
ALTER TABLE "Credential" ADD COLUMN "oauthScopes" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "Credential" ADD COLUMN "tokenEndpoint" TEXT;
ALTER TABLE "Credential" ADD COLUMN "tokenExpiresAt" TIMESTAMP(3);
ALTER TABLE "Credential" ADD COLUMN "refreshable" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Credential" ADD COLUMN "lastHealthCheckAt" TIMESTAMP(3);

CREATE TABLE "OAuthApp" (
    "id" TEXT NOT NULL,
    "environmentId" TEXT NOT NULL,
    "connectorSlug" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'custom',
    "clientId" TEXT NOT NULL,
    "clientSecretEncrypted" TEXT NOT NULL,
    "dataKeyEncrypted" TEXT NOT NULL,
    "authorizeUrl" TEXT,
    "tokenUrl" TEXT,
    "scopesJson" TEXT NOT NULL DEFAULT '[]',
    "scopeSeparator" TEXT NOT NULL DEFAULT ' ',
    "tokenAuth" TEXT NOT NULL DEFAULT 'body',
    "pkce" BOOLEAN NOT NULL DEFAULT true,
    "extraAuthParamsJson" TEXT NOT NULL DEFAULT '{}',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OAuthApp_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OAuthApp_environmentId_connectorSlug_key" ON "OAuthApp"("environmentId", "connectorSlug");
CREATE INDEX "OAuthApp_environmentId_idx" ON "OAuthApp"("environmentId");

ALTER TABLE "OAuthApp" ADD CONSTRAINT "OAuthApp_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "Environment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Pillar B: agent-native credentials, workload identity and DPoP
CREATE TABLE "AgentClientSecret" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT 'default',
    "secretHash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "scopesJson" TEXT NOT NULL DEFAULT '[]',
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentClientSecret_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AgentClientSecret_secretHash_key" ON "AgentClientSecret"("secretHash");
CREATE INDEX "AgentClientSecret_agentId_idx" ON "AgentClientSecret"("agentId");

ALTER TABLE "AgentClientSecret" ADD CONSTRAINT "AgentClientSecret_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "WorkloadIdentity" (
    "id" TEXT NOT NULL,
    "environmentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "audience" TEXT NOT NULL,
    "jwksUrl" TEXT,
    "jwksJson" TEXT,
    "agentId" TEXT,
    "subjectPattern" TEXT,
    "requiredClaimsJson" TEXT NOT NULL DEFAULT '{}',
    "tokenTtlSeconds" INTEGER NOT NULL DEFAULT 300,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkloadIdentity_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WorkloadIdentity_environmentId_idx" ON "WorkloadIdentity"("environmentId");

ALTER TABLE "WorkloadIdentity" ADD CONSTRAINT "WorkloadIdentity_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "Environment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "DpopProofUse" (
    "id" TEXT NOT NULL,
    "jkt" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DpopProofUse_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DpopProofUse_expiresAt_idx" ON "DpopProofUse"("expiresAt");

-- Pillar C: approval SLAs and just-in-time grants
ALTER TABLE "Grant" ADD COLUMN "justInTime" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Grant" ADD COLUMN "activatedAt" TIMESTAMP(3);

ALTER TABLE "ApprovalPolicy" ADD COLUMN "slaMinutes" INTEGER;
ALTER TABLE "ApprovalPolicy" ADD COLUMN "escalateToRole" TEXT;

ALTER TABLE "ApprovalRequest" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'action';
ALTER TABLE "ApprovalRequest" ADD COLUMN "grantSpecJson" TEXT NOT NULL DEFAULT '{}';
ALTER TABLE "ApprovalRequest" ADD COLUMN "slaDueAt" TIMESTAMP(3);
ALTER TABLE "ApprovalRequest" ADD COLUMN "escalatedAt" TIMESTAMP(3);

-- Pillar D: custom connectors imported from OpenAPI with version history
CREATE TABLE "CustomConnector" (
    "id" TEXT NOT NULL,
    "environmentId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'Custom',
    "color" TEXT NOT NULL DEFAULT '#333333',
    "mark" TEXT NOT NULL DEFAULT 'CU',
    "version" INTEGER NOT NULL DEFAULT 1,
    "hostsJson" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "injectionJson" TEXT NOT NULL,
    "credentialFieldsJson" TEXT NOT NULL DEFAULT '[]',
    "actionsJson" TEXT NOT NULL,
    "healthCheckJson" TEXT,
    "specVersion" TEXT,
    "specHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "CustomConnector_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CustomConnector_environmentId_slug_key" ON "CustomConnector"("environmentId", "slug");
CREATE INDEX "CustomConnector_environmentId_idx" ON "CustomConnector"("environmentId");

ALTER TABLE "CustomConnector" ADD CONSTRAINT "CustomConnector_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "Environment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "CustomConnectorVersion" (
    "id" TEXT NOT NULL,
    "customConnectorId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "hostsJson" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "injectionJson" TEXT NOT NULL,
    "credentialFieldsJson" TEXT NOT NULL DEFAULT '[]',
    "actionsJson" TEXT NOT NULL,
    "healthCheckJson" TEXT,
    "specVersion" TEXT,
    "specHash" TEXT NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomConnectorVersion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CustomConnectorVersion_customConnectorId_version_key" ON "CustomConnectorVersion"("customConnectorId", "version");
CREATE INDEX "CustomConnectorVersion_customConnectorId_idx" ON "CustomConnectorVersion"("customConnectorId");

ALTER TABLE "CustomConnectorVersion" ADD CONSTRAINT "CustomConnectorVersion_customConnectorId_fkey" FOREIGN KEY ("customConnectorId") REFERENCES "CustomConnector"("id") ON DELETE CASCADE ON UPDATE CASCADE;
