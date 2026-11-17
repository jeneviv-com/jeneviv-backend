import { beforeAll, describe, expect, it, vi } from "vitest";

let normaliseUrl: (name: string, raw: string) => string;

beforeAll(async () => {
  process.env.DATABASE_URL ??= "postgres://test@localhost/test";
  process.env.BETTER_AUTH_SECRET ??= "test-secret";
  ({ normaliseUrl } = await import("./env.js"));
});

describe("normaliseUrl", () => {
  it("adds https:// to a bare host (the PAGA_BASE_URL incident)", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(normaliseUrl("PAGA_BASE_URL", "collect.paga.com")).toBe("https://collect.paga.com");
    expect(`${normaliseUrl("PAGA_BASE_URL", "collect.paga.com")}/paymentRequest`).toBe(
      "https://collect.paga.com/paymentRequest",
    );
  });

  it("keeps an explicit scheme and strips trailing slashes and whitespace", () => {
    expect(normaliseUrl("X", " http://localhost:3001/ ")).toBe("http://localhost:3001");
    expect(normaliseUrl("X", "https://beta-collect.paga.com//")).toBe("https://beta-collect.paga.com");
  });

  it("leaves an empty value empty", () => {
    expect(normaliseUrl("PAGA_CALLBACK_URL", "  ")).toBe("");
  });

  it("refuses a value that still is not a URL", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => normaliseUrl("X", "not a url")).toThrow(/must be a URL/);
  });
});
