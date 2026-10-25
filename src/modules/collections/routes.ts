import { Router } from "express";
import { requireAuth } from "../../middleware/require-auth.js";
import { requireMerchant } from "../../middleware/require-merchant.js";
import { validate } from "../../middleware/validate.js";
import {
  listCollectionTransactionsQuerySchema,
  type ListCollectionTransactionsQuery,
} from "../transactions/schemas.js";
import { listCollectionTransactionsForMerchant } from "../transactions/service.js";
import {
  collectionIdParamSchema,
  createCollectionSchema,
  exportCollectionQuerySchema,
  replaceCollectionFieldsSchema,
  shortCodeParamSchema,
  updateCollectionSchema,
  type ExportCollectionQuery,
} from "./schemas.js";
import { buildCollectionExport } from "./export.js";
import {
  createCollection,
  deleteCollection,
  getCollectionByShortCode,
  getMerchantCollection,
  listMerchantCollections,
  replaceCollectionFields,
  updateCollection,
} from "./service.js";

export const collectionsRouter = Router();

collectionsRouter.get(
  "/by-code/:short_code",
  validate(shortCodeParamSchema, "params"),
  async (req, res, next) => {
    try {
      const { short_code } = req.params as { short_code: string };
      const data = await getCollectionByShortCode(short_code);
      res.json(data);
    } catch (err) {
      next(err);
    }
  },
);

collectionsRouter.use(requireAuth, requireMerchant);

collectionsRouter.get("/", async (req, res, next) => {
  try {
    const list = await listMerchantCollections(req.merchant!.id);
    res.json({ collections: list });
  } catch (err) {
    next(err);
  }
});

collectionsRouter.post(
  "/",
  validate(createCollectionSchema),
  async (req, res, next) => {
    try {
      const result = await createCollection(req.merchant!, req.body);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },
);

collectionsRouter.get(
  "/:id/export",
  validate(collectionIdParamSchema, "params"),
  validate(exportCollectionQuerySchema, "query"),
  async (req, res, next) => {
    try {
      const { id } = req.params as { id: string };
      const { status } = req.query as unknown as ExportCollectionQuery;
      const file = await buildCollectionExport(req.merchant!, id, status);
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${file.filename.replace(/[^a-zA-Z0-9._-]/g, "_")}"`,
      );
      res.send(file.buffer);
    } catch (err) {
      next(err);
    }
  },
);

collectionsRouter.get(
  "/:id",
  validate(collectionIdParamSchema, "params"),
  async (req, res, next) => {
    try {
      const { id } = req.params as { id: string };
      const result = await getMerchantCollection(req.merchant!, id);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

collectionsRouter.patch(
  "/:id",
  validate(collectionIdParamSchema, "params"),
  validate(updateCollectionSchema),
  async (req, res, next) => {
    try {
      const { id } = req.params as { id: string };
      const collection = await updateCollection(req.merchant!, id, req.body);
      res.json({ collection });
    } catch (err) {
      next(err);
    }
  },
);

collectionsRouter.delete(
  "/:id",
  validate(collectionIdParamSchema, "params"),
  async (req, res, next) => {
    try {
      const { id } = req.params as { id: string };
      await deleteCollection(req.merchant!, id);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
);

collectionsRouter.get(
  "/:id/transactions",
  validate(collectionIdParamSchema, "params"),
  validate(listCollectionTransactionsQuerySchema, "query"),
  async (req, res, next) => {
    try {
      const { id } = req.params as { id: string };
      const data = await listCollectionTransactionsForMerchant(
        req.merchant!,
        id,
        req.query as unknown as ListCollectionTransactionsQuery,
      );
      res.json(data);
    } catch (err) {
      next(err);
    }
  },
);

collectionsRouter.post(
  "/:id/fields",
  validate(collectionIdParamSchema, "params"),
  validate(replaceCollectionFieldsSchema),
  async (req, res, next) => {
    try {
      const { id } = req.params as { id: string };
      const fields = await replaceCollectionFields(
        req.merchant!,
        id,
        req.body.fields,
      );
      res.json({ fields });
    } catch (err) {
      next(err);
    }
  },
);
