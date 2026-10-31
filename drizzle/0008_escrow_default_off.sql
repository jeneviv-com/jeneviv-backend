ALTER TABLE "merchants" ALTER COLUMN "escrow_enabled" SET DEFAULT false;--> statement-breakpoint
UPDATE "merchants" SET "escrow_enabled" = false WHERE "escrow_enabled" = true;
