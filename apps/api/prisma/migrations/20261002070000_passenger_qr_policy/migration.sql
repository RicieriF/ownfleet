-- CreateEnum
CREATE TYPE "PassengerQrAction" AS ENUM ('board', 'guardian_handoff');

-- AlterTable
ALTER TABLE "passengers" ADD COLUMN     "handoff_qr_required" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pickup_qr_required" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "passenger_qr_tokens" (
    "id" TEXT NOT NULL,
    "establishment_id" TEXT NOT NULL,
    "passenger_id" TEXT NOT NULL,
    "trip_id" TEXT NOT NULL,
    "courier_id" TEXT NOT NULL,
    "vehicle_id" TEXT,
    "action" "PassengerQrAction" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "nonce_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "used_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "passenger_qr_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "passenger_qr_exceptions" (
    "id" TEXT NOT NULL,
    "establishment_id" TEXT NOT NULL,
    "passenger_id" TEXT NOT NULL,
    "trip_id" TEXT,
    "action" "PassengerQrAction" NOT NULL,
    "authorized_by_guardian_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "valid_from" TIMESTAMPTZ NOT NULL,
    "valid_until" TIMESTAMPTZ NOT NULL,
    "max_uses" INTEGER NOT NULL DEFAULT 1,
    "used_count" INTEGER NOT NULL DEFAULT 0,
    "revoked_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "passenger_qr_exceptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "passenger_qr_tokens_token_hash_key" ON "passenger_qr_tokens"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "passenger_qr_tokens_nonce_hash_key" ON "passenger_qr_tokens"("nonce_hash");

-- CreateIndex
CREATE INDEX "passenger_qr_tokens_establishment_id_idx" ON "passenger_qr_tokens"("establishment_id");

-- CreateIndex
CREATE INDEX "passenger_qr_tokens_trip_id_passenger_id_action_idx" ON "passenger_qr_tokens"("trip_id", "passenger_id", "action");

-- CreateIndex
CREATE INDEX "passenger_qr_tokens_expires_at_idx" ON "passenger_qr_tokens"("expires_at");

-- CreateIndex
CREATE INDEX "passenger_qr_exceptions_establishment_id_idx" ON "passenger_qr_exceptions"("establishment_id");

-- CreateIndex
CREATE INDEX "passenger_qr_exceptions_passenger_id_action_revoked_at_idx" ON "passenger_qr_exceptions"("passenger_id", "action", "revoked_at");

-- CreateIndex
CREATE INDEX "passenger_qr_exceptions_trip_id_idx" ON "passenger_qr_exceptions"("trip_id");

-- AddForeignKey
ALTER TABLE "passenger_qr_tokens" ADD CONSTRAINT "passenger_qr_tokens_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "passenger_qr_tokens" ADD CONSTRAINT "passenger_qr_tokens_passenger_id_fkey" FOREIGN KEY ("passenger_id") REFERENCES "passengers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "passenger_qr_tokens" ADD CONSTRAINT "passenger_qr_tokens_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "passenger_qr_tokens" ADD CONSTRAINT "passenger_qr_tokens_courier_id_fkey" FOREIGN KEY ("courier_id") REFERENCES "couriers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "passenger_qr_tokens" ADD CONSTRAINT "passenger_qr_tokens_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "passenger_qr_exceptions" ADD CONSTRAINT "passenger_qr_exceptions_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "passenger_qr_exceptions" ADD CONSTRAINT "passenger_qr_exceptions_passenger_id_fkey" FOREIGN KEY ("passenger_id") REFERENCES "passengers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "passenger_qr_exceptions" ADD CONSTRAINT "passenger_qr_exceptions_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "passenger_qr_exceptions" ADD CONSTRAINT "passenger_qr_exceptions_authorized_by_guardian_id_fkey" FOREIGN KEY ("authorized_by_guardian_id") REFERENCES "guardians"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
