-- AlterTable establishments: add lat/lng for OSRM routing
ALTER TABLE "establishments"
  ADD COLUMN "lat" DOUBLE PRECISION,
  ADD COLUMN "lng" DOUBLE PRECISION;
