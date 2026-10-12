-- AI calls record the recognition mode (RECOGNITION | REVIEW) and the prompt version they used.
-- Both columns are nullable and older rows are not backfilled; rolling the code back needs no reverse migration.
ALTER TABLE "AiCall" ADD COLUMN "promptVersion" TEXT;
ALTER TABLE "AiCall" ADD COLUMN "mode" TEXT;
