-- CreateEnum
CREATE TYPE "CropJobStatus" AS ENUM ('pending', 'running', 'succeeded', 'failed');

-- CreateTable
CREATE TABLE "CropJob" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "status" "CropJobStatus" NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "requestPayload" JSONB,
    "resultPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CropJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CropJob_shop_createdAt_idx" ON "CropJob"("shop", "createdAt");

-- CreateIndex
CREATE INDEX "CropJob_status_updatedAt_idx" ON "CropJob"("status", "updatedAt");
