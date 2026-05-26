CREATE TABLE "merchant_bank_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant_id" text NOT NULL,
	"account_number" text NOT NULL,
	"account_name" text NOT NULL,
	"bank_code" text NOT NULL,
	"currency" text DEFAULT 'NGN' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "merchants" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"merchant_code" text NOT NULL,
	"display_name" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"wallet_balance_ngn" bigint DEFAULT 0 NOT NULL,
	"payouts_balance_ngn" bigint DEFAULT 0 NOT NULL,
	"payout_mode" text DEFAULT 'manual' NOT NULL,
	"default_bank_account_id" text,
	"email_notification_for_transactions" boolean DEFAULT true NOT NULL,
	"email_notification_period" text DEFAULT 'immediate' NOT NULL,
	"application_note" text,
	"admin_review_note" text,
	"reviewed_by_uid" text,
	"reviewed_at" timestamp with time zone,
	"gateway_customer_ids" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collection_fields" (
	"id" text PRIMARY KEY NOT NULL,
	"collection_id" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"display_name" text NOT NULL,
	"field_id" text NOT NULL,
	"type" text NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"options" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collections" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant_id" text NOT NULL,
	"short_code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"amount" bigint NOT NULL,
	"currency" text DEFAULT 'NGN' NOT NULL,
	"cover_image_url" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_fields" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"field_id" text NOT NULL,
	"display_name" text NOT NULL,
	"type" text NOT NULL,
	"value" text NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "template_fields" (
	"id" text PRIMARY KEY NOT NULL,
	"template_id" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"display_name" text NOT NULL,
	"field_id" text NOT NULL,
	"type" text NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"options" jsonb
);
--> statement-breakpoint
CREATE TABLE "templates" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant_id" text,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"transaction_id" text NOT NULL,
	"for_user_id" text NOT NULL,
	"gateway" text NOT NULL,
	"gateway_account_id" text NOT NULL,
	"account_number" text NOT NULL,
	"account_name" text NOT NULL,
	"bank_code" text NOT NULL,
	"bank_name" text NOT NULL,
	"currency" text NOT NULL,
	"expiry_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transaction_fields" (
	"id" text PRIMARY KEY NOT NULL,
	"transaction_id" text NOT NULL,
	"field_id" text NOT NULL,
	"display_name" text NOT NULL,
	"value" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"reference" text NOT NULL,
	"customer_id" text NOT NULL,
	"merchant_id" text NOT NULL,
	"collection_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"amount" bigint NOT NULL,
	"platform_fee" bigint NOT NULL,
	"gateway_fee" bigint DEFAULT 0 NOT NULL,
	"total_charged" bigint NOT NULL,
	"currency" text NOT NULL,
	"gateway" text NOT NULL,
	"gateway_ref" text,
	"gateway_id" text,
	"payment_account_id" text,
	"paid_at" timestamp with time zone,
	"settled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payouts" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant_id" text NOT NULL,
	"bank_account_id" text NOT NULL,
	"account_number" text NOT NULL,
	"account_name" text NOT NULL,
	"bank_code" text NOT NULL,
	"amount" bigint NOT NULL,
	"currency" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"gateway" text NOT NULL,
	"gateway_tx_id" text,
	"gateway_ref" text NOT NULL,
	"failure_reason" text,
	"initiated_by" text NOT NULL,
	"initiated_by_uid" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" text PRIMARY KEY NOT NULL,
	"transaction_id" text NOT NULL,
	"merchant_id" text NOT NULL,
	"amount" bigint NOT NULL,
	"reason" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"gateway_ref" text,
	"initiated_by_uid" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_uid" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bank_codes" (
	"code" text NOT NULL,
	"gateway" text NOT NULL,
	"country" text DEFAULT 'NG' NOT NULL,
	"name" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_codes_pk" PRIMARY KEY("code","gateway")
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" text PRIMARY KEY NOT NULL,
	"gateway" text NOT NULL,
	"event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"signature_verified" boolean DEFAULT false NOT NULL,
	"payload" jsonb NOT NULL,
	"processed_at" timestamp with time zone,
	"processing_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "role" text DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "default_currency" text DEFAULT 'NGN' NOT NULL;--> statement-breakpoint
ALTER TABLE "merchant_bank_accounts" ADD CONSTRAINT "merchant_bank_accounts_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchants" ADD CONSTRAINT "merchants_user_id_users_uid_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("uid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchants" ADD CONSTRAINT "merchants_reviewed_by_uid_users_uid_fk" FOREIGN KEY ("reviewed_by_uid") REFERENCES "public"."users"("uid") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_fields" ADD CONSTRAINT "collection_fields_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collections" ADD CONSTRAINT "collections_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_fields" ADD CONSTRAINT "customer_fields_user_id_users_uid_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("uid") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_fields" ADD CONSTRAINT "template_fields_template_id_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_accounts" ADD CONSTRAINT "payment_accounts_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_accounts" ADD CONSTRAINT "payment_accounts_for_user_id_users_uid_fk" FOREIGN KEY ("for_user_id") REFERENCES "public"."users"("uid") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_fields" ADD CONSTRAINT "transaction_fields_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_customer_id_users_uid_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."users"("uid") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_bank_account_id_merchant_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."merchant_bank_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_initiated_by_uid_users_uid_fk" FOREIGN KEY ("initiated_by_uid") REFERENCES "public"."users"("uid") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_initiated_by_uid_users_uid_fk" FOREIGN KEY ("initiated_by_uid") REFERENCES "public"."users"("uid") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_uid_users_uid_fk" FOREIGN KEY ("actor_uid") REFERENCES "public"."users"("uid") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "merchants_user_id_unique" ON "merchants" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "merchants_merchant_code_unique" ON "merchants" USING btree ("merchant_code");--> statement-breakpoint
CREATE UNIQUE INDEX "collection_fields_collection_field_unique" ON "collection_fields" USING btree ("collection_id","field_id");--> statement-breakpoint
CREATE UNIQUE INDEX "collections_short_code_unique" ON "collections" USING btree ("short_code");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_fields_user_field_unique" ON "customer_fields" USING btree ("user_id","field_id");--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_reference_unique" ON "transactions" USING btree ("reference");--> statement-breakpoint
CREATE UNIQUE INDEX "payouts_gateway_ref_unique" ON "payouts" USING btree ("gateway_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_events_gateway_event_unique" ON "webhook_events" USING btree ("gateway","event_id");