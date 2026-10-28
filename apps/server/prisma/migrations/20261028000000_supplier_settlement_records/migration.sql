-- Payments registered through supplier settlement are listed as settlement records; single payments stay in the legacy ledger.
-- Existing settlements (feature released 2026-10-26) are identified by their idempotency receipts, which are kept for 90 days.
ALTER TABLE "FinancialRecord" ADD COLUMN "supplierSettlement" BOOLEAN NOT NULL DEFAULT false;
UPDATE "FinancialRecord" SET "supplierSettlement" = true
WHERE "id" IN (SELECT CAST(json_extract("response", '$.id') AS INTEGER) FROM "OperationReceipt" WHERE "scope" = 'workflow:supplier_settlement');
