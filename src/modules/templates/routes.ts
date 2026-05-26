import { eq } from "drizzle-orm";
import { Router } from "express";
import { db } from "../../db/index.js";
import { merchants } from "../../db/schema/merchants.js";
import { requireAuth } from "../../middleware/require-auth.js";
import { validate } from "../../middleware/validate.js";
import {
  createTemplateSchema,
  listTemplatesQuerySchema,
  replaceFieldsSchema,
  templateIdParamSchema,
  updateTemplateSchema,
} from "./schemas.js";
import {
  createTemplate,
  deleteTemplate,
  getTemplate,
  listTemplateFields,
  listTemplates,
  replaceTemplateFields,
  updateTemplate,
  type ActorContext,
} from "./service.js";

async function buildActor(userId: string, isAdmin: boolean): Promise<ActorContext> {
  let merchantId: string | null = null;
  if (!isAdmin) {
    const merchant = await db.query.merchants.findFirst({
      where: eq(merchants.userId, userId),
    });
    merchantId = merchant?.status === "approved" ? merchant.id : null;
  }
  return { userId, isAdmin, merchantId };
}

export const templatesRouter = Router();

templatesRouter.use(requireAuth);

templatesRouter.get(
  "/",
  validate(listTemplatesQuerySchema, "query"),
  async (req, res, next) => {
    try {
      const actor = await buildActor(req.user!.id, req.user!.role === "admin");
      const list = await listTemplates(
        actor,
        req.query as unknown as import("./schemas.js").ListTemplatesQuery,
      );
      res.json({ templates: list });
    } catch (err) {
      next(err);
    }
  },
);

templatesRouter.post(
  "/",
  validate(createTemplateSchema),
  async (req, res, next) => {
    try {
      const actor = await buildActor(req.user!.id, req.user!.role === "admin");
      const template = await createTemplate(actor, req.body);
      res.status(201).json({ template });
    } catch (err) {
      next(err);
    }
  },
);

templatesRouter.get(
  "/:id",
  validate(templateIdParamSchema, "params"),
  async (req, res, next) => {
    try {
      const actor = await buildActor(req.user!.id, req.user!.role === "admin");
      const { id } = req.params as { id: string };
      const template = await getTemplate(id, actor);
      const fields = await listTemplateFields(id);
      res.json({ template, fields });
    } catch (err) {
      next(err);
    }
  },
);

templatesRouter.patch(
  "/:id",
  validate(templateIdParamSchema, "params"),
  validate(updateTemplateSchema),
  async (req, res, next) => {
    try {
      const actor = await buildActor(req.user!.id, req.user!.role === "admin");
      const { id } = req.params as { id: string };
      const template = await updateTemplate(id, actor, req.body);
      res.json({ template });
    } catch (err) {
      next(err);
    }
  },
);

templatesRouter.delete(
  "/:id",
  validate(templateIdParamSchema, "params"),
  async (req, res, next) => {
    try {
      const actor = await buildActor(req.user!.id, req.user!.role === "admin");
      const { id } = req.params as { id: string };
      await deleteTemplate(id, actor);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
);

templatesRouter.get(
  "/:id/fields",
  validate(templateIdParamSchema, "params"),
  async (req, res, next) => {
    try {
      const actor = await buildActor(req.user!.id, req.user!.role === "admin");
      const { id } = req.params as { id: string };
      await getTemplate(id, actor);
      const fields = await listTemplateFields(id);
      res.json({ fields });
    } catch (err) {
      next(err);
    }
  },
);

templatesRouter.post(
  "/:id/fields",
  validate(templateIdParamSchema, "params"),
  validate(replaceFieldsSchema),
  async (req, res, next) => {
    try {
      const actor = await buildActor(req.user!.id, req.user!.role === "admin");
      const { id } = req.params as { id: string };
      const fields = await replaceTemplateFields(id, actor, req.body.fields);
      res.json({ fields });
    } catch (err) {
      next(err);
    }
  },
);
