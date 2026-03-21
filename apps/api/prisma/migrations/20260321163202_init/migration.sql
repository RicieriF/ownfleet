-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "postgis";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('owner', 'manager', 'dispatcher');

-- CreateEnum
CREATE TYPE "Plan" AS ENUM ('pilot', 'starter', 'business', 'pro');

-- CreateEnum
CREATE TYPE "OnboardingStatus" AS ENUM ('pending', 'couriers_added', 'first_order', 'completed');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('pending', 'assigned', 'in_progress', 'completed', 'cancelled', 'failed');

-- CreateEnum
CREATE TYPE "OrderSource" AS ENUM ('manual', 'poster', 'iiko', 'webhook');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('assigned', 'in_progress', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "IntegrationType" AS ENUM ('poster', 'iiko');

-- CreateEnum
CREATE TYPE "DevicePlatform" AS ENUM ('ios', 'android');

-- CreateEnum
CREATE TYPE "BillingEventType" AS ENUM ('trial_started', 'trial_expired', 'payment_received', 'plan_changed', 'grace_period_started', 'access_revoked');

-- CreateTable
CREATE TABLE "establishments" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "plan" "Plan" NOT NULL DEFAULT 'starter',
    "trial_ends_at" TIMESTAMP(3),
    "paid_until" TIMESTAMP(3),
    "onboarding_status" "OnboardingStatus" NOT NULL DEFAULT 'pending',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "establishments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "establishment_id" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "is_platform_admin" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "couriers" (
    "id" TEXT NOT NULL,
    "establishment_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "device_token" TEXT,
    "device_platform" "DevicePlatform",
    "active" BOOLEAN NOT NULL DEFAULT true,
    "battery_optimization_exempt" BOOLEAN NOT NULL DEFAULT false,
    "device_brand" TEXT,
    "last_reminder_sent_at" TIMESTAMP(3),
    "reminder_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "couriers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "establishment_id" TEXT NOT NULL,
    "external_id" TEXT,
    "address" TEXT NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "status" "OrderStatus" NOT NULL DEFAULT 'pending',
    "source" "OrderSource" NOT NULL DEFAULT 'manual',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deliveries" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "courier_id" TEXT NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'assigned',
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignment_timeout_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "order_closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_proofs" (
    "id" TEXT NOT NULL,
    "delivery_id" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "captured_at" TIMESTAMP(3) NOT NULL,
    "order_closed_at" TIMESTAMP(3),
    "photo_key" TEXT,
    "geo_match" BOOLEAN NOT NULL,
    "accuracy" DOUBLE PRECISION,
    "geo_flags" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_proofs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "location_pings" (
    "id" TEXT NOT NULL,
    "courier_id" TEXT NOT NULL,
    "location" geometry(Point,4326) NOT NULL,
    "battery" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "location_pings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integrations" (
    "id" TEXT NOT NULL,
    "establishment_id" TEXT NOT NULL,
    "type" "IntegrationType" NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhooks" (
    "id" TEXT NOT NULL,
    "establishment_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "events" TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "last_error_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invite_tokens" (
    "id" TEXT NOT NULL,
    "establishment_id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "courier_id" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invite_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "retention_logs" (
    "id" TEXT NOT NULL,
    "establishment_id" TEXT NOT NULL,
    "deleted_orders" INTEGER NOT NULL DEFAULT 0,
    "deleted_pings" INTEGER NOT NULL DEFAULT 0,
    "run_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "retention_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_events" (
    "id" TEXT NOT NULL,
    "establishment_id" TEXT NOT NULL,
    "type" "BillingEventType" NOT NULL,
    "amount_usd" DOUBLE PRECISION,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_establishment_id_idx" ON "users"("establishment_id");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE INDEX "couriers_establishment_id_idx" ON "couriers"("establishment_id");

-- CreateIndex
CREATE INDEX "orders_establishment_id_idx" ON "orders"("establishment_id");

-- CreateIndex
CREATE INDEX "orders_establishment_id_status_idx" ON "orders"("establishment_id", "status");

-- CreateIndex
CREATE INDEX "orders_created_at_idx" ON "orders"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "orders_external_id_establishment_id_key" ON "orders"("external_id", "establishment_id");

-- CreateIndex
CREATE UNIQUE INDEX "deliveries_order_id_key" ON "deliveries"("order_id");

-- CreateIndex
CREATE INDEX "deliveries_courier_id_idx" ON "deliveries"("courier_id");

-- CreateIndex
CREATE INDEX "deliveries_status_idx" ON "deliveries"("status");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_proofs_delivery_id_key" ON "delivery_proofs"("delivery_id");

-- CreateIndex
CREATE INDEX "location_pings_courier_id_idx" ON "location_pings"("courier_id");

-- CreateIndex
CREATE INDEX "location_pings_created_at_idx" ON "location_pings"("created_at");

-- CreateIndex
CREATE INDEX "integrations_establishment_id_idx" ON "integrations"("establishment_id");

-- CreateIndex
CREATE UNIQUE INDEX "integrations_establishment_id_type_key" ON "integrations"("establishment_id", "type");

-- CreateIndex
CREATE INDEX "webhooks_establishment_id_idx" ON "webhooks"("establishment_id");

-- CreateIndex
CREATE UNIQUE INDEX "invite_tokens_token_key" ON "invite_tokens"("token");

-- CreateIndex
CREATE INDEX "invite_tokens_establishment_id_idx" ON "invite_tokens"("establishment_id");

-- CreateIndex
CREATE INDEX "retention_logs_establishment_id_idx" ON "retention_logs"("establishment_id");

-- CreateIndex
CREATE INDEX "billing_events_establishment_id_idx" ON "billing_events"("establishment_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "couriers" ADD CONSTRAINT "couriers_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_courier_id_fkey" FOREIGN KEY ("courier_id") REFERENCES "couriers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_proofs" ADD CONSTRAINT "delivery_proofs_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "deliveries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_pings" ADD CONSTRAINT "location_pings_courier_id_fkey" FOREIGN KEY ("courier_id") REFERENCES "couriers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invite_tokens" ADD CONSTRAINT "invite_tokens_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invite_tokens" ADD CONSTRAINT "invite_tokens_courier_id_fkey" FOREIGN KEY ("courier_id") REFERENCES "couriers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retention_logs" ADD CONSTRAINT "retention_logs_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_events" ADD CONSTRAINT "billing_events_establishment_id_fkey" FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
