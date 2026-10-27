import { Router } from "express";
import { requireAuth } from "../../middleware/require-auth.js";
import { requireMerchant } from "../../middleware/require-merchant.js";
import { validate } from "../../middleware/validate.js";
import {
  createGroupSchema,
  groupIdParamSchema,
  updateGroupSchema,
} from "./schemas.js";
import {
  createGroup,
  deleteGroup,
  listGroups,
  updateGroup,
} from "./service.js";

export const groupsRouter = Router();

groupsRouter.use(requireAuth, requireMerchant);

groupsRouter.get("/", async (req, res, next) => {
  try {
    const groups = await listGroups(req.merchant!.id);
    res.json({ groups });
  } catch (err) {
    next(err);
  }
});

groupsRouter.post("/", validate(createGroupSchema), async (req, res, next) => {
  try {
    const group = await createGroup(req.merchant!, req.body);
    res.status(201).json({ group });
  } catch (err) {
    next(err);
  }
});

groupsRouter.patch(
  "/:id",
  validate(groupIdParamSchema, "params"),
  validate(updateGroupSchema),
  async (req, res, next) => {
    try {
      const { id } = req.params as { id: string };
      const group = await updateGroup(req.merchant!, id, req.body);
      res.json({ group });
    } catch (err) {
      next(err);
    }
  },
);

groupsRouter.delete(
  "/:id",
  validate(groupIdParamSchema, "params"),
  async (req, res, next) => {
    try {
      const { id } = req.params as { id: string };
      await deleteGroup(req.merchant!, id);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
);
