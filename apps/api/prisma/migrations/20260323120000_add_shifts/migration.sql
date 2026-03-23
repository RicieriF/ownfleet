-- CreateTable
CREATE TABLE "shifts" (
    "id" TEXT NOT NULL,
    "courier_id" TEXT NOT NULL,
    "establishment_id" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ,
    "ended_by" TEXT,
    "planned_end_at" TIMESTAMPTZ,
    "total_deliveries" INTEGER NOT NULL DEFAULT 0,
    "total_distance_km" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shifts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "shifts_courier_id_idx" ON "shifts"("courier_id");

-- CreateIndex
CREATE INDEX "shifts_establishment_id_idx" ON "shifts"("establishment_id");

-- CreateIndex
CREATE INDEX "shifts_courier_id_ended_at_idx" ON "shifts"("courier_id", "ended_at");

-- Partial unique index: one active shift per courier
-- (Prisma doesn't support conditional unique indexes natively)
CREATE UNIQUE INDEX "shifts_courier_active_unique"
    ON "shifts"("courier_id")
    WHERE "ended_at" IS NULL;

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_courier_id_fkey"
    FOREIGN KEY ("courier_id") REFERENCES "couriers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_establishment_id_fkey"
    FOREIGN KEY ("establishment_id") REFERENCES "establishments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
