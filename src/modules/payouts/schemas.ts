import { z } from "zod";

export const createPayoutSchema = z.object({
  bank_account_id: z.string().min(1),
  amount: z.number().int().positive(),
  currency: z.string().trim().length(3).toUpperCase().default("NGN"),
});
export type CreatePayoutInput = z.infer<typeof createPayoutSchema>;

export const payoutIdParamSchema = z.object({
  id: z.string().min(1),
});

export const listPayoutsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ListPayoutsQuery = z.infer<typeof listPayoutsQuerySchema>;
