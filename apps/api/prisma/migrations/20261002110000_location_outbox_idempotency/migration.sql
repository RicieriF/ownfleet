-- Add nullable columns first so existing tracking history remains valid.
ALTER TABLE "location_pings"
ADD COLUMN "accuracy" DOUBLE PRECISION,
ADD COLUMN "captured_at" TIMESTAMPTZ,
ADD COLUMN "event_uid" TEXT;

UPDATE "location_pings"
SET "captured_at" = "created_at",
    "event_uid" = "id"
WHERE "captured_at" IS NULL OR "event_uid" IS NULL;

ALTER TABLE "location_pings"
ALTER COLUMN "captured_at" SET NOT NULL,
ALTER COLUMN "event_uid" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "location_pings_event_uid_key" ON "location_pings"("event_uid");
