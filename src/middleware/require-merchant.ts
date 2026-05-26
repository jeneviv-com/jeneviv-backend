import { eq } from "drizzle-orm";
import type { NextFunction, Request, Response } from "express";
import { db } from "../db/index.js";
import { merchants } from "../db/schema/merchants.js";
import { HttpError } from "./error.js";

export async function requireMerchant(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) {
      throw new HttpError(401, "unauthenticated", "Authentication required");
    }

    const merchant = await db.query.merchants.findFirst({
      where: eq(merchants.userId, req.user.id),
    });

    if (!merchant) {
      throw new HttpError(
        403,
        "merchant_required",
        "No merchant account found for this user",
      );
    }

    if (merchant.status !== "approved") {
      throw new HttpError(
        403,
        "merchant_not_approved",
        `Merchant account is ${merchant.status}`,
      );
    }

    req.merchant = merchant;
    next();
  } catch (err) {
    next(err);
  }
}
