-- Requests without an OA serial (agreed verbally, bought first) get a system number 无OA-yyyymmdd-nn
-- (docs/manual-entry-2026-10.md N2–N3). It stays here after the OA serial is filled in, so the old number is still
-- searchable and never handed out again. Existing requests all have their own serial: nothing to backfill.
-- The column is nullable; rolling the code back needs no reverse migration.
ALTER TABLE "ProcurementRequest" ADD COLUMN "systemSerial" TEXT;
CREATE UNIQUE INDEX "ProcurementRequest_systemSerial_key" ON "ProcurementRequest"("systemSerial");
