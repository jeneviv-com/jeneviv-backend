ALTER TABLE "merchants" ADD COLUMN "bvn_hash" text;--> statement-breakpoint
ALTER TABLE "merchants" ADD COLUMN "bvn_last4" text;--> statement-breakpoint
ALTER TABLE "merchants" ADD COLUMN "kyc_id_type" text;--> statement-breakpoint
-- Everyone verified before BVN existed used NIN.
UPDATE "merchants" SET "kyc_id_type" = 'nin' WHERE "nin_verified_at" IS NOT NULL AND "kyc_id_type" IS NULL;