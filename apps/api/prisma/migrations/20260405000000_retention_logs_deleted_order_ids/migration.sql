-- Add deleted_order_ids to retention_logs for audit trail.
-- Stores an array of {id, external_id} objects for orders deleted during retention cleanup.
-- Allows answering "did this order exist?" disputes without keeping full order data.

ALTER TABLE "retention_logs"
  ADD COLUMN "deleted_order_ids" JSONB NOT NULL DEFAULT '[]'::jsonb;
