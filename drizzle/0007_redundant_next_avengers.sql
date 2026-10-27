CREATE TABLE "collection_groups" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"logo_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "collections" ADD COLUMN "group_id" text;--> statement-breakpoint
ALTER TABLE "collection_groups" ADD CONSTRAINT "collection_groups_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "collection_groups_merchant_name_unique" ON "collection_groups" USING btree ("merchant_id","name");--> statement-breakpoint
ALTER TABLE "collections" ADD CONSTRAINT "collections_group_id_collection_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."collection_groups"("id") ON DELETE set null ON UPDATE no action;