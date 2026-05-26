import { z } from "zod";

export const transactionIdParamSchema = z.object({
  id: z.string().min(1),
});

export const refundTransactionSchema = z.object({
  reason: z.string().trim().min(1).max(2000),
});
export type RefundTransactionInput = z.infer<typeof refundTransactionSchema>;
