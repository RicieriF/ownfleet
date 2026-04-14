-- Add city column to establishments for geocoding accuracy.
-- Used as a hint when querying Nominatim: "вул. Незалежності 5, Харків"
-- ensures results are scoped to the correct city instead of matching any
-- Ukrainian city with that street name.
-- Nullable: existing establishments keep working without a city set.

ALTER TABLE "establishments"
  ADD COLUMN "city" TEXT;
