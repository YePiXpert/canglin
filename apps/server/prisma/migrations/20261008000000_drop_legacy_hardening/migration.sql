-- Drop the legacy V2 ledger (Item / ItemHistory / Distribution / DistributionLine / Product /
-- InventoryMovement / SupplierPriceRecord) and harden the V3 tables.
-- The rebuild requirements state that existing data is test data only, so legacy rows are not migrated.

-- Legacy attachments: rows that belonged only to a legacy Item or Distribution have no owner in the
-- new model. They are test data and are deleted right after the Attachment rebuild below; their files
-- stay in uploads/ (orphaned, harmless) and can be removed manually. OA originals of confirmed workflow
-- imports are attached to ProcurementRequest and are kept.
-- Attachment ids must never be handed out twice: AuditLog rows and saved links still name removed
-- attachments. DROP TABLE discards the old sqlite_sequence row and the copy only raises the new counter
-- to the highest copied id, so the rebuild hands the old counter row over to the new table (ids of
-- attachments deleted earlier stay reserved) and copies the legacy rows before deleting them.

-- Import tasks confirmed through the removed legacy path lose their ledger rows here; they are returned
-- to unconfirmed after the ImportTask rebuild below.

-- DropIndex
DROP INDEX "Distribution_createdAt_idx";

-- DropIndex
DROP INDEX "Distribution_department_idx";

-- DropIndex
DROP INDEX "Distribution_date_idx";

-- DropIndex
DROP INDEX "DistributionLine_distributionId_idx";

-- DropIndex
DROP INDEX "DistributionLine_productId_idx";

-- DropIndex
DROP INDEX "DistributionLine_itemId_idx";

-- DropIndex
DROP INDEX "DistributionLine_recipient_idx";

-- DropIndex
DROP INDEX "InventoryMovement_type_idx";

-- DropIndex
DROP INDEX "InventoryMovement_productId_createdAt_idx";

-- DropIndex
DROP INDEX "Item_serialNumber_itemName_handler_key";

-- DropIndex
DROP INDEX "Item_deletedAt_createdAt_idx";

-- DropIndex
DROP INDEX "Item_supplierId_idx";

-- DropIndex
DROP INDEX "Item_requestDate_idx";

-- DropIndex
DROP INDEX "Item_handler_idx";

-- DropIndex
DROP INDEX "Item_department_deletedAt_idx";

-- DropIndex
DROP INDEX "Item_status_deletedAt_createdAt_idx";

-- DropIndex
DROP INDEX "ItemHistory_itemId_createdAt_idx";

-- DropIndex
DROP INDEX "Product_name_idx";

-- DropIndex
DROP INDEX "Product_name_key";

-- DropIndex
DROP INDEX "SupplierPriceRecord_supplierId_createdAt_idx";

-- DropIndex
DROP INDEX "SupplierPriceRecord_itemName_idx";

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "DistributionLine";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "Distribution";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "InventoryMovement";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "ItemHistory";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "Item";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "Product";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "SupplierPriceRecord";
PRAGMA foreign_keys=on;

-- RedefineTables
-- Attachment: drop itemId / distributionId.
-- ImportTask: CHECK on status (values written by ImportsService: PENDING | RUNNING | DONE | FAILED).
-- BusinessDocument: keep the existing kind/status/paymentStatus CHECKs and add source/returnMode CHECKs
--   (values from workflowDistributionSchema / workflowSupplierReturnSchema; NULL for other kinds).
-- CHECK constraints are invisible to Prisma, so `prisma migrate diff` reports no drift for them.
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Attachment" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "kind" TEXT NOT NULL,
    "procurementRequestId" INTEGER,
    "businessDocumentId" INTEGER,
    "filename" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Attachment_procurementRequestId_fkey" FOREIGN KEY ("procurementRequestId") REFERENCES "ProcurementRequest" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Attachment_businessDocumentId_fkey" FOREIGN KEY ("businessDocumentId") REFERENCES "BusinessDocument" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Attachment" ("businessDocumentId", "createdAt", "filename", "id", "kind", "mimeType", "procurementRequestId", "sizeBytes", "storagePath") SELECT "businessDocumentId", "createdAt", "filename", "id", "kind", "mimeType", "procurementRequestId", "sizeBytes", "storagePath" FROM "Attachment";
