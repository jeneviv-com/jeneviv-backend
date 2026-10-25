import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { env } from "../env.js";

function key(): string {
  return env.BETTER_AUTH_SECRET;
}

export function hashSecret(value: string, scope: string): string {
  return createHmac("sha256", key()).update(`${scope}:${value}`).digest("hex");
}

export function hashNin(nin: string): string {
  return createHash("sha256").update(`nin:${key()}:${nin}`).digest("hex");
}

export function newOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

export function newOtp(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function secretMatches(expectedHash: string, candidate: string, scope: string): boolean {
  const actual = Buffer.from(hashSecret(candidate, scope), "utf8");
  const expected = Buffer.from(expectedHash, "utf8");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
