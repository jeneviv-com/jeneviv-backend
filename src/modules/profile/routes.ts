import { Router, raw } from "express";
import { eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { users } from "../../db/schema/auth.js";
import {
  cloudinaryConfigured,
  destroyLogo,
  uploadImageBuffer,
} from "../../lib/cloudinary.js";
import { HttpError } from "../../middleware/error.js";
import { requireAuth } from "../../middleware/require-auth.js";

/**
 * Profile picture upload.
 *
 * The body is the raw image, not multipart: the API caps it at 5 MB before it
 * is buffered, sniffs the real file type from the bytes rather than trusting
 * the header, and only then hands it to Cloudinary. The account's previous
 * picture is deleted afterwards when it lived on our own cloud.
 */

export const profileRouter = Router();

export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const AVATAR_FOLDER = "jeneviv/avatars";
/**
 * Every avatar is stored as a square WebP. That matters for two reasons: phone
 * cameras hand us HEIC (which browsers cannot render), and a 12 MP photo is
 * far too heavy for an avatar. Cloudinary does the decode and the resize.
 */
const AVATAR_TRANSFORMATION = "c_fill,w_512,h_512,f_webp,q_auto";

profileRouter.use(requireAuth);

/**
 * Real type from the first bytes. A declared content-type is only a hint.
 *
 * HEIC/HEIF and AVIF are included because that is what an iPhone or Samsung
 * camera produces; Cloudinary converts them to WebP via the transformation, so
 * accepting them here is what stops a phone upload from failing with 415.
 */
function sniffImageType(buffer: Buffer): { mime: string; ext: string } | null {
  if (buffer.length < 12) return null;
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return { mime: "image/png", ext: "png" };
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mime: "image/jpeg", ext: "jpg" };
  }
  if (
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return { mime: "image/webp", ext: "webp" };
  }
  const header = buffer.subarray(0, 6).toString("ascii");
  if (header === "GIF87a" || header === "GIF89a") {
    return { mime: "image/gif", ext: "gif" };
  }
  if (buffer[0] === 0x42 && buffer[1] === 0x4d) {
    return { mime: "image/bmp", ext: "bmp" };
  }
  if (buffer.subarray(4, 8).toString("ascii") === "ftyp") {
    const brand = buffer.subarray(8, 12).toString("ascii").toLowerCase();
    if (["heic", "heix", "hevc", "heim", "heis", "mif1", "msf1"].includes(brand)) {
      return { mime: "image/heic", ext: "heic" };
    }
    if (["avif", "avis"].includes(brand)) {
      return { mime: "image/avif", ext: "avif" };
    }
  }
  return null;
}

profileRouter.post(
  "/avatar",
  // +1 byte so an oversized upload reaches the handler and gets a clear 413
  // instead of the parser's generic error.
  raw({ type: () => true, limit: MAX_AVATAR_BYTES + 1 }),
  async (req, res, next) => {
    try {
      const buffer = Buffer.isBuffer(req.body) ? req.body : null;
      if (!buffer || buffer.length === 0) {
        throw new HttpError(
          400,
          "image_required",
          "Send the image bytes as the request body with an image content type.",
        );
      }
      if (buffer.length > MAX_AVATAR_BYTES) {
        throw new HttpError(
          413,
          "image_too_large",
          "Profile pictures must be 5 MB or smaller.",
        );
      }

      const sniffed = sniffImageType(buffer);
      if (!sniffed) {
        throw new HttpError(
          415,
          "unsupported_image",
          "Use a JPG, PNG, WebP, HEIC or AVIF image.",
        );
      }

      if (!cloudinaryConfigured()) {
        throw new HttpError(
          503,
          "storage_not_configured",
          "Profile picture storage is not configured on this server",
        );
      }

      const user = req.user!;
      let url: string;
      try {
        ({ url } = await uploadImageBuffer(buffer, {
          folder: AVATAR_FOLDER,
          mimeType: sniffed.mime,
          transformation: AVATAR_TRANSFORMATION,
        }));
      } catch (err) {
        // Cloudinary's own text is the only useful clue (bad key, quota, etc.),
        // so surface it rather than a generic 500.
        throw new HttpError(
          502,
          "storage_error",
          `Could not store the picture: ${
            err instanceof Error ? err.message : "unknown error"
          }`,
        );
      }

      await db
        .update(users)
        .set({ image: url, updatedAt: new Date() })
        .where(eq(users.id, user.id));

      // Old picture is removed only after the new one is safely stored.
      if (user.image && user.image !== url) await destroyLogo(user.image);

      res.setHeader("Cache-Control", "no-store");
      res.status(201).json({ image: url });
    } catch (err) {
      next(err);
    }
  },
);

profileRouter.delete("/avatar", async (req, res, next) => {
  try {
    const user = req.user!;
    await db
      .update(users)
      .set({ image: null, updatedAt: new Date() })
      .where(eq(users.id, user.id));
    if (user.image) await destroyLogo(user.image);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
