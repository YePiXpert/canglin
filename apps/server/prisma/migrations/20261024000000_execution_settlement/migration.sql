-- CreateTable
CREATE TABLE "ProcurementBatch" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "title" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" DATETIME,
    "cancelReason" TEXT,
    CHECK ("status" IN ('DRAFT','CONFIRMED','CANCELLED')),
    CHECK ("version" > 0)
);

-- CreateTable
CREATE TABLE "ProcurementBatchLine" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "batchId" INTEGER NOT NULL,
    "requestLineId" INTEGER,
    "requestSerial" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "itemName" TEXT NOT NULL,
    "specification" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "quantityUnits" BIGINT NOT NULL,
    "supplierId" INTEGER,
    "unitPriceUnits" BIGINT,
    "purchaseLink" TEXT,
    CONSTRAINT "ProcurementBatchLine_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ProcurementBatch" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProcurementBatchLine_requestLineId_fkey" FOREIGN KEY ("requestLineId") REFERENCES "ProcurementLine" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ProcurementBatchLine_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CHECK ("quantityUnits" > 0),
    CHECK ("unitPriceUnits" IS NULL OR "unitPriceUnits" >= 0)
);

-- CreateTable
CREATE TABLE "FinancialRecord" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'POSTED',
    "date" TEXT NOT NULL,
    "supplierId" INTEGER NOT NULL,
    "payer" TEXT NOT NULL,
    "employee" TEXT NOT NULL DEFAULT '',
    "amountUnits" BIGINT NOT NULL,
    "openingReimbursedUnits" BIGINT NOT NULL DEFAULT 0,
    "sourceId" INTEGER,
    "method" TEXT NOT NULL DEFAULT '',
    "reference" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 1,
    "voidReason" TEXT,
    "voidDate" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FinancialRecord_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "FinancialRecord_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "FinancialRecord" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CHECK ("kind" IN ('PAYMENT','REFUND','REIMBURSEMENT','REIMBURSEMENT_RETURN','OPENING')),
    CHECK ("status" IN ('POSTED','VOIDED')),
    CHECK ("payer" IN ('COMPANY','EMPLOYEE')),
    CHECK (("kind" = 'OPENING' AND "amountUnits" >= 0) OR ("kind" != 'OPENING' AND "amountUnits" > 0)),
    CHECK ("openingReimbursedUnits" >= 0),
    CHECK ("kind" = 'OPENING' OR "openingReimbursedUnits" = 0),
    CHECK ("payer" = 'EMPLOYEE' OR "openingReimbursedUnits" = 0),
    CHECK ("version" > 0),
    CHECK (("kind" IN ('PAYMENT','OPENING') AND "sourceId" IS NULL) OR ("kind" NOT IN ('PAYMENT','OPENING') AND "sourceId" IS NOT NULL))
);

-- CreateTable
CREATE TABLE "FinancialAllocation" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "recordId" INTEGER NOT NULL,
    "documentId" INTEGER NOT NULL,
    "amountUnits" BIGINT NOT NULL,
    CONSTRAINT "FinancialAllocation_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "FinancialRecord" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "FinancialAllocation_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "BusinessDocument" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CHECK ("amountUnits" >= 0)
);
-- A fully refunded historical advance can have zero net paid and a reimbursement to return.
CREATE TRIGGER "FinancialAllocation_zero_insert" BEFORE INSERT ON "FinancialAllocation"
WHEN NEW."amountUnits" = 0 AND (SELECT "kind" FROM "FinancialRecord" WHERE "id" = NEW."recordId") != 'OPENING'
BEGIN SELECT RAISE(ABORT, 'Only opening balances may allocate zero'); END;
CREATE TRIGGER "FinancialAllocation_zero_update" BEFORE UPDATE ON "FinancialAllocation"
WHEN NEW."amountUnits" = 0 AND (SELECT "kind" FROM "FinancialRecord" WHERE "id" = NEW."recordId") != 'OPENING'
BEGIN SELECT RAISE(ABORT, 'Only opening balances may allocate zero'); END;

-- CreateTable
CREATE TABLE "InvoiceRecord" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "supplierId" INTEGER NOT NULL,
    "number" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'NORMAL',
    "originalId" INTEGER,
    "amountUnits" BIGINT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "note" TEXT NOT NULL DEFAULT '',
    "voidReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InvoiceRecord_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InvoiceRecord_originalId_fkey" FOREIGN KEY ("originalId") REFERENCES "InvoiceRecord" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CHECK ("kind" IN ('NORMAL','CREDIT')),
    CHECK ("status" IN ('DRAFT','POSTED','VOIDED')),
    CHECK ("amountUnits" > 0),
    CHECK ("version" > 0),
    CHECK (("kind" = 'NORMAL' AND "originalId" IS NULL) OR ("kind" = 'CREDIT' AND "originalId" IS NOT NULL))
);

-- CreateTable
CREATE TABLE "InvoiceAllocation" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "invoiceId" INTEGER NOT NULL,
    "documentId" INTEGER NOT NULL,
    "amountUnits" BIGINT NOT NULL,
    CONSTRAINT "InvoiceAllocation_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "InvoiceRecord" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "InvoiceAllocation_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "BusinessDocument" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CHECK ("amountUnits" > 0)
);

