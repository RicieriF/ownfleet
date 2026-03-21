-- AddColumn: users.courier_id (optional link to a courier account)
ALTER TABLE "users" ADD COLUMN "courier_id" TEXT UNIQUE REFERENCES "couriers"("id") ON DELETE SET NULL;
