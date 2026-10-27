import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "../../db/index.js";
import {
  templateFields,
  templates,
  type Template,
  type TemplateField,
} from "../../db/schema/collections.js";
import { newId } from "../../lib/short-code.js";
import { HttpError } from "../../middleware/error.js";
import type {
  CreateTemplateInput,
  FieldInput,
  ListTemplatesQuery,
  UpdateTemplateInput,
} from "./schemas.js";

export interface ActorContext {
  userId: string;
  isAdmin: boolean;
  merchantId: string | null;
}

export type TemplateWithFields = Template & { fields: TemplateField[] };

function ensureCanWrite(template: Template, actor: ActorContext): void {
  const isPlatform = template.merchantId === null;
  if (isPlatform) {
    if (!actor.isAdmin) {
      throw new HttpError(
        403,
        "forbidden",
        "Only admins can modify platform templates",
      );
    }
    return;
  }
  if (template.merchantId !== actor.merchantId) {
    throw new HttpError(403, "forbidden", "Template belongs to another merchant");
  }
}

function ensureCanRead(template: Template, actor: ActorContext): void {
  const isPlatform = template.merchantId === null;
  if (isPlatform) return;
  if (actor.isAdmin) return;
  if (template.merchantId !== actor.merchantId) {
    throw new HttpError(404, "not_found", "Template not found");
  }
}

export async function listTemplates(
  actor: ActorContext,
  query: ListTemplatesQuery,
): Promise<TemplateWithFields[]> {
  const ownClause = actor.merchantId
    ? eq(templates.merchantId, actor.merchantId)
    : undefined;
  const platformClause = isNull(templates.merchantId);

  let where;
  if (query.scope === "platform") {
    where = platformClause;
  } else if (query.scope === "mine") {
    if (actor.isAdmin) {
      where = platformClause;
    } else if (ownClause) {
      where = ownClause;
    } else {
      return [];
    }
  } else {
    if (actor.isAdmin) {
      where = undefined;
    } else if (ownClause) {
      where = or(ownClause, platformClause);
    } else {
      where = platformClause;
    }
  }

  const rows = await db.query.templates.findMany({
    where,
    orderBy: asc(templates.createdAt),
  });
  if (rows.length === 0) return [];

  // The dashboard lists what each template asks for, and the field editor opens
  // from the list — so the fields travel with the list instead of one request
  // per template.
  const fields = await db.query.templateFields.findMany({
    where: inArray(
      templateFields.templateId,
      rows.map((row) => row.id),
    ),
    orderBy: [asc(templateFields.position), asc(templateFields.fieldId)],
  });

  const byTemplate = new Map<string, TemplateField[]>();
  for (const field of fields) {
    const list = byTemplate.get(field.templateId) ?? [];
    list.push(field);
    byTemplate.set(field.templateId, list);
  }

  return rows.map((template) => ({
    ...template,
    fields: byTemplate.get(template.id) ?? [],
  }));
}

export async function getTemplate(
  templateId: string,
  actor: ActorContext,
): Promise<Template> {
  const template = await db.query.templates.findFirst({
    where: eq(templates.id, templateId),
  });
  if (!template) {
    throw new HttpError(404, "not_found", "Template not found");
  }
  ensureCanRead(template, actor);
  return template;
}

export async function listTemplateFields(
  templateId: string,
): Promise<TemplateField[]> {
  return db.query.templateFields.findMany({
    where: eq(templateFields.templateId, templateId),
    orderBy: [asc(templateFields.position), asc(templateFields.fieldId)],
  });
}

export async function createTemplate(
  actor: ActorContext,
  input: CreateTemplateInput,
): Promise<Template> {
  if (!actor.isAdmin && !actor.merchantId) {
    throw new HttpError(
      403,
      "merchant_required",
      "Only admins or merchants can create templates",
    );
  }
  const id = newId();
  const [created] = await db
    .insert(templates)
    .values({
      id,
      merchantId: actor.isAdmin ? null : actor.merchantId,
      name: input.name,
      description: input.description ?? null,
    })
    .returning();
  if (!created) {
    throw new HttpError(500, "internal_error", "Failed to create template");
  }
  return created;
}

export async function updateTemplate(
  templateId: string,
  actor: ActorContext,
  input: UpdateTemplateInput,
): Promise<Template> {
  const template = await getTemplate(templateId, actor);
  ensureCanWrite(template, actor);

  const patch: Partial<typeof templates.$inferInsert> = { updatedAt: new Date() };
  if (input.name !== undefined) patch.name = input.name;
  if (input.description !== undefined) patch.description = input.description;

  const [updated] = await db
    .update(templates)
    .set(patch)
    .where(eq(templates.id, templateId))
    .returning();
  if (!updated) {
    throw new HttpError(500, "internal_error", "Failed to update template");
  }
  return updated;
}

export async function deleteTemplate(
  templateId: string,
  actor: ActorContext,
): Promise<void> {
  const template = await getTemplate(templateId, actor);
  ensureCanWrite(template, actor);
  await db.delete(templates).where(eq(templates.id, templateId));
}

export async function replaceTemplateFields(
  templateId: string,
  actor: ActorContext,
  fields: FieldInput[],
): Promise<TemplateField[]> {
  const template = await getTemplate(templateId, actor);
  ensureCanWrite(template, actor);

  const seen = new Set<string>();
  for (const f of fields) {
    if (seen.has(f.field_id)) {
      throw new HttpError(
        422,
        "duplicate_field_id",
        `Duplicate field_id: ${f.field_id}`,
      );
    }
    seen.add(f.field_id);
  }

  return db.transaction(async (tx) => {
    await tx
      .delete(templateFields)
      .where(eq(templateFields.templateId, templateId));

    if (fields.length === 0) return [];

    const rows = fields.map((f) => ({
      id: newId(),
      templateId,
      position: f.position,
      displayName: f.display_name,
      fieldId: f.field_id,
      type: f.type,
      required: f.required,
      options: f.options ?? null,
    }));
    await tx.insert(templateFields).values(rows);

    return tx.query.templateFields.findMany({
      where: eq(templateFields.templateId, templateId),
      orderBy: [asc(templateFields.position), asc(templateFields.fieldId)],
    });
  });
}
