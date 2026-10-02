-- AlterTable
ALTER TABLE "trips" ADD COLUMN     "distance_meters" INTEGER,
ADD COLUMN     "eta_seconds" INTEGER;

-- AlterTable
ALTER TABLE "trip_passengers" ADD COLUMN     "ready_at" TIMESTAMPTZ,
ADD COLUMN     "scheduled_pickup_at" TIMESTAMPTZ;

-- CreateTable
CREATE TABLE "family_access_tokens" (
    "id" TEXT NOT NULL,
    "establishment_id" TEXT NOT NULL,
    "guardian_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "revoked_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "family_access_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "family_access_tokens_token_hash_key" ON "family_access_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "family_access_tokens_establishment_id_idx" ON "family_access_tokens"("establishment_id");

-- CreateIndex
CREATE INDEX "family_access_tokens_guardian_id_revoked_at_idx" ON "family_access_tokens"("guardian_id", "revoked_at");

-- CreateIndex
CREATE INDEX "family_access_tokens_expires_at_idx" ON "family_access_tokens"("expires_at");

-- AddForeignKey
ALTER TABLE "family_access_tokens" ADD CONSTRAINT "family_access_tokens_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "family_access_tokens" ADD CONSTRAINT "family_access_tokens_guardian_id_fkey" FOREIGN KEY ("guardian_id") REFERENCES "guardians"("id") ON DELETE CASCADE ON UPDATE CASCADE;