-- CreateTable
CREATE TABLE "ExceptionDisposition" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "action" TEXT NOT NULL,
    "untilDate" TEXT,
    "reason" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" DATETIME NOT NULL,
    CHECK ("action" IN ('SNOOZE','IGNORE','RESUME')),
    CHECK ("version" > 0)
);

-- CreateTable
CREATE TABLE "ExceptionHistory" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "key" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "untilDate" TEXT,
    "reason" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExceptionHistory_key_fkey" FOREIGN KEY ("key") REFERENCES "ExceptionDisposition" ("key") ON DELETE RESTRICT ON UPDATE CASCADE,
    CHECK ("action" IN ('SNOOZE','IGNORE','RESUME'))
);

-- CreateTable
CREATE TABLE "ExecutionDraft" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "payload" TEXT NOT NULL,
    "basis" TEXT NOT NULL,
    "suggestion" TEXT,
    "prompt" TEXT,
    "explanation" TEXT,
    "result" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CHECK ("kind" IN ('PURCHASE_BATCH','RECEIPT','STOCK_IN','DISTRIBUTION','INVOICE_MATCH')),
    CHECK ("source" IN ('MANUAL','AI')),
    CHECK ("status" IN ('DRAFT','EXECUTED','DISCARDED')),
    CHECK ("version" > 0)
);

-- Additive changes preserve all existing business CHECK constraints and identities.
ALTER TABLE "Attachment" ADD COLUMN "financialRecordId" INTEGER REFERENCES "FinancialRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Attachment" ADD COLUMN "invoiceRecordId" INTEGER REFERENCES "InvoiceRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Attachment" ADD COLUMN "contentHash" TEXT;
ALTER TABLE "BusinessDocument" ADD COLUMN "settlementMode" TEXT NOT NULL DEFAULT 'LEGACY' CHECK ("settlementMode" IN ('LEGACY','DETAIL'));
ALTER TABLE "BusinessDocument" ADD COLUMN "settlementVersion" INTEGER NOT NULL DEFAULT 0 CHECK ("settlementVersion" >= 0);
ALTER TABLE "BusinessDocument" ADD COLUMN "settlementAsOf" TEXT;
ALTER TABLE "BusinessDocument" ADD COLUMN "procurementBatchId" INTEGER REFERENCES "ProcurementBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "ProcurementBatch_status_createdAt_idx" ON "ProcurementBatch"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ProcurementBatchLine_batchId_idx" ON "ProcurementBatchLine"("batchId");

-- CreateIndex
CREATE INDEX "ProcurementBatchLine_requestLineId_idx" ON "ProcurementBatchLine"("requestLineId");

-- CreateIndex
CREATE INDEX "FinancialRecord_supplierId_date_idx" ON "FinancialRecord"("supplierId", "date");

-- CreateIndex
CREATE INDEX "FinancialRecord_sourceId_idx" ON "FinancialRecord"("sourceId");

-- CreateIndex
CREATE INDEX "FinancialAllocation_documentId_idx" ON "FinancialAllocation"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialAllocation_recordId_documentId_key" ON "FinancialAllocation"("recordId", "documentId");

-- CreateIndex
CREATE INDEX "InvoiceRecord_status_date_idx" ON "InvoiceRecord"("status", "date");

-- CreateIndex
CREATE INDEX "InvoiceRecord_supplierId_number_idx" ON "InvoiceRecord"("supplierId", "number");
CREATE UNIQUE INDEX "InvoiceRecord_active_number_key" ON "InvoiceRecord"("supplierId", "number") WHERE "status" != 'VOIDED';

-- CreateIndex
CREATE INDEX "InvoiceAllocation_documentId_idx" ON "InvoiceAllocation"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceAllocation_invoiceId_documentId_key" ON "InvoiceAllocation"("invoiceId", "documentId");

-- CreateIndex
CREATE INDEX "ExceptionHistory_key_id_idx" ON "ExceptionHistory"("key", "id");

-- CreateIndex
CREATE INDEX "ExecutionDraft_status_kind_updatedAt_idx" ON "ExecutionDraft"("status", "kind", "updatedAt");


CREATE INDEX "Attachment_financialRecordId_idx" ON "Attachment"("financialRecordId");
CREATE INDEX "Attachment_invoiceRecordId_idx" ON "Attachment"("invoiceRecordId");
CREATE INDEX "Attachment_contentHash_idx" ON "Attachment"("contentHash");
CREATE TRIGGER "Attachment_owner_insert" BEFORE INSERT ON "Attachment"
WHEN (NEW."procurementRequestId" IS NOT NULL) + (NEW."businessDocumentId" IS NOT NULL) + (NEW."financialRecordId" IS NOT NULL) + (NEW."invoiceRecordId" IS NOT NULL) != 1
BEGIN SELECT RAISE(ABORT, 'Attachment must have exactly one owner'); END;
CREATE TRIGGER "Attachment_owner_update" BEFORE UPDATE ON "Attachment"
WHEN (NEW."procurementRequestId" IS NOT NULL) + (NEW."businessDocumentId" IS NOT NULL) + (NEW."financialRecordId" IS NOT NULL) + (NEW."invoiceRecordId" IS NOT NULL) != 1
BEGIN SELECT RAISE(ABORT, 'Attachment must have exactly one owner'); END;
