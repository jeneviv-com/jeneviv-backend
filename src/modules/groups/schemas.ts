import { z } from "zod";

export const createGroupSchema = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2000).optional(),
  logo_url: z.string().url().max(1000).nullable().optional(),
});
export type CreateGroupInput = z.infer<typeof createGroupSchema>;

export const updateGroupSchema = z
  .object({
    name: z.string().trim().min(1).max(160).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    logo_url: z.string().url().max(1000).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field required",
  });
export type UpdateGroupInput = z.infer<typeof updateGroupSchema>;

export const groupIdParamSchema = z.object({
  id: z.string().min(1),
});
