import { z } from "zod";

export const applyMerchantSchema = z.object({
  display_name: z.string().trim().min(2).max(120),
  application_note: z.string().trim().max(2000).optional(),
});
export type ApplyMerchantInput = z.infer<typeof applyMerchantSchema>;

export const updateMerchantSettingsSchema = z
  .object({
    display_name: z.string().trim().min(2).max(120).optional(),
    logo_url: z.string().url().max(500).nullable().optional(),
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

export const submitNinSchema = z.object({
  nin: z
    .string()
    .trim()
    .regex(/^\d{11}$/, "NIN must be exactly 11 digits"),
});
export type SubmitNinInput = z.infer<typeof submitNinSchema>;

export const verifyBankSchema = z.object({
  bank_code: z.string().trim().min(2).max(20),
  account_number: z.string().trim().regex(/^\d{6,20}$/),
});
export type VerifyBankInput = z.infer<typeof verifyBankSchema>;

export const setTreasurerSchema = z.object({
  treasurer_name: z.string().trim().min(2).max(120),
  treasurer_phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9]{10,15}$/, "Enter a valid phone number"),
});
export type SetTreasurerInput = z.infer<typeof setTreasurerSchema>;
