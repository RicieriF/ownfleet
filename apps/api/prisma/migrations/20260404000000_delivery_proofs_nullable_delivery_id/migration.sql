-- Migration: make delivery_proofs.delivery_id nullable with ON DELETE SET NULL
--
-- Root cause fixed: delivery_proofs.delivery_id was NOT NULL with no onDelete
-- directive, meaning PostgreSQL defaulted to RESTRICT. During retention cleanup
-- (order.deleteMany → cascade delete deliveries), the FK violation on
-- delivery_proofs was silently caught — causing retention to be a no-op for
-- every establishment that has at least one completed delivery.
--
-- Fix: make delivery_id nullable and change the FK to ON DELETE SET NULL.
-- When a delivery is deleted (via cascade from its order), the proof row
-- survives with delivery_id = NULL — preserving the geo/audit evidence.
--
-- NOTE: This migration uses ALTER COLUMN and ALTER CONSTRAINT commands that
-- cannot run inside a Prisma shadow-DB transaction. Apply manually:
--   npx prisma db execute --file prisma/migrations/20260404000000_delivery_proofs_nullable_delivery_id/migration.sql
-- Then register it as applied:
--   npx prisma migrate resolve --applied 20260404000000_delivery_proofs_nullable_delivery_id

-- 1. Drop the existing FK constraint (name matches Prisma default convention)
ALTER TABLE delivery_proofs
  DROP CONSTRAINT IF EXISTS delivery_proofs_delivery_id_fkey;

-- 2. Make the column nullable
ALTER TABLE delivery_proofs
  ALTER COLUMN delivery_id DROP NOT NULL;

-- 3. Re-add the FK with ON DELETE SET NULL
ALTER TABLE delivery_proofs
  ADD CONSTRAINT delivery_proofs_delivery_id_fkey
  FOREIGN KEY (delivery_id) REFERENCES deliveries(id)
  ON DELETE SET NULL;
