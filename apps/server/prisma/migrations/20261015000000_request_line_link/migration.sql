-- Request lines keep the purchase link given with the request (OA remark), prefilled when a purchase is registered.
-- The column is nullable; rolling the code back needs no reverse migration.
ALTER TABLE "ProcurementLine" ADD COLUMN "purchaseLink" TEXT;

-- Backfill requests confirmed from an import (docs/import-units-links-2026-10.md S1).
-- The confirmation snapshot keeps the confirmed rows in request-line order (input.items[i] is line i + 1) with their
-- lineId, and the recognition result of that moment (local.items) with the link read from the original.
-- Only http(s) links up to 500 characters are copied; the application canonicalises them when it shows or opens them.
-- Line ids are stable within a task: a local retry only re-parses failed pages, which had no rows.
-- Every json_extract is guarded by the json_each "type" column: an element that is not an object (a hand-edited
-- or legacy snapshot) yields NULL instead of failing the whole migration with "malformed JSON".
UPDATE "ProcurementLine" SET "purchaseLink" = (
  SELECT CASE WHEN recognised."type" = 'object' THEN json_extract(recognised."value", '$.purchaseLink') END AS link
  FROM "ProcurementRequest" AS request
  JOIN "ImportTask" AS task ON task."id" = request."sourceTaskId"
  JOIN json_each(CASE WHEN json_valid(task."confirmation") THEN task."confirmation" ELSE '{}' END, '$.input.items') AS confirmed
    ON confirmed."key" = "ProcurementLine"."lineNumber" - 1
  JOIN json_each(CASE WHEN json_valid(task."confirmation") THEN task."confirmation" ELSE '{}' END, '$.local.items') AS recognised
    ON (CASE WHEN recognised."type" = 'object' THEN json_extract(recognised."value", '$.lineId') END)
     = (CASE WHEN confirmed."type" = 'object' THEN json_extract(confirmed."value", '$.lineId') END)
  WHERE request."id" = "ProcurementLine"."requestId"
    AND typeof(link) = 'text'
    AND (link LIKE 'http://%' OR link LIKE 'https://%')
    AND length(link) <= 500
  LIMIT 1
)
WHERE "purchaseLink" IS NULL;
