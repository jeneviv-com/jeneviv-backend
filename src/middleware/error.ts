import type { NextFunction, Request, Response } from "express";

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: unknown,
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function notFoundHandler(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  next(
    new HttpError(
      404,
      "not_found",
      `Route not found: ${req.method} ${req.path}`,
    ),
  );
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof HttpError) {
    res.status(err.status).json({
      error: {
        code: err.code,
        message: err.message,
        ...(err.details !== undefined ? { details: err.details } : {}),
      },
    });
    return;
  }

  if (err instanceof SyntaxError && "body" in (err as SyntaxError & { body?: unknown })) {
    res.status(400).json({
      error: {
        code: "invalid_json",
        message: "Request body is not valid JSON",
      },
    });
    return;
  }

  console.error("[error]", err);
  const message =
    err instanceof Error ? err.message : "Internal server error";
  res.status(500).json({
    error: { code: "internal_error", message },
  });
}
