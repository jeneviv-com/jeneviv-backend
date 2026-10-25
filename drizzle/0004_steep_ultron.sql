CREATE TABLE "withdrawals" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant_id" text NOT NULL,
	"amount" bigint NOT NULL,
	"currency" text DEFAULT 'NGN' NOT NULL,
	"source" text DEFAULT 'escrow' NOT NULL,
	"status" text DEFAULT 'pending_treasurer' NOT NULL,
	"requested_by_uid" text,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"treasurer_name" text NOT NULL,
	"treasurer_phone" text NOT NULL,
	"approval_token_hash" text NOT NULL,
	"otp_hash" text NOT NULL,
	"otp_expires_at" timestamp with time zone NOT NULL,
	"otp_attempts" integer DEFAULT 0 NOT NULL,
	"treasurer_approved_at" timestamp with time zone,
	"rejected_at" timestamp with time zone,
	"gateway" text,
	"gateway_ref" text,
	"gateway_tx_id" text,
	"payout_id" text,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "merchants" ADD COLUMN "kyc_status" text DEFAULT 'unverified' NOT NULL;--> statement-breakpoint
ALTER TABLE "merchants" ADD COLUMN "can_collect" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "merchants" ADD COLUMN "can_withdraw" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "merchants" ADD COLUMN "nin_hash" text;--> statement-breakpoint
ALTER TABLE "merchants" ADD COLUMN "nin_last4" text;--> statement-breakpoint
ALTER TABLE "merchants" ADD COLUMN "kyc_legal_name" text;--> statement-breakpoint
ALTER TABLE "merchants" ADD COLUMN "kyc_provider_ref" text;--> statement-breakpoint
ALTER TABLE "merchants" ADD COLUMN "nin_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "merchants" ADD COLUMN "bank_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "merchants" ADD COLUMN "logo_url" text;--> statement-breakpoint
ALTER TABLE "merchants" ADD COLUMN "treasurer_name" text;--> statement-breakpoint
ALTER TABLE "merchants" ADD COLUMN "treasurer_phone" text;--> statement-breakpoint
ALTER TABLE "merchants" ADD COLUMN "escrow_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_requested_by_uid_users_uid_fk" FOREIGN KEY ("requested_by_uid") REFERENCES "public"."users"("uid") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_payout_id_payouts_id_fk" FOREIGN KEY ("payout_id") REFERENCES "public"."payouts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "withdrawals_approval_token_hash_unique" ON "withdrawals" USING btree ("approval_token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "withdrawals_gateway_ref_unique" ON "withdrawals" USING btree ("gateway_ref");