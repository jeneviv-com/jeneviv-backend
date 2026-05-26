import { z } from "zod";

const FIELD_TYPES = [
  "short_text",
  "long_text",
  "number",
  "email",
  "phone",
  "select",
  "multiselect",
  "image",
  "file",
  "date",
] as const;

const fieldIdRegex = /^[a-z][a-z0-9_]{0,63}$/;

export const fieldInputSchema = z
  .object({
    position: z.number().int().min(0).default(0),
    display_name: z.string().trim().min(1).max(200),
    field_id: z.string().trim().regex(fieldIdRegex, {
      message: "field_id must be snake_case starting with a letter",
    }),
    type: z.enum(FIELD_TYPES),
    required: z.boolean().default(true),
    options: z.array(z.string().trim().min(1)).nullable().optional(),
  })
  .refine(
    (f) =>
      f.type === "select" || f.type === "multiselect"
        ? Array.isArray(f.options) && f.options.length > 0
        : true,
    { message: "options is required for select/multiselect fields" },
  )
  .refine(
    (f) =>
      f.type === "select" || f.type === "multiselect"
        ? true
        : !f.options || f.options.length === 0,
    { message: "options is only valid for select/multiselect fields" },
  );
export type FieldInput = z.infer<typeof fieldInputSchema>;

export const createTemplateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
});
export type CreateTemplateInput = z.infer<typeof createTemplateSchema>;

export const updateTemplateSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "At least one field required",
  });
export type UpdateTemplateInput = z.infer<typeof updateTemplateSchema>;

export const replaceFieldsSchema = z.object({
  fields: z.array(fieldInputSchema).max(100),
});
export type ReplaceFieldsInput = z.infer<typeof replaceFieldsSchema>;

export const templateIdParamSchema = z.object({
  id: z.string().min(1),
});

export const listTemplatesQuerySchema = z.object({
  scope: z.enum(["mine", "platform", "all"]).default("all"),
});
export type ListTemplatesQuery = z.infer<typeof listTemplatesQuerySchema>;
