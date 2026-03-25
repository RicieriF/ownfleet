-- AlterTable deliveries: track when ETA overdue alert was sent
ALTER TABLE "deliveries"
  ADD COLUMN "eta_overdue_alerted_at" TIMESTAMPTZ;
