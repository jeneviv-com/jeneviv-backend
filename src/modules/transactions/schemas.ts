import { z } from "zod";

export const transactionIdParamSchema = z.object({
  id: z.string().min(1),
});
