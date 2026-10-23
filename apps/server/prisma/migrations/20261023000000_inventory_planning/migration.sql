-- CreateTable
CREATE TABLE "Stocktake" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "title" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'DRAFT' CHECK ("status" IN ('DRAFT', 'POSTED', 'VOIDED', 'CANCELLED')),
    "version" INTEGER NOT NULL DEFAULT 1 CHECK ("version" > 0),
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "postedAt" DATETIME,
    "voidedAt" DATETIME,
    "voidReason" TEXT,
    "adjustmentDocumentId" INTEGER,
    CONSTRAINT "Stocktake_adjustmentDocumentId_fkey" FOREIGN KEY ("adjustmentDocumentId") REFERENCES "BusinessDocument" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StocktakeLine" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "stocktakeId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "itemName" TEXT NOT NULL,
    "specification" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "baselineUnits" BIGINT NOT NULL,
    "stockVersion" INTEGER NOT NULL,
    "baselineAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualUnits" BIGINT CHECK ("actualUnits" IS NULL OR "actualUnits" >= 0),
    "countedAt" DATETIME,
    "reason" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "StocktakeLine_stocktakeId_fkey" FOREIGN KEY ("stocktakeId") REFERENCES "Stocktake" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StocktakeLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "CatalogProduct" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StockPolicy" (
    "productId" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "minimumUnits" BIGINT NOT NULL DEFAULT 0 CHECK ("minimumUnits" >= 0),
    "targetUnits" BIGINT NOT NULL CHECK ("targetUnits" > 0 AND "targetUnits" >= "minimumUnits"),
    "multipleUnits" BIGINT CHECK ("multipleUnits" IS NULL OR "multipleUnits" > 0),
    "note" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 1 CHECK ("version" > 0),
    CONSTRAINT "StockPolicy_productId_fkey" FOREIGN KEY ("productId") REFERENCES "CatalogProduct" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ReplenishmentDraft" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "title" TEXT NOT NULL,
    "department" TEXT NOT NULL DEFAULT '',
    "handler" TEXT NOT NULL DEFAULT '',
    "requestDate" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'DRAFT' CHECK ("status" IN ('DRAFT', 'CONVERTED', 'DISCARDED')),
    "version" INTEGER NOT NULL DEFAULT 1 CHECK ("version" > 0),
    "requestId" INTEGER,
    "requestSerial" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" DATETIME,
    CONSTRAINT "ReplenishmentDraft_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ProcurementRequest" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ReplenishmentDraftLine" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "draftId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "itemName" TEXT NOT NULL,
    "specification" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "quantityUnits" BIGINT NOT NULL CHECK ("quantityUnits" > 0),
    "suggestion" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "ReplenishmentDraftLine_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "ReplenishmentDraft" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ReplenishmentDraftLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "CatalogProduct" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PurchaseFollowup" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "kind" TEXT NOT NULL,
    "purchaseLineId" INTEGER,
    "purchaseDocumentId" INTEGER,
    "expectedDate" TEXT,
    "nextDate" TEXT,
    "dismissedAt" DATETIME,
    "dismissReason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1 CHECK ("version" > 0),
    CHECK (("kind" = 'ARRIVAL' AND "purchaseLineId" IS NOT NULL AND "purchaseDocumentId" IS NULL) OR ("kind" = 'INVOICE' AND "purchaseDocumentId" IS NOT NULL AND "purchaseLineId" IS NULL)),
    CONSTRAINT "PurchaseFollowup_purchaseLineId_fkey" FOREIGN KEY ("purchaseLineId") REFERENCES "BusinessLine" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PurchaseFollowup_purchaseDocumentId_fkey" FOREIGN KEY ("purchaseDocumentId") REFERENCES "BusinessDocument" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PurchaseFollowupEntry" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "followupId" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT NOT NULL,
    "changed" TEXT NOT NULL,
    CONSTRAINT "PurchaseFollowupEntry_followupId_fkey" FOREIGN KEY ("followupId") REFERENCES "PurchaseFollowup" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Additive migration preserves existing indexes, constraints and foreign keys.
ALTER TABLE "CatalogProduct" ADD COLUMN "stockVersion" INTEGER NOT NULL DEFAULT 0 CHECK ("stockVersion" >= 0);
ALTER TABLE "ProcurementRequest" ADD COLUMN "purpose" TEXT NOT NULL DEFAULT 'GENERAL' CHECK ("purpose" IN ('GENERAL', 'STOCK_REPLENISHMENT'));

-- CreateIndex
CREATE UNIQUE INDEX "Stocktake_adjustmentDocumentId_key" ON "Stocktake"("adjustmentDocumentId");

-- CreateIndex
CREATE INDEX "Stocktake_status_createdAt_idx" ON "Stocktake"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "StocktakeLine_stocktakeId_productId_key" ON "StocktakeLine"("stocktakeId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "ReplenishmentDraft_requestId_key" ON "ReplenishmentDraft"("requestId");

-- CreateIndex
CREATE INDEX "ReplenishmentDraft_status_createdAt_idx" ON "ReplenishmentDraft"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReplenishmentDraftLine_draftId_productId_key" ON "ReplenishmentDraftLine"("draftId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseFollowup_purchaseLineId_key" ON "PurchaseFollowup"("purchaseLineId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseFollowup_purchaseDocumentId_key" ON "PurchaseFollowup"("purchaseDocumentId");

-- CreateIndex
CREATE INDEX "PurchaseFollowupEntry_followupId_id_idx" ON "PurchaseFollowupEntry"("followupId", "id");
