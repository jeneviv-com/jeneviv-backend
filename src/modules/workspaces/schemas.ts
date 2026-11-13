import { z } from "zod";

/** `owner` is deliberately absent: ownership moves by transfer, not by invite. */
export const invitableRoleSchema = z.enum(["admin", "collector", "viewer"]);

export const createInviteSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  role: invitableRoleSchema.default("collector"),
});
export type CreateInviteInput = z.infer<typeof createInviteSchema>;

export const acceptInviteSchema = z.object({
  token: z.string().trim().min(20).max(200),
});

export const inviteIdParamSchema = z.object({ id: z.string().min(1) });
export const memberIdParamSchema = z.object({ id: z.string().min(1) });

export const updateMemberSchema = z.object({ role: invitableRoleSchema });
export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;
