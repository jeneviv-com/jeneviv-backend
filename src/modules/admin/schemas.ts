import { z } from "zod";

export const listMerchantsQuerySchema = z.object({
  status: z
    .enum(["pending", "approved", "rejected", "suspended"])
    .optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ListMerchantsQuery = z.infer<typeof listMerchantsQuerySchema>;

export const merchantIdParamSchema = z.object({
  id: z.string().min(1),
});

export const approveMerchantSchema = z.object({
  note: z.string().trim().max(2000).optional(),
});
export type ApproveMerchantInput = z.infer<typeof approveMerchantSchema>;

export const rejectMerchantSchema = z.object({
  note: z.string().trim().min(1).max(2000),
});
export type RejectMerchantInput = z.infer<typeof rejectMerchantSchema>;

export const suspendMerchantSchema = z.object({
  note: z.string().trim().min(1).max(2000),
});
export type SuspendMerchantInput = z.infer<typeof suspendMerchantSchema>;
