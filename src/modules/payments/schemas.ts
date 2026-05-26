import { z } from "zod";

export const initPaymentSchema = z.object({
  collection_short_code: z.string().trim().min(1).max(64),
  field_values: z.record(z.string().min(1), z.unknown()).default({}),
});
export type InitPaymentInput = z.infer<typeof initPaymentSchema>;
