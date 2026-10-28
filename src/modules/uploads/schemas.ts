import { z } from "zod";

export const signUploadSchema = z.object({
  folder: z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9_\-/]{0,80}$/, {
      message:
        "folder may contain letters, digits, _, -, / and must start with a letter or digit",
    })
    .optional(),
  resource_type: z.enum(["image", "raw", "video"]).default("image"),
});
export type SignUploadInput = z.infer<typeof signUploadSchema>;
