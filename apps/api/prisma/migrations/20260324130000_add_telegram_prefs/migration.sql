-- Add Telegram bot fields to users table
-- telegram_chat_id: set after user connects via /start {code}
-- telegram_prefs: JSONB, which notifications the user wants { order_created: bool, ... }
ALTER TABLE "users" ADD COLUMN "telegram_chat_id" TEXT;
ALTER TABLE "users" ADD COLUMN "telegram_prefs" JSONB NOT NULL DEFAULT '{}';

-- Add telegram_prefs to couriers table
-- telegram_chat_id already exists on couriers from previous migration
ALTER TABLE "couriers" ADD COLUMN "telegram_prefs" JSONB NOT NULL DEFAULT '{}';
