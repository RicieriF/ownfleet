-- Add push notification fields to users for manager mobile app
-- DevicePlatform enum already exists (used in couriers table)
ALTER TABLE "users" ADD COLUMN "device_token" TEXT;
ALTER TABLE "users" ADD COLUMN "device_platform" "DevicePlatform";

-- Unique index: one device per manager account
CREATE UNIQUE INDEX "users_device_token_key" ON "users"("device_token");
