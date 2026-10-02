-- AlterTable
ALTER TABLE "guardians" ADD COLUMN     "device_platform" "DevicePlatform",
ADD COLUMN     "device_token" TEXT;

-- CreateTable
CREATE TABLE "trip_assignment_changes" (
    "id" TEXT NOT NULL,
    "establishment_id" TEXT NOT NULL,
    "trip_id" TEXT NOT NULL,
    "changed_by_user_id" TEXT NOT NULL,
    "old_courier_id" TEXT NOT NULL,
    "new_courier_id" TEXT NOT NULL,
    "old_vehicle_id" TEXT,
    "new_vehicle_id" TEXT,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trip_assignment_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "trip_assignment_changes_establishment_id_idx" ON "trip_assignment_changes"("establishment_id");

-- CreateIndex
CREATE INDEX "trip_assignment_changes_trip_id_created_at_idx" ON "trip_assignment_changes"("trip_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "guardians_device_token_key" ON "guardians"("device_token");

-- AddForeignKey
ALTER TABLE "trip_assignment_changes" ADD CONSTRAINT "trip_assignment_changes_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_assignment_changes" ADD CONSTRAINT "trip_assignment_changes_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_assignment_changes" ADD CONSTRAINT "trip_assignment_changes_changed_by_user_id_fkey" FOREIGN KEY ("changed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
