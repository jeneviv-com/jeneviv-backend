import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import {
  collectionGroups,
  collections,
  type CollectionGroup,
} from "../../db/schema/collections.js";
import type { Merchant } from "../../db/schema/merchants.js";
import { destroyLogo, isCloudinaryUrlOnOurCloud } from "../../lib/cloudinary.js";
import { newId } from "../../lib/short-code.js";
import { HttpError } from "../../middleware/error.js";
import type {
  CreateGroupInput,
  UpdateGroupInput,
} from "./schemas.js";

export type GroupWithCount = CollectionGroup & { collection_count: number };

/**
 * Logos are rendered on payer pages and embedded in receipt PDFs, so the URL has
 * to be an image on our own Cloudinary cloud. A signed upload from
 * POST /api/uploads/sign is the only way to produce one.
 */
function assertOwnLogo(url: string | null | undefined): string | null {
  if (url === null || url === undefined || url === "") return null;
  if (!isCloudinaryUrlOnOurCloud(url)) {
    throw new HttpError(
      422,
      "invalid_logo_url",
      "Upload the logo with POST /api/uploads/sign — the URL must be an image on our Cloudinary cloud.",
    );
  }
  return url;
}

export async function listGroups(
  merchantId: string,
): Promise<GroupWithCount[]> {
  const rows = await db
    .select({
      group: collectionGroups,
      collectionCount: sql<number>`count(${collections.id})::int`,
    })
    .from(collectionGroups)
    .leftJoin(collections, eq(collections.groupId, collectionGroups.id))
    .where(eq(collectionGroups.merchantId, merchantId))
    .groupBy(collectionGroups.id)
    .orderBy(asc(collectionGroups.name));

  return rows.map((row) => ({
    ...row.group,
    collection_count: row.collectionCount,
  }));
}

export async function getGroup(
  merchant: Merchant,
  groupId: string,
): Promise<CollectionGroup> {
  const group = await db.query.collectionGroups.findFirst({
    where: and(
      eq(collectionGroups.id, groupId),
      eq(collectionGroups.merchantId, merchant.id),
    ),
  });
  if (!group) {
    throw new HttpError(404, "not_found", "Group not found");
  }
  return group;
}

/** Maps a database unique-violation on the group name to the same 409 the pre-check returns. */
function mapGroupConflict(err: unknown): never {
  if (typeof err === "object" && err !== null && (err as { code?: string }).code === "23505") {
    throw new HttpError(409, "group_name_taken", "You already have a group with that name");
  }
  throw err;
}

export async function createGroup(
  merchant: Merchant,
  input: CreateGroupInput,
): Promise<CollectionGroup> {
  const existing = await db.query.collectionGroups.findFirst({
    where: and(
      eq(collectionGroups.merchantId, merchant.id),
      eq(collectionGroups.name, input.name),
    ),
  });
  if (existing) {
    throw new HttpError(
      409,
      "group_name_taken",
      "You already have a group with that name",
    );
  }

  const [created] = await db
    .insert(collectionGroups)
    .values({
      id: newId(),
      merchantId: merchant.id,
      name: input.name,
      description: input.description ?? null,
      logoUrl: assertOwnLogo(input.logo_url),
    })
    .returning()
    .catch(mapGroupConflict);

  if (!created) {
    throw new HttpError(500, "internal_error", "Failed to create group");
  }
  return created;
}

export async function updateGroup(
  merchant: Merchant,
  groupId: string,
  input: UpdateGroupInput,
): Promise<CollectionGroup> {
  const existing = await getGroup(merchant, groupId);

  if (input.name !== undefined && input.name !== existing.name) {
    const clash = await db.query.collectionGroups.findFirst({
      where: and(
        eq(collectionGroups.merchantId, merchant.id),
        eq(collectionGroups.name, input.name),
      ),
    });
    if (clash) {
      throw new HttpError(
        409,
        "group_name_taken",
        "You already have a group with that name",
      );
    }
  }

  const patch: Partial<typeof collectionGroups.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (input.name !== undefined) patch.name = input.name;
  if (input.description !== undefined) patch.description = input.description;
  if (input.logo_url !== undefined) patch.logoUrl = assertOwnLogo(input.logo_url);

  const [updated] = await db
    .update(collectionGroups)
    .set(patch)
    .where(eq(collectionGroups.id, groupId))
    .returning()
    .catch(mapGroupConflict);
  if (!updated) {
    throw new HttpError(500, "internal_error", "Failed to update group");
  }

  // Remove the previous logo once it has been replaced.
  if (input.logo_url !== undefined && existing.logoUrl && existing.logoUrl !== updated.logoUrl) {
    await destroyLogo(existing.logoUrl);
  }
  return updated;
}

/**
 * Deleting a group only ungroups its collections — `collections.group_id` is
 * ON DELETE SET NULL, so no collection (or its history) is ever removed with it.
 */
export async function deleteGroup(
  merchant: Merchant,
  groupId: string,
): Promise<void> {
  const group = await getGroup(merchant, groupId);
  await db.delete(collectionGroups).where(eq(collectionGroups.id, groupId));
  await destroyLogo(group.logoUrl);
}