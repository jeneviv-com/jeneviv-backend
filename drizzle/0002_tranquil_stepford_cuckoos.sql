ALTER TABLE "collections" ADD COLUMN "reconciliation_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "collections" ADD COLUMN "reconciliation_label" text;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "reconciled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "reconciled_at" timestamp with time zone;