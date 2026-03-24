-- Add composite index on deliveries(courier_id, status)
-- Optimizes getActiveDelivery() hot path (polled every 10s from mobile)
CREATE INDEX CONCURRENTLY IF NOT EXISTS "deliveries_courier_id_status_idx"
  ON "deliveries"("courier_id", "status");

-- Add composite index on location_pings(courier_id, created_at DESC)
-- Optimizes: DISTINCT ON dashboard query, retention DELETE, shifts cron NOT EXISTS
CREATE INDEX CONCURRENTLY IF NOT EXISTS "location_pings_courier_id_created_at_idx"
  ON "location_pings"("courier_id", "created_at" DESC);
