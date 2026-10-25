import { z } from "zod";

export const createWithdrawalSchema = z.object({
  amount: z
    .number()
    .int()
    .positive()
    .max(1_000_000_000_00, "Amount is too large"),
  currency: z.string().trim().length(3).toUpperCase().default("NGN"),
});
export type CreateWithdrawalInput = z.infer<typeof createWithdrawalSchema>;

export const withdrawalIdParamSchema = z.object({
  id: z.string().min(1),
});

export const approvalTokenParamSchema = z.object({
  token: z.string().min(20).max(200),
});

export const approveWithdrawalSchema = z.object({
  otp: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code"),
});
export type ApproveWithdrawalInput = z.infer<typeof approveWithdrawalSchema>;

export const rejectWithdrawalSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});
export type RejectWithdrawalInput = z.infer<typeof rejectWithdrawalSchema>;

export const listWithdrawalsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).default(50),
});
export type ListWithdrawalsQuery = z.infer<typeof listWithdrawalsQuerySchema>;
