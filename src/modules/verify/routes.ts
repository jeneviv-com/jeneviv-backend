import { Router } from "express";
import { z } from "zod";
import { validate } from "../../middleware/validate.js";
import {
  getPublicReceipt,
  renderPublicReceiptPdf,
} from "./service.js";

const referenceParamSchema = z.object({
  reference: z.string().trim().min(6).max(120),
});

export const verifyRouter = Router();

verifyRouter.get(
  "/:reference/receipt.pdf",
  validate(referenceParamSchema, "params"),
  async (req, res, next) => {
    try {
      const { reference } = req.params as { reference: string };
      const { bytes, filename } = await renderPublicReceiptPdf(reference);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `inline; filename="${filename.replace(/[^a-zA-Z0-9._-]/g, "_")}"`,
      );
      res.setHeader("Cache-Control", "private, max-age=60");
      res.send(Buffer.from(bytes));
    } catch (err) {
      next(err);
    }
  },
);

verifyRouter.get(
  "/:reference",
  validate(referenceParamSchema, "params"),
  async (req, res, next) => {
    try {
      const { reference } = req.params as { reference: string };
      const receipt = await getPublicReceipt(reference);
      res.json({ valid: true, receipt });
    } catch (err) {
      next(err);
    }
  },
);
