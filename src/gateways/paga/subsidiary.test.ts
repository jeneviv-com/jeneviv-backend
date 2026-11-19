import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../env.js", () => ({
  env: {
    PAGA_PUBLIC_KEY: "pub",
    PAGA_SECRET_KEY: "sec",
    PAGA_HASH_KEY: "hashkey",
    PAGA_BASE_URL: "https://beta-collect.paga.com",
    PAGA_CALLBACK_URL: "https://api.example.com/api/webhooks/paga",
    PAGA_PAYEE_NAME: "Jeneviv",
    PAGA_PAYMENT_METHODS: ["BANK_TRANSFER"],
    PAGA_COLLECT_MODE: "subsidiary",
    BETTER_AUTH_URL: "https://api.example.com",
    APP_PUBLIC_URL: "https://app.example.com",
  },
}));

import { pagaAdapter } from "./adapter.js";
import { getPagaEventId, isPagaFundingNotification } from "./webhook.js";

const args = {
  reference: "txnABCDEFGHIJKLMNO", // 18 chars
  customerId: "",
  customerName: "Ada Obi",
  customerEmail: "ada@example.com",
  customerPhone: "08012345678",
  amount: 17500,
  currency: "NGN",
  narration: "School - Dues",
  expirySeconds: 1200,
  platformFeeMinor: 7500,
};

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("Paga subsidiary accounts", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("creates an auto-swept subsidiary account named by our reference", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      json({
        statusCode: "0",
        statusMessage: "success",
        accountNumber: "0750529406",
        accountReference: args.reference,
        status: "ACTIVE",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await pagaAdapter.createVirtualAccount(args);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://beta-collect.paga.com/subsidiary-accounts");
    expect(init.method).toBe("POST");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      accountReference: args.reference,
      firstName: "Ada",
      lastName: "Obi",
      phoneNumber: "08012345678",
      email: "ada@example.com",
      autoSweep: { destination: "VIRTUAL_ACCOUNT" },
      callbackUrl: "https://api.example.com/api/webhooks/paga",
    });
    // referenceNumber + accountReference + iifiNumber + bankPublicId + destination + accountNumber + callbackUrl + key
    const expected = createHash("sha512")
      .update(
        `${body.referenceNumber}${args.reference}VIRTUAL_ACCOUNThttps://api.example.com/api/webhooks/pagahashkey`,
      )
      .digest("hex");
    expect((init.headers as Record<string, string>).hash).toBe(expected);
    expect(result).toMatchObject({
      accountNumber: "0750529406",
      bankName: "Paga",
      gatewayAccountId: args.reference,
      totalCharged: 17500,
    });
  });

  it("confirms payment from the account's CREDIT history", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      json({
        statusCode: "0",
        transactions: [
          { transactionType: "CREDIT", amount: 175, status: "SUCCESSFUL" },
          { transactionType: "DEBIT", amount: 175, status: "SUCCESSFUL" },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const verified = await pagaAdapter.verifyPayment!(args.reference);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
    expect(url).toContain(`/subsidiary-accounts/${args.reference}/history?`);
    const query = new URL(url).searchParams;
    const expected = createHash("sha512")
      .update(`${args.reference}${query.get("startDateTimeUTC")}${query.get("endDateTimeUTC")}hashkey`)
      .digest("hex");
    expect((init.headers as Record<string, string>).hash).toBe(expected);
    expect(verified).toMatchObject({ status: "success", amountPaidMinor: 17500 });
  });

  it("recognises a funding notification and keys it by transaction", () => {
    const payload = {
      statusCode: "0",
      transactionReference: "MPVAT-P_1",
      accountNumber: "0750529406",
      amount: 175,
      transactionDate: "2026-11-19T12:00:00.000",
    };
    expect(isPagaFundingNotification(payload)).toBe(true);
    expect(getPagaEventId(payload)).toBe("funding:MPVAT-P_1");
    expect(isPagaFundingNotification({ externalReferenceNumber: "x", ...payload })).toBe(false);
  });
});
