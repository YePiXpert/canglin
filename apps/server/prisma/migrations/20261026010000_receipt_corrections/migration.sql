-- Keep all prior movements and source references; receipt corrections append a signed difference.
ALTER TABLE "StockEntry" ADD COLUMN "correctionReason" TEXT;
