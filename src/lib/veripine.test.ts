import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../env.js", () => ({
  env: {
    VERIPINE_API_KEY: "test-veripine-key",
    VERIPINE_BASE_URL: "https://veripine.com",
    ALLOW_PROVIDER_MOCKS: false,
    KYC_MOCK_LEGAL_NAME: "Test Merchant",
  },
}));

import { lookupNin } from "./veripine.js";

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
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const identity = await lookupNin("12345678901");

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe(
      "https://veripine.com/api/nin-verification",
    );
    expect(init).toMatchObject({
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": "test-veripine-key",
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

  it("rejects unsuccessful or malformed provider responses", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "error",
          message: "Insufficient wallet balance",
          code: 400,
        }),
        { status: 400 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(lookupNin("12345678901")).rejects.toMatchObject({
      status: 502,
      code: "kyc_failed",
    });
  });
});
