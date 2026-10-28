import { beforeAll, describe, expect, it } from "vitest";

// fees.ts imports env.ts, which requires these application settings even though
// these unit tests do not connect to the database or an auth provider.
process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:5432/jeneviv_test";
process.env.BETTER_AUTH_SECRET ??= "unit-test-only-secret";
process.env.PLATFORM_FEE_NGN ??= "75";

let platformFeeNgn: (amount: number) => number;
let computeCharge: (amount: number, gateway: "paystack" | "other") => {
  amount: number;
  platformFee: number;
  gatewayFee: number;
  total: number;
};

beforeAll(async () => {
  ({ platformFeeNgn, computeCharge } = await import("./fees.js"));
});

describe("platformFeeNgn", () => {
  it.each([
    [350, 75],
    [7_500, 75],
    [7_501, 75],
    [10_000, 100],
    [200_000, 1_000],
  ])("charges ₦%s → ₦%s", (collectionAmount, expectedFee) => {
    expect(platformFeeNgn(collectionAmount)).toBe(expectedFee);
  });
});

describe("computeCharge", () => {
  it("keeps non-Paystack charges free of a gateway fee", () => {
    expect(computeCharge(350, "other")).toEqual({
      amount: 350,
      platformFee: 75,
      gatewayFee: 0,
      total: 425,
    });
  });

  it("adds the configured Paystack gateway fee to the payer total", () => {
    expect(computeCharge(200, "paystack")).toEqual({
      amount: 200,
      platformFee: 75,
      gatewayFee: 5,
      total: 280,
    });
  });
});