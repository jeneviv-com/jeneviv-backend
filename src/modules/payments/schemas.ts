import { z } from "zod";

export const initPaymentSchema = z.object({
  collection_short_code: z.string().trim().min(1).max(64),
  field_values: z.record(z.string().min(1), z.unknown()).default({}),
  payer_email: z.string().email().optional(),
  payer_name: z.string().trim().min(1).max(200).optional(),
});
export type InitPaymentInput = z.infer<typeof initPaymentSchema>;
