-- CreateEnum
CREATE TYPE "PassengerTripStatus" AS ENUM ('waiting', 'boarded', 'in_transit', 'dropped_off', 'absent', 'incident');

-- CreateEnum
CREATE TYPE "TripStatus" AS ENUM ('planned', 'active', 'completed', 'cancelled', 'incident');

-- CreateEnum
CREATE TYPE "CheckEventType" AS ENUM ('board', 'dropoff', 'guardian_handoff', 'absence', 'incident');

-- CreateEnum
CREATE TYPE "CheckValidationStatus" AS ENUM ('validated_online', 'provisional_offline', 'reconciled', 'rejected');

-- AlterTable
ALTER TABLE "couriers" ADD COLUMN     "photo_url" TEXT;

-- CreateTable
CREATE TABLE "vehicles" (
    "id" TEXT NOT NULL,
    "establishment_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "plate" TEXT,
    "model" TEXT,
    "color" TEXT,
    "photo_url" TEXT,
    "capacity" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "passengers" (
    "id" TEXT NOT NULL,
    "establishment_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "passengers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guardians" (
    "id" TEXT NOT NULL,
    "establishment_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "guardians_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "passenger_guardians" (
    "id" TEXT NOT NULL,
    "passenger_id" TEXT NOT NULL,
    "guardian_id" TEXT NOT NULL,
    "relationship" TEXT,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "can_pickup" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "passenger_guardians_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transport_routes" (
    "id" TEXT NOT NULL,
    "establishment_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transport_routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "route_stops" (
    "id" TEXT NOT NULL,
    "establishment_id" TEXT NOT NULL,
    "route_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "address" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "geofence_meters" INTEGER NOT NULL DEFAULT 300,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "route_stops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trips" (
    "id" TEXT NOT NULL,
    "establishment_id" TEXT NOT NULL,
    "route_id" TEXT,
    "courier_id" TEXT NOT NULL,
    "vehicle_id" TEXT,
    "status" "TripStatus" NOT NULL DEFAULT 'planned',
    "school_safety" BOOLEAN NOT NULL DEFAULT false,
    "scheduled_at" TIMESTAMPTZ,
    "started_at" TIMESTAMPTZ,
    "completed_at" TIMESTAMPTZ,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trip_passengers" (
    "id" TEXT NOT NULL,
    "establishment_id" TEXT NOT NULL,
    "trip_id" TEXT NOT NULL,
    "passenger_id" TEXT NOT NULL,
    "pickup_stop_id" TEXT,
    "dropoff_stop_id" TEXT,
    "status" "PassengerTripStatus" NOT NULL DEFAULT 'waiting',
    "recurring_amount" DECIMAL(10,2),
    "boarded_at" TIMESTAMPTZ,
    "dropped_off_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trip_passengers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "check_events" (
    "id" TEXT NOT NULL,
    "establishment_id" TEXT NOT NULL,
    "event_uid" TEXT NOT NULL,
    "trip_id" TEXT NOT NULL,
    "trip_passenger_id" TEXT,
    "passenger_id" TEXT,
    "courier_id" TEXT NOT NULL,
    "guardian_id" TEXT,
    "type" "CheckEventType" NOT NULL,
    "validation_status" "CheckValidationStatus" NOT NULL DEFAULT 'validated_online',
    "captured_at" TIMESTAMPTZ NOT NULL,
    "received_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "accuracy" DOUBLE PRECISION,
    "qr_nonce_hash" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "check_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "authorized_pickups" (
    "id" TEXT NOT NULL,
    "establishment_id" TEXT NOT NULL,
    "passenger_id" TEXT NOT NULL,
    "guardian_id" TEXT NOT NULL,
    "valid_from" TIMESTAMPTZ,
    "valid_until" TIMESTAMPTZ,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "authorized_pickups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vehicles_establishment_id_idx" ON "vehicles"("establishment_id");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_establishment_id_plate_key" ON "vehicles"("establishment_id", "plate");

-- CreateIndex
CREATE INDEX "passengers_establishment_id_idx" ON "passengers"("establishment_id");

-- CreateIndex
CREATE INDEX "guardians_establishment_id_idx" ON "guardians"("establishment_id");

-- CreateIndex
CREATE INDEX "guardians_establishment_id_phone_idx" ON "guardians"("establishment_id", "phone");

-- CreateIndex
CREATE INDEX "passenger_guardians_guardian_id_idx" ON "passenger_guardians"("guardian_id");

-- CreateIndex
CREATE UNIQUE INDEX "passenger_guardians_passenger_id_guardian_id_key" ON "passenger_guardians"("passenger_id", "guardian_id");

-- CreateIndex
CREATE INDEX "transport_routes_establishment_id_idx" ON "transport_routes"("establishment_id");

-- CreateIndex
CREATE INDEX "route_stops_establishment_id_idx" ON "route_stops"("establishment_id");

-- CreateIndex
CREATE INDEX "route_stops_route_id_idx" ON "route_stops"("route_id");

-- CreateIndex
CREATE UNIQUE INDEX "route_stops_route_id_sequence_key" ON "route_stops"("route_id", "sequence");

-- CreateIndex
CREATE INDEX "trips_establishment_id_idx" ON "trips"("establishment_id");

-- CreateIndex
CREATE INDEX "trips_courier_id_status_idx" ON "trips"("courier_id", "status");

-- CreateIndex
CREATE INDEX "trips_route_id_idx" ON "trips"("route_id");

-- CreateIndex
CREATE INDEX "trips_scheduled_at_idx" ON "trips"("scheduled_at");

-- CreateIndex
CREATE INDEX "trip_passengers_establishment_id_idx" ON "trip_passengers"("establishment_id");

-- CreateIndex
CREATE INDEX "trip_passengers_trip_id_status_idx" ON "trip_passengers"("trip_id", "status");

-- CreateIndex
CREATE INDEX "trip_passengers_passenger_id_idx" ON "trip_passengers"("passenger_id");

-- CreateIndex
CREATE UNIQUE INDEX "trip_passengers_trip_id_passenger_id_key" ON "trip_passengers"("trip_id", "passenger_id");

-- CreateIndex
CREATE UNIQUE INDEX "check_events_event_uid_key" ON "check_events"("event_uid");

-- CreateIndex
CREATE INDEX "check_events_establishment_id_idx" ON "check_events"("establishment_id");

-- CreateIndex
CREATE INDEX "check_events_trip_id_captured_at_idx" ON "check_events"("trip_id", "captured_at");

-- CreateIndex
CREATE INDEX "check_events_passenger_id_captured_at_idx" ON "check_events"("passenger_id", "captured_at");

-- CreateIndex
CREATE INDEX "check_events_validation_status_idx" ON "check_events"("validation_status");

-- CreateIndex
CREATE INDEX "authorized_pickups_establishment_id_idx" ON "authorized_pickups"("establishment_id");

-- CreateIndex
CREATE INDEX "authorized_pickups_passenger_id_active_idx" ON "authorized_pickups"("passenger_id", "active");

-- CreateIndex
CREATE INDEX "authorized_pickups_guardian_id_active_idx" ON "authorized_pickups"("guardian_id", "active");

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "passengers" ADD CONSTRAINT "passengers_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardians" ADD CONSTRAINT "guardians_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "passenger_guardians" ADD CONSTRAINT "passenger_guardians_passenger_id_fkey" FOREIGN KEY ("passenger_id") REFERENCES "passengers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "passenger_guardians" ADD CONSTRAINT "passenger_guardians_guardian_id_fkey" FOREIGN KEY ("guardian_id") REFERENCES "guardians"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_routes" ADD CONSTRAINT "transport_routes_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_stops" ADD CONSTRAINT "route_stops_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_stops" ADD CONSTRAINT "route_stops_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "transport_routes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "transport_routes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_courier_id_fkey" FOREIGN KEY ("courier_id") REFERENCES "couriers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_passengers" ADD CONSTRAINT "trip_passengers_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_passengers" ADD CONSTRAINT "trip_passengers_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_passengers" ADD CONSTRAINT "trip_passengers_passenger_id_fkey" FOREIGN KEY ("passenger_id") REFERENCES "passengers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_passengers" ADD CONSTRAINT "trip_passengers_pickup_stop_id_fkey" FOREIGN KEY ("pickup_stop_id") REFERENCES "route_stops"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_passengers" ADD CONSTRAINT "trip_passengers_dropoff_stop_id_fkey" FOREIGN KEY ("dropoff_stop_id") REFERENCES "route_stops"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "check_events" ADD CONSTRAINT "check_events_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "check_events" ADD CONSTRAINT "check_events_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "check_events" ADD CONSTRAINT "check_events_trip_passenger_id_fkey" FOREIGN KEY ("trip_passenger_id") REFERENCES "trip_passengers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "check_events" ADD CONSTRAINT "check_events_passenger_id_fkey" FOREIGN KEY ("passenger_id") REFERENCES "passengers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "check_events" ADD CONSTRAINT "check_events_courier_id_fkey" FOREIGN KEY ("courier_id") REFERENCES "couriers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "check_events" ADD CONSTRAINT "check_events_guardian_id_fkey" FOREIGN KEY ("guardian_id") REFERENCES "guardians"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "authorized_pickups" ADD CONSTRAINT "authorized_pickups_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "authorized_pickups" ADD CONSTRAINT "authorized_pickups_passenger_id_fkey" FOREIGN KEY ("passenger_id") REFERENCES "passengers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "authorized_pickups" ADD CONSTRAINT "authorized_pickups_guardian_id_fkey" FOREIGN KEY ("guardian_id") REFERENCES "guardians"("id") ON DELETE CASCADE ON UPDATE CASCADE;
