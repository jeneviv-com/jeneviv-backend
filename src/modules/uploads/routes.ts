import { Router } from "express";
import { signUpload } from "../../lib/cloudinary.js";
import { HttpError } from "../../middleware/error.js";
import { requireAuth } from "../../middleware/require-auth.js";
import { validate } from "../../middleware/validate.js";
import { signUploadSchema } from "./schemas.js";

export const uploadsRouter = Router();

uploadsRouter.use(requireAuth);

uploadsRouter.post(
  "/sign",
  validate(signUploadSchema),
  async (req, res, next) => {
    try {
      const { folder, resource_type } = req.body as {
        folder?: string;
        resource_type: "image" | "raw" | "video";
      };
      const params = signUpload({ folder, resourceType: resource_type });
      res.setHeader("Cache-Control", "no-store");
      res.json(params);
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("Cloudinary")) {
        next(new HttpError(503, "cloudinary_not_configured", err.message));
        return;
      }
      next(err);
    }
  },
);
