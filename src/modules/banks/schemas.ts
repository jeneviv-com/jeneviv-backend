import { z } from "zod";

export const listBanksQuerySchema = z.object({
  country: z.string().trim().length(2).toUpperCase().default("NG"),
});
export type ListBanksQuery = z.infer<typeof listBanksQuerySchema>;
