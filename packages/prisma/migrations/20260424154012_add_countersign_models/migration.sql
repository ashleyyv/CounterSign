-- CreateTable
CREATE TABLE "DocumentReview" (
    "id" TEXT NOT NULL,
    "documentHash" TEXT NOT NULL,
    "summary" JSONB NOT NULL,
    "flaggedClauses" JSONB NOT NULL,
    "documentType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SignerPreferences" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "targets" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SignerPreferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ForwardEvent" (
    "id" TEXT NOT NULL,
    "envelopeId" TEXT NOT NULL,
    "senderId" INTEGER NOT NULL,
    "targetEmail" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ForwardEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DocumentReview_documentHash_key" ON "DocumentReview"("documentHash");

-- CreateIndex
CREATE UNIQUE INDEX "SignerPreferences_userId_key" ON "SignerPreferences"("userId");

-- CreateIndex
CREATE INDEX "ForwardEvent_envelopeId_idx" ON "ForwardEvent"("envelopeId");

-- CreateIndex
CREATE INDEX "ForwardEvent_senderId_idx" ON "ForwardEvent"("senderId");

-- AddForeignKey
ALTER TABLE "SignerPreferences" ADD CONSTRAINT "SignerPreferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForwardEvent" ADD CONSTRAINT "ForwardEvent_envelopeId_fkey" FOREIGN KEY ("envelopeId") REFERENCES "Envelope"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ForwardEvent" ADD CONSTRAINT "ForwardEvent_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
