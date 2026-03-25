-- CreateEnum
CREATE TYPE "TransportMode" AS ENUM ('car', 'moto_gas', 'moto_electric', 'bicycle', 'walking');

-- AlterTable establishments: add auto_dispatch and delivery_sla_minutes
ALTER TABLE "establishments"
  ADD COLUMN "auto_dispatch" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "delivery_sla_minutes" INTEGER;

-- AlterTable couriers: add transport_mode
ALTER TABLE "couriers"
  ADD COLUMN "transport_mode" "TransportMode";

-- AlterTable deliveries: add ETA fields
ALTER TABLE "deliveries"
  ADD COLUMN "eta_seconds" INTEGER,
  ADD COLUMN "eta_started_at" TIMESTAMPTZ;
