-- Keep the original request quantity/counter CHECK intact. Actual purchases may include surplus for stock.
-- Existing purchases are unchanged: their entire quantity was committed to the source request.
ALTER TABLE "BusinessLine" ADD COLUMN "overPurchaseUnits" BIGINT NOT NULL DEFAULT 0
  CHECK ("overPurchaseUnits" >= 0 AND "overPurchaseUnits" <= "quantityUnits");
