-- Drop duplicate deliveries(status) index created in the init migration.
-- The init migration created "deliveries_status_idx"; the customer_tracking migration
-- then created "idx_deliveries_status" on the same column.
-- Prisma schema only tracks "idx_deliveries_status" (@@index map), so "deliveries_status_idx"
-- is an orphaned duplicate that wastes write overhead and confuses the query planner.
DROP INDEX IF EXISTS "deliveries_status_idx";
