import { z } from "zod";

export const transactionIdParamSchema = z.object({
  id: z.string().min(1),
});

export const listCollectionTransactionsQuerySchema = z.object({
  status: z
    .enum([
      "pending",
      "processing",
      "success",
      "failed",
      "cancelled",
      "expired",
    ])
    .optional(),
  settled: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ListCollectionTransactionsQuery = z.infer<
  typeof listCollectionTransactionsQuerySchema
>;

export const reconcileTransactionsSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(500),
  reconciled: z.boolean(),
});
export type ReconcileTransactionsInput = z.infer<
  typeof reconcileTransactionsSchema
>;
