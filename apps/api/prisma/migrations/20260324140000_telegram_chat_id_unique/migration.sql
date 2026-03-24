-- Make telegram_chat_id unique so one Telegram account maps to at most one user
-- and at most one courier. Prevents silent cross-account chat_id collisions.
-- Safe to run on empty tables (feature is new — no existing data).

ALTER TABLE "users"    ADD CONSTRAINT "users_telegram_chat_id_key"    UNIQUE ("telegram_chat_id");
ALTER TABLE "couriers" ADD CONSTRAINT "couriers_telegram_chat_id_key" UNIQUE ("telegram_chat_id");