-- Keep the AUTOINCREMENT counter (see the top of this file): the old table's sqlite_sequence row, which
-- is at least the highest id it ever held, replaces the one the copy created.
DELETE FROM "sqlite_sequence" WHERE "name" = 'new_Attachment';
UPDATE "sqlite_sequence" SET "name" = 'new_Attachment' WHERE "name" = 'Attachment';
DROP TABLE "Attachment";
ALTER TABLE "new_Attachment" RENAME TO "Attachment";
-- Legacy attachments (see the top of this file), deleted only after the counter covers their ids.
DELETE FROM "Attachment" WHERE "procurementRequestId" IS NULL AND "businessDocumentId" IS NULL;
CREATE INDEX "Attachment_procurementRequestId_idx" ON "Attachment"("procurementRequestId");
CREATE INDEX "Attachment_businessDocumentId_idx" ON "Attachment"("businessDocumentId");
CREATE TABLE "new_ImportTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "filename" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "result" TEXT,
    "error" TEXT,
    "storagePath" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "contentHash" TEXT,
    "draft" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "generation" INTEGER NOT NULL DEFAULT 0,
    "aiStatus" TEXT NOT NULL DEFAULT 'DISABLED',
    "aiResult" TEXT,
    "confirmedAt" DATETIME,
    "confirmation" TEXT,
    CHECK ("status" IN ('PENDING','RUNNING','DONE','FAILED'))
);
INSERT INTO "new_ImportTask" ("aiResult", "aiStatus", "confirmation", "confirmedAt", "contentHash", "createdAt", "draft", "error", "filename", "finishedAt", "generation", "id", "result", "status", "storagePath", "version") SELECT "aiResult", "aiStatus", "confirmation", "confirmedAt", "contentHash", "createdAt", "draft", "error", "filename", "finishedAt", "generation", "id", "result", "status", "storagePath", "version" FROM "ImportTask";
DROP TABLE "ImportTask";
ALTER TABLE "new_ImportTask" RENAME TO "ImportTask";
CREATE INDEX "ImportTask_contentHash_idx" ON "ImportTask"("contentHash");
-- Legacy-confirmed import tasks: only the workflow import writes a {"target":"WORKFLOW","requestId":...}
-- confirmation (ImportsService.confirmedRequestId reads it); the legacy snapshot was
-- {input, ids, draft, local, ai}. Left confirmed, those tasks would show as 已入账 with no request to open
-- and be picked as the duplicate-upload target, so they return to unconfirmed; draft and recognition
-- results are kept and generation/version are left alone. Their originals then fall under the normal
-- unconfirmed-retention rule: the import sweep removes unconfirmed tasks older than 30 days together
-- with the original file unless an attachment still references it (the legacy OA attachments were
-- removed above).
UPDATE "ImportTask" SET "confirmedAt" = NULL, "confirmation" = NULL WHERE "confirmedAt" IS NOT NULL AND ("confirmation" IS NULL OR "confirmation" NOT LIKE '%"target":"WORKFLOW"%');
CREATE TABLE "new_BusinessDocument" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "kind" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'POSTED',
    "supplierId" INTEGER,
    "supplierName" TEXT,
    "department" TEXT,
    "source" TEXT,
    "returnMode" TEXT,
    "note" TEXT,
    "totalAmountUnits" BIGINT,
    "paymentStatus" TEXT NOT NULL DEFAULT 'UNPAID',
    "invoiceIssued" BOOLEAN NOT NULL DEFAULT false,
    "voidReason" TEXT,
    "voidDate" TEXT,
    "voidedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BusinessDocument_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CHECK ("kind" IN ('PURCHASE','RECEIPT','STOCK_IN','DISTRIBUTION','SUPPLIER_RETURN','EMPLOYEE_RETURN','PURCHASE_CANCEL','REQUEST_CANCEL','ADJUSTMENT')),
    CHECK ("status" IN ('POSTED','VOIDED')),
    CHECK ("paymentStatus" IN ('UNPAID','PAID','REIMBURSED')),
    CHECK ("source" IS NULL OR "source" IN ('DIRECT','STOCK')),
    CHECK ("returnMode" IS NULL OR "returnMode" IN ('REFUND','REPLACEMENT'))
);
INSERT INTO "new_BusinessDocument" ("createdAt", "date", "department", "id", "invoiceIssued", "kind", "note", "paymentStatus", "returnMode", "source", "status", "supplierId", "supplierName", "totalAmountUnits", "voidDate", "voidReason", "voidedAt") SELECT "createdAt", "date", "department", "id", "invoiceIssued", "kind", "note", "paymentStatus", "returnMode", "source", "status", "supplierId", "supplierName", "totalAmountUnits", "voidDate", "voidReason", "voidedAt" FROM "BusinessDocument";
DROP TABLE "BusinessDocument";
ALTER TABLE "new_BusinessDocument" RENAME TO "BusinessDocument";
CREATE INDEX "BusinessDocument_kind_status_date_idx" ON "BusinessDocument"("kind", "status", "date");
CREATE INDEX "BusinessDocument_supplierId_idx" ON "BusinessDocument"("supplierId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");

-- CreateIndex
CREATE INDEX "OperationReceipt_createdAt_idx" ON "OperationReceipt"("createdAt");
