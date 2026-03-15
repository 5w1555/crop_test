-- CreateTable
CREATE TABLE "MediaWritebackIdempotency" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "sourceMediaId" TEXT NOT NULL,
    "cropParamsHash" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "destinationMediaId" TEXT,
    "updatedImageUrl" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MediaWritebackIdempotency_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MediaWritebackIdempotency_shop_sourceMediaId_cropParamsHash_key"
ON "MediaWritebackIdempotency"("shop", "sourceMediaId", "cropParamsHash");

-- CreateIndex
CREATE INDEX "MediaWritebackIdempotency_shop_createdAt_idx"
ON "MediaWritebackIdempotency"("shop", "createdAt");
