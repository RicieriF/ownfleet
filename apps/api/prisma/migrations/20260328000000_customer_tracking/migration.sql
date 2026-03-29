-- Phase 1: CustomerTracking backend migration
-- Adds: hosted_tracking_enabled, tracking_tokens, api_keys, delivery status index

-- 1. hosted_tracking_enabled on establishments
ALTER TABLE "establishments"
  ADD COLUMN "hosted_tracking_enabled" BOOLEAN NOT NULL DEFAULT FALSE;

-- 2. tracking_tokens table
-- No establishment_id — intentional exception: access only via UUID token (122 bits entropy)
CREATE TABLE "tracking_tokens" (
  "id"         TEXT        NOT NULL,
  "order_id"   TEXT        NOT NULL,
  "token"      TEXT        NOT NULL,
  "expires_at" TIMESTAMPTZ NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tracking_tokens_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "tracking_tokens_order_id_key" ON "tracking_tokens"("order_id");
CREATE UNIQUE INDEX "tracking_tokens_token_key"    ON "tracking_tokens"("token");
ALTER TABLE "tracking_tokens"
  ADD CONSTRAINT "tracking_tokens_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 3. api_keys table
CREATE TABLE "api_keys" (
  "id"               TEXT        NOT NULL,
  "establishment_id" TEXT        NOT NULL,
  "key_hash"         TEXT        NOT NULL,
  "key_prefix"       TEXT        NOT NULL,
  "name"             TEXT        NOT NULL DEFAULT 'Default',
  "is_active"        BOOLEAN     NOT NULL DEFAULT TRUE,
  "allowed_domains"  TEXT[]      NOT NULL DEFAULT ARRAY[]::TEXT[],
  "last_used_at"     TIMESTAMPTZ,
  "last_used_domain" TEXT,
  "created_at"       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "api_keys_key_prefix_key"           ON "api_keys"("key_prefix");
CREATE        INDEX "api_keys_establishment_id_idx"     ON "api_keys"("establishment_id");
ALTER TABLE "api_keys"
  ADD CONSTRAINT "api_keys_establishment_id_fkey"
  FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 4. Delivery status index (needed for ETA cron and dispatch queries)
CREATE INDEX "idx_deliveries_status" ON "deliveries"("status");
