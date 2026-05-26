import { z } from "zod";

export const applyMerchantSchema = z.object({
  display_name: z.string().trim().min(2).max(120),
  application_note: z.string().trim().max(2000).optional(),
});
export type ApplyMerchantInput = z.infer<typeof applyMerchantSchema>;

export const updateMerchantSettingsSchema = z
  .object({
    display_name: z.string().trim().min(2).max(120).optional(),
    payout_mode: z.enum(["manual", "auto_daily", "auto_weekly"]).optional(),
    default_bank_account_id: z.string().min(1).nullable().optional(),
    email_notification_for_transactions: z.boolean().optional(),
    email_notification_period: z
      .enum(["immediate", "hourly", "6hourly", "12hourly", "daily"])
      .optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "At least one field must be provided",
  });
export type UpdateMerchantSettingsInput = z.infer<
  typeof updateMerchantSettingsSchema
>;

export const createBankAccountSchema = z.object({
  bank_code: z.string().trim().min(2).max(20),
  account_number: z.string().trim().regex(/^\d{6,20}$/),
  currency: z.string().trim().length(3).default("NGN"),
  is_default: z.boolean().optional(),
});
export type CreateBankAccountInput = z.infer<typeof createBankAccountSchema>;

export const bankAccountIdParamSchema = z.object({
  id: z.string().min(1),
});
