import type { NextFunction, Request, Response } from "express";
import type { ZodType } from "zod";
import { HttpError } from "./error.js";

type Source = "body" | "query" | "params";

export function validate<T>(schema: ZodType<T>, source: Source = "body") {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      next(
        new HttpError(
          422,
          "validation_error",
          "Invalid request",
          result.error.issues,
        ),
      );
      return;
    }
    if (source === "query") {
      Object.defineProperty(req, "query", {
        value: result.data,
        writable: true,
        configurable: true,
        enumerable: true,
      });
    } else {
      (req as unknown as Record<Source, unknown>)[source] = result.data;
    }
    next();
  };
}
