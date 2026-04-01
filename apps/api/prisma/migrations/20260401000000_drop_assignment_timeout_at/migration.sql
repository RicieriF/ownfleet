-- Drop dead column assignment_timeout_at from deliveries
-- This field was set but never processed — the "courier has 5 min to accept" flow was never implemented.

ALTER TABLE "deliveries" DROP COLUMN IF EXISTS "assignment_timeout_at";
