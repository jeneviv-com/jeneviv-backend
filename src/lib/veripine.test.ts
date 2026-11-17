import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../env.js", () => ({
  env: {
    VERIPINE_API_KEY: "test-veripine-key-12345",
    VERIPINE_BASE_URL: "https://veripine.com",
    ALLOW_PROVIDER_MOCKS: false,
    KYC_MOCK_LEGAL_NAME: "Test Merchant",
  },
}));

import { lookupNin, lookupBvn, getVeripineBalance, safeLogValue } from "./veripine.js";

describe("Veripine NIN lookup", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the consented NIN request and maps Veripine identity fields", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "success",
          reportID: "NIN_123",
          message: "NIN Verified Successfully",
          data: {
            firstname: "JOHN",
            middlename: "OLUMIDE",
            surname: "ADEBAYO",
            telephoneno: "08012345678",
            birthdate: "1990-05-15",
            photo: "data:image/jpeg;base64,abc",
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const identity = await lookupNin("12345678901");

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe("https://veripine.com/api/nin-verification");
    expect(init).toMatchObject({
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": "test-veripine-key-12345",
        Accept: "application/json",
      },
      body: JSON.stringify({ nin: "12345678901", consent: true }),
    });
    expect(identity).toMatchObject({
      firstName: "JOHN",
      middleName: "OLUMIDE",
      lastName: "ADEBAYO",
      fullName: "JOHN OLUMIDE ADEBAYO",
      dateOfBirth: "1990-05-15",
      phoneNumber: "08012345678",
      photo: "data:image/jpeg;base64,abc",
      provider: "veripine",
    });
  });

  it("validates that NIN is exactly 11 digits", async () => {
    await expect(lookupNin("123")).rejects.toMatchObject({
      status: 400,
      code: "invalid_nin",
    });
    await expect(lookupNin("abcdefghijk")).rejects.toMatchObject({
      status: 400,
      code: "invalid_nin",
    });
  });

  it("explains an insufficient Veripine wallet balance", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "error",
          message: "Insufficient wallet balance",
          code: 400,
        }),
        { status: 400, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(lookupNin("12345678901")).rejects.toMatchObject({
      status: 503,
      code: "kyc_provider_funding_required",
      message:
        "Veripine's API wallet has insufficient balance. Fund it and try again.",
    });
  });

  it("explains when Veripine rejects the configured API key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "error",
          message: "Invalid API key",
          code: 401,
        }),
        { status: 401, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(lookupNin("12345678901")).rejects.toMatchObject({
      status: 503,
      code: "kyc_provider_auth_failed",
      message: "Veripine rejected the API key. Check VERIPINE_API_KEY.",
    });
  });

  it("handles 404 when record is not found", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "error",
          message: "No record found for the provided NIN",
          code: 404,
        }),
        { status: 404, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(lookupNin("12345678901")).rejects.toMatchObject({
      status: 422,
      code: "nin_not_found",
      message: "No identity record was found for that NIN.",
    });
  });
});

describe("Veripine BVN lookup", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the consented BVN request and maps Veripine identity fields", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "success",
          reportID: "BVN_456",
          message: "ID Verified Successfully",
          data: {
            firstname: "MARY",
            middlename: "CHIOMA",
            surname: "OKONKWO",
            gender: "FEMALE",
            birthdate: "1995-08-20",
            telephoneno: "08098765432",
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const identity = await lookupBvn("22222222222");

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe("https://veripine.com/api/bvn-verification");
    expect(init).toMatchObject({
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": "test-veripine-key-12345",
        Accept: "application/json",
      },
      body: JSON.stringify({ bvn: "22222222222", consent: true }),
    });
    expect(identity).toMatchObject({
      firstName: "MARY",
      middleName: "CHIOMA",
      lastName: "OKONKWO",
      fullName: "MARY CHIOMA OKONKWO",
      dateOfBirth: "1995-08-20",
      phoneNumber: "08098765432",
      gender: "FEMALE",
      provider: "veripine",
    });
  });

  it("validates that BVN is exactly 11 digits", async () => {
    await expect(lookupBvn("1234")).rejects.toMatchObject({
      status: 400,
      code: "invalid_bvn",
    });
  });

  it("handles BVN not found", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "error",
          message: "BVN record not found",
          code: 404,
        }),
        { status: 404, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(lookupBvn("22222222222")).rejects.toMatchObject({
      status: 422,
      code: "bvn_not_found",
    });
  });
});

describe("Veripine Balance & Redaction", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("queries the wallet balance successfully", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "success",
          data: {
            balance: 15400.5,
            currency: "NGN",
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const balance = await getVeripineBalance();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(balance.balance).toBe(15400.5);
    expect(balance.currency).toBe("NGN");
  });

  it("redacts sensitive data and API keys in safeLogValue", () => {
    const rawMsg = "Error verifying NIN 12345678901 with key test-veripine-key-12345";
    const safe = safeLogValue(rawMsg, ["12345678901"]);
    expect(safe).not.toContain("12345678901");
    expect(safe).not.toContain("test-veripine-key-12345");
    expect(safe).toContain("[REDACTED_SENSITIVE]");
    expect(safe).toContain("[REDACTED_API_KEY]");
  });
});
