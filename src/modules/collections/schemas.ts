import { z } from "zod";
import { fieldInputSchema } from "../templates/schemas.js";

export const createCollectionSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).optional(),
  amount: z.number().int().nonnegative(),
  currency: z.string().trim().length(3).toUpperCase().default("NGN"),
  cover_image_url: z.string().url().optional(),
  is_active: z.boolean().optional(),
  reconciliation_enabled: z.boolean().optional(),
  reconciliation_label: z.string().trim().min(1).max(80).optional(),
  template_id: z.string().min(1).optional(),
});
export type CreateCollectionInput = z.infer<typeof createCollectionSchema>;

export const updateCollectionSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(5000).nullable().optional(),
    amount: z.number().int().nonnegative().optional(),
    currency: z.string().trim().length(3).toUpperCase().optional(),
    cover_image_url: z.string().url().nullable().optional(),
    is_active: z.boolean().optional(),
    reconciliation_enabled: z.boolean().optional(),
    reconciliation_label: z.string().trim().min(1).max(80).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "At least one field required",
  });
export type UpdateCollectionInput = z.infer<typeof updateCollectionSchema>;

export const replaceCollectionFieldsSchema = z.object({
  fields: z.array(fieldInputSchema).max(100),
});
export type ReplaceCollectionFieldsInput = z.infer<
  typeof replaceCollectionFieldsSchema
>;

export const collectionIdParamSchema = z.object({
  id: z.string().min(1),
});

export const exportCollectionQuerySchema = z.object({
  status: z.enum(["paid", "unpaid"]).default("paid"),
});
export type ExportCollectionQuery = z.infer<typeof exportCollectionQuerySchema>;

export const shortCodeParamSchema = z.object({
  short_code: z.string().min(1).max(64),
});
