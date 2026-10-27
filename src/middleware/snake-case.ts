import type { NextFunction, Request, Response } from "express";

/**
 * The database layer is camelCase (drizzle column names) but the HTTP API is
 * snake_case: every request schema in this repo is snake_case, and the
 * dashboard's TypeScript models are too. Handlers return drizzle rows
 * directly, so without this the response keys silently disagree with the
 * contract — `shortCode` where the client reads `short_code`, `fieldId` where
 * it reads `field_id`, and so on. It only ever showed up against the real API,
 * because the dashboard's demo dataset is already snake_case.
 *
 * This converts response keys once, at the edge, so handlers can keep reading
 * drizzle rows. It is mounted after the better-auth routes, which own their
 * own response shape.
 */

function toSnakeCase(key: string): string {
  return key.replace(/[A-Z]/g, (char) => `_${char.toLowerCase()}`);
}

/**
 * Only plain objects are rewritten. Dates, Buffers and class instances keep
 * their shape — turning a Date into `{}` is the classic way this kind of
 * normaliser breaks a payload.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function normalizeKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeKeys);
  if (!isPlainObject(value)) return value;

  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    out[toSnakeCase(key)] = normalizeKeys(child);
  }
  return out;
}

export function snakeCaseResponses(
  _request: Request,
  response: Response,
  next: NextFunction,
): void {
  const originalJson = response.json.bind(response);
  response.json = (body: unknown) => originalJson(normalizeKeys(body));
  next();
}
