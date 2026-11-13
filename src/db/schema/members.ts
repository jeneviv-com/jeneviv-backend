import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { users } from "./auth.js";
import { merchants } from "./merchants.js";
import type { WorkspaceMemberStatus, WorkspaceRole } from "./enums.js";

/**
 * Who can see a workspace.
 *
 * The workspace is the `merchants` row — that is the money boundary, and every
 * list, receipt and payout is scoped to it. Membership lives here rather than
 * being derived from `merchants.user_id`, so a workspace can have several
 * people without sharing a login. `merchants.user_id` stays as the account that
 * applied and owns settlement.
 *
 * Absence of a row here means no access at all: there is deliberately no
 * "everyone in the organisation can see it" rule, because that is the one thing
 * a money product cannot afford to get wrong.
 */
export const workspaceMembers = pgTable(
  "workspace_members",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").$type<WorkspaceRole>().notNull().default("collector"),
    status: text("status")
      .$type<WorkspaceMemberStatus>()
      .notNull()
      .default("active"),
    invitedByUserId: text("invited_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    lastActiveAt: timestamp("last_active_at", {
      mode: "date",
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // One membership per person per workspace; role changes update the row.
    uniqueIndex("workspace_members_workspace_user_unique").on(
      table.workspaceId,
      table.userId,
    ),
    // "Which workspaces can I open?" is the query every request starts with.
    index("workspace_members_user_idx").on(table.userId, table.status),
  ],
);

/**
 * A pending invitation.
 *
 * Only the hash of the token is stored, so a database leak cannot be replayed
 * into a membership. An invite is spent exactly once: `accepted_at` is set
 * inside the same transaction that inserts the membership.
 */
export const workspaceInvites = pgTable(
  "workspace_invites",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role").$type<WorkspaceRole>().notNull().default("collector"),
    tokenHash: text("token_hash").notNull(),
    invitedByUserId: text("invited_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    expiresAt: timestamp("expires_at", {
      mode: "date",
      withTimezone: true,
    }).notNull(),
    acceptedAt: timestamp("accepted_at", {
      mode: "date",
      withTimezone: true,
    }),
    acceptedByUserId: text("accepted_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    revokedAt: timestamp("revoked_at", {
      mode: "date",
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("workspace_invites_token_hash_unique").on(table.tokenHash),
    // Pending invites for a workspace, and "is this email already invited?".
    index("workspace_invites_workspace_idx").on(table.workspaceId, table.email),
  ],
);
