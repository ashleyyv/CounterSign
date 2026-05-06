-- CreateTable
CREATE TABLE "DocumentDiff" (
    "id" TEXT NOT NULL,
    "currentDocumentHash" TEXT NOT NULL,
    "priorDocumentHash" TEXT NOT NULL,
    "rawDiff" JSONB NOT NULL,
    "aiModelVersion" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentDiff_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DocumentDiff_currentDocumentHash_priorDocumentHash_key" ON "DocumentDiff"("currentDocumentHash", "priorDocumentHash");

-- CreateIndex
CREATE INDEX "DocumentDiff_currentDocumentHash_idx" ON "DocumentDiff"("currentDocumentHash");
