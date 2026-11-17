import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../env.js", () => ({
  env: {
    PAGA_PUBLIC_KEY: "pub",
    PAGA_SECRET_KEY: "sec",
    PAGA_HASH_KEY: "hashkey",
    PAGA_BASE_URL: "https://collect.paga.com",
    PAGA_CALLBACK_URL: "https://api.example.com/api/webhooks/paga",
    PAGA_PAYEE_NAME: "Jeneviv",
    BETTER_AUTH_URL: "https://api.example.com",
    APP_PUBLIC_URL: "https://app.example.com",
  },
}));

import { pagaAdapter } from "./adapter.js";

function okResponse() {
  return new Response(
    JSON.stringify({
      statusCode: "0",
      statusMessage: "success",
      referenceNumber: "ref1",
      totalPaymentAmount: 5100,
      paymentMethods: [
        {
          name: "BANK_TRANSFER",
          properties: { AccountNumber: "0123456789", bankName: "Paga", accountName: "Jeneviv" },
        },
      ],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

const baseArgs = {
  reference: "ref1",
  customerId: "",
  customerName: "Ada Obi",
  amount: 500000,
  currency: "NGN",
  narration: "School - Dues",
  expirySeconds: 1200,
  platformFeeMinor: 7500,
};

describe("pagaAdapter.createVirtualAccount", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends the required payee and a hash in Paga's documented order", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal("fetch", fetchMock);

    const result = await pagaAdapter.createVirtualAccount({
      ...baseArgs,
      customerEmail: "ada@example.com",
      customerPhone: "08012345678",
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://collect.paga.com/paymentRequest");
    const body = JSON.parse(String(init.body));
    expect(body.payee).toEqual({ name: "Jeneviv" });
    expect(body.payer).toEqual({ name: "Ada Obi", phoneNumber: "08012345678", email: "ada@example.com" });

    const expected = createHash("sha512")
      .update(`ref1${body.amount}NGN08012345678ada@example.comhashkey`)
      .digest("hex");
    expect((init.headers as Record<string, string>).hash).toBe(expected);
    expect(result.accountNumber).toBe("0123456789");
  });

  it("omits a blank phone instead of sending an empty string", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal("fetch", fetchMock);

    await pagaAdapter.createVirtualAccount({ ...baseArgs, customerEmail: "ada@example.com" });

    const body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body));
    expect(body.payer).toEqual({ name: "Ada Obi", email: "ada@example.com" });
    expect("phoneNumber" in body.payer).toBe(false);
  });

  it("refuses to call Paga with neither phone nor email", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(pagaAdapter.createVirtualAccount({ ...baseArgs })).rejects.toThrow(/phone number or email/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
