-- Add slug to establishments with a temp default for existing rows, then drop the default
ALTER TABLE "establishments" ADD COLUMN "slug" TEXT NOT NULL DEFAULT '';
ALTER TABLE "establishments" ALTER COLUMN "slug" DROP DEFAULT;
CREATE UNIQUE INDEX "establishments_slug_key" ON "establishments"("slug");
