-- CreateTable
CREATE TABLE "MfaUse" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MfaUse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MfaUse_key_key" ON "MfaUse"("key");

-- CreateIndex
CREATE INDEX "MfaUse_userId_idx" ON "MfaUse"("userId");

-- CreateIndex
CREATE INDEX "MfaUse_usedAt_idx" ON "MfaUse"("usedAt");
