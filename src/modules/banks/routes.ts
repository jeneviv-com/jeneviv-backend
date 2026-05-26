import { Router } from "express";
import { validate } from "../../middleware/validate.js";
import { listBanksQuerySchema } from "./schemas.js";
import { listBanks } from "./service.js";

export const banksRouter = Router();

banksRouter.get(
  "/",
  validate(listBanksQuerySchema, "query"),
  async (req, res, next) => {
    try {
      const { country } = req.query as unknown as {
        country: string;
      };
      const banks = await listBanks(country);
      res.json({
        country,
        banks: banks.map((b) => ({ code: b.code, name: b.name })),
      });
    } catch (err) {
      next(err);
    }
  },
);
