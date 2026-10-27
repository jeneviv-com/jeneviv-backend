ALTER TABLE "merchants" ALTER COLUMN "wallet_balance_ngn" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "merchants" ALTER COLUMN "payouts_balance_ngn" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "collections" ALTER COLUMN "amount" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "amount" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "platform_fee" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "gateway_fee" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "total_charged" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "payouts" ALTER COLUMN "amount" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "refunds" ALTER COLUMN "amount" SET DATA TYPE numeric(14, 2);--> statement-breakpoint
ALTER TABLE "withdrawals" ALTER COLUMN "amount" SET DATA TYPE numeric(14, 2);