-- Make requestType nullable on modification_requests (keep old data)
ALTER TABLE "modification_requests" ALTER COLUMN "request_type" DROP NOT NULL;

-- Create modification_items table
CREATE TABLE IF NOT EXISTS "modification_items" (
  "id" TEXT NOT NULL,
  "modification_request_id" TEXT NOT NULL,
  "request_type" "ModReqType" NOT NULL,
  "before_value" TIMESTAMP(3),
  "after_value" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "modification_items_pkey" PRIMARY KEY ("id")
);

-- Foreign key
DO $$ BEGIN
  ALTER TABLE "modification_items" ADD CONSTRAINT "modification_items_modification_request_id_fkey"
    FOREIGN KEY ("modification_request_id") REFERENCES "modification_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Migrate existing data: copy requestType/beforeValue/afterValue to items
INSERT INTO "modification_items" ("id", "modification_request_id", "request_type", "before_value", "after_value")
SELECT gen_random_uuid()::text, "id", "request_type", "before_value", COALESCE("after_value", NOW())
FROM "modification_requests"
WHERE "request_type" IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM "modification_items" WHERE "modification_request_id" = "modification_requests"."id"
);
