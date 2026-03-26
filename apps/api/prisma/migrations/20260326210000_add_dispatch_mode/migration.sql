-- Add dispatch_mode enum and replace auto_dispatch boolean
CREATE TYPE "DispatchMode" AS ENUM ('manual', 'recommend', 'auto');

ALTER TABLE "establishments"
  DROP COLUMN "auto_dispatch",
  ADD COLUMN "dispatch_mode" "DispatchMode" NOT NULL DEFAULT 'manual';

-- Add ready_at to orders (idempotency + dispatch state tracking)
ALTER TABLE "orders"
  ADD COLUMN "ready_at" TIMESTAMPTZ;

-- Add anomaly_alerted_at to shifts (prevents Telegram spam for +N хв/дост alert)
ALTER TABLE "shifts"
  ADD COLUMN "anomaly_alerted_at" TIMESTAMPTZ;
