import { z } from "zod";

export const transactionIdParamSchema = z.object({
  id: z.string().min(1),
});

export const refundIdParamSchema = z.object({
  id: z.string().min(1),
});

export const refundTransactionSchema = z.object({
  reason: z.string().trim().min(1).max(2000),
});
export type RefundTransactionInput = z.infer<typeof refundTransactionSchema>;

export const retryRefundSchema = z.object({
  account_number: z.string().trim().min(6).max(20),
  bank_code: z.string().trim().min(1).max(20),
});
export type RetryRefundInput = z.infer<typeof retryRefundSchema>;

export const listRefundsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
});
