import { env } from "../env.js";
import { HttpError } from "../middleware/error.js";

export interface NinIdentity {
  firstName: string;
  middleName: string;
  lastName: string;
  fullName: string;
  dateOfBirth: string | null;
  phoneNumber: string | null;
  photo: string | null;
  provider: "veripine" | "mock";
  raw: unknown;
}

export interface BvnIdentity {
  firstName: string;
  middleName: string;
  lastName: string;
  fullName: string;
  dateOfBirth: string | null;
  phoneNumber: string | null;
  gender: string | null;
  photo: string | null;
  provider: "veripine" | "mock";
  raw: unknown;
}

export interface VeripineBalance {
  balance: number;
  currency: string;
  raw: unknown;
}

interface VeripineEntityData {
  firstname?: unknown;
  middlename?: unknown;
  surname?: unknown;
  lastname?: unknown;
  birthdate?: unknown;
  telephoneno?: unknown;
  gender?: unknown;
  photo?: unknown;
  nin?: unknown;
  bvn?: unknown;
  [key: string]: unknown;
}

interface VeripineResponse {
  status?: unknown;
  message?: unknown;
  code?: unknown;
  reportID?: unknown;
  data?: VeripineEntityData;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Strips sensitive identifiers (NIN, BVN, API key) from log messages or error text
 * to guarantee no credentials or sensitive customer data are leaked.
 */
export function safeLogValue(value: unknown, sensitiveItems: string[] = []): string | null {
  if (typeof value !== "string") return null;

  let safeValue = value;

  for (const item of sensitiveItems) {
    if (item && item.trim()) {
      safeValue = safeValue.split(item).join("[REDACTED_SENSITIVE]");
    }
  }

  if (env.VERIPINE_API_KEY && env.VERIPINE_API_KEY.trim()) {
    safeValue = safeValue.split(env.VERIPINE_API_KEY).join("[REDACTED_API_KEY]");
  }

  return safeValue.slice(0, 500);
}

/**
 * Handles Veripine error responses and normalizes them into appropriate HttpError exceptions.
 */
function handleVeripineError(
  response: Response,
  body: VeripineResponse,
  identifierType: "NIN" | "BVN",
  identifierValue: string,
  contentType: string | null,
): never {
  const providerCode =
    typeof body.code === "number"
      ? body.code
      : typeof body.code === "string"
        ? parseInt(body.code, 10)
        : response.status;

  const providerMessage =
    typeof body.message === "string"
      ? safeLogValue(body.message, [identifierValue]) ?? ""
      : "";

  console.error(`[Veripine] Provider rejected ${identifierType} verification`, {
    httpStatus: response.status,
    providerStatus: body.status,
    providerCode,
    providerMessage,
    contentType,
  });

  if (/insufficient.*balance|balance.*insufficient/i.test(providerMessage)) {
    throw new HttpError(
      503,
      "kyc_provider_funding_required",
      "Veripine's API wallet has insufficient balance. Fund it and try again.",
    );
  }

  if (response.status === 401 || providerCode === 401) {
    throw new HttpError(
      503,
      "kyc_provider_auth_failed",
      "Veripine rejected the API key. Check VERIPINE_API_KEY.",
    );
  }

  if (response.status === 403 || providerCode === 403) {
    throw new HttpError(
      503,
      "kyc_provider_access_denied",
      "Veripine denied API access. Check that the account and API key are enabled.",
    );
  }

  if (response.status === 429 || providerCode === 429) {
    throw new HttpError(
      503,
      "kyc_provider_rate_limited",
      "Veripine's request limit was reached. Please try again later.",
    );
  }

  if (
    response.status === 404 ||
    providerCode === 404 ||
    /not found/i.test(providerMessage)
  ) {
    throw new HttpError(
      422,
      identifierType === "NIN" ? "nin_not_found" : "bvn_not_found",
      `No identity record was found for that ${identifierType}.`,
    );
  }

  if (providerCode === 400 || response.status === 400) {
    throw new HttpError(
      422,
      "kyc_provider_rejected",
      `Veripine rejected the verification request. Check the ${identifierType} and try again.`,
    );
  }

  throw new HttpError(
    502,
    "kyc_failed",
    typeof body.code === "number" || typeof body.code === "string"
      ? `Identity verification failed with provider error ${body.code}. Please try again later.`
      : "Identity verification failed. Please try again later.",
  );
}

/**
 * Verifies a National Identification Number (NIN) using Veripine's API.
 * Endpoint: POST /api/nin-verification
 * Documentation: https://veripine.com/documentation
 */
export async function lookupNin(nin: string): Promise<NinIdentity> {
  const sanitizedNin = nin.trim();

  if (!/^\d{11}$/.test(sanitizedNin)) {
    throw new HttpError(400, "invalid_nin", "NIN must be exactly 11 digits.");
  }

  if (!env.VERIPINE_API_KEY) {
    if (env.ALLOW_PROVIDER_MOCKS) {
      const fullName = env.KYC_MOCK_LEGAL_NAME.trim();
      const parts = fullName.split(/\s+/);
      return {
        firstName: parts[0] ?? "",
        middleName: parts.slice(1, -1).join(" "),
        lastName: parts.length > 1 ? (parts[parts.length - 1] ?? "") : "",
        fullName,
        dateOfBirth: null,
        phoneNumber: null,
        photo: null,
        provider: "mock",
        raw: { mock: true },
      };
    }
    throw new HttpError(
      503,
      "kyc_not_configured",
      "Identity verification is not configured. Set VERIPINE_API_KEY.",
    );
  }

  const url = new URL("/api/nin-verification", env.VERIPINE_BASE_URL);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": env.VERIPINE_API_KEY,
        Accept: "application/json",
      },
      body: JSON.stringify({
        nin: sanitizedNin,
        consent: true,
      }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    console.error("[Veripine] Network request failed for NIN", {
      errorName: error instanceof Error ? error.name : "UnknownError",
      errorMessage: safeLogValue(
        error instanceof Error ? error.message : "Unknown network error",
        [sanitizedNin],
      ),
    });
    throw new HttpError(
      502,
      "kyc_provider_unreachable",
      "Could not reach the identity provider. Please try again.",
    );
  }

  const contentType = response.headers.get("content-type");
  let responseText: string;
  try {
    responseText = await response.text();
  } catch (error) {
    console.error("[Veripine] Could not read provider response", {
      status: response.status,
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    throw new HttpError(
      502,
      "kyc_failed",
      "Could not read the identity provider response.",
    );
  }

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(responseText);
  } catch {
    console.error("[Veripine] Invalid JSON response", {
      status: response.status,
      contentType,
      responseLength: responseText.length,
    });
    throw new HttpError(
      502,
      "kyc_failed",
      "Identity verification returned an invalid response. Please try again.",
    );
  }

  if (!isRecord(parsedBody)) {
    console.error("[Veripine] Unexpected response format", {
      status: response.status,
      contentType,
    });
    throw new HttpError(
      502,
      "kyc_failed",
      "Identity verification returned an invalid response. Please try again.",
    );
  }

  const body = parsedBody as VeripineResponse;
  if (!response.ok || body.status !== "success") {
    handleVeripineError(response, body, "NIN", sanitizedNin, contentType);
  }

  if (!isRecord(body.data)) {
    console.error("[Veripine] Successful response has no identity data", {
      httpStatus: response.status,
      providerStatus: body.status,
    });
    throw new HttpError(
      502,
      "kyc_incomplete",
      "The identity provider returned incomplete identity data.",
    );
  }

  const entity = body.data;
  const firstName = optionalString(entity.firstname) ?? "";
  const middleName = optionalString(entity.middlename) ?? "";
  const lastName =
    optionalString(entity.surname) ?? optionalString(entity.lastname) ?? "";
  const fullName = [firstName, middleName, lastName]
    .filter(Boolean)
    .join(" ")
    .trim();

  if (!fullName) {
    console.error("[Veripine] Identity response contains no usable name", {
      httpStatus: response.status,
    });
    throw new HttpError(
      502,
      "kyc_incomplete",
      "The identity provider returned no name for that NIN.",
    );
  }

  return {
    firstName,
    middleName,
    lastName,
    fullName,
    dateOfBirth: optionalString(entity.birthdate),
    phoneNumber: optionalString(entity.telephoneno),
    photo: optionalString(entity.photo),
    provider: "veripine",
    raw: body,
  };
}

/**
 * Verifies a Bank Verification Number (BVN) using Veripine's API.
 * Endpoint: POST /api/bvn-verification
 * Documentation: https://veripine.com/documentation
 */
export async function lookupBvn(bvn: string): Promise<BvnIdentity> {
  const sanitizedBvn = bvn.trim();

  if (!/^\d{11}$/.test(sanitizedBvn)) {
    throw new HttpError(400, "invalid_bvn", "BVN must be exactly 11 digits.");
  }

  if (!env.VERIPINE_API_KEY) {
    if (env.ALLOW_PROVIDER_MOCKS) {
      const fullName = env.KYC_MOCK_LEGAL_NAME.trim();
      const parts = fullName.split(/\s+/);
      return {
        firstName: parts[0] ?? "",
        middleName: parts.slice(1, -1).join(" "),
        lastName: parts.length > 1 ? (parts[parts.length - 1] ?? "") : "",
        fullName,
        dateOfBirth: null,
        phoneNumber: null,
        gender: null,
        photo: null,
        provider: "mock",
        raw: { mock: true },
      };
    }
    throw new HttpError(
      503,
      "kyc_not_configured",
      "Identity verification is not configured. Set VERIPINE_API_KEY.",
    );
  }

  const url = new URL("/api/bvn-verification", env.VERIPINE_BASE_URL);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": env.VERIPINE_API_KEY,
        Accept: "application/json",
      },
      body: JSON.stringify({
        bvn: sanitizedBvn,
        consent: true,
      }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    console.error("[Veripine] Network request failed for BVN", {
      errorName: error instanceof Error ? error.name : "UnknownError",
      errorMessage: safeLogValue(
        error instanceof Error ? error.message : "Unknown network error",
        [sanitizedBvn],
      ),
    });
    throw new HttpError(
      502,
      "kyc_provider_unreachable",
      "Could not reach the identity provider. Please try again.",
    );
  }

  const contentType = response.headers.get("content-type");
  let responseText: string;
  try {
    responseText = await response.text();
  } catch (error) {
    console.error("[Veripine] Could not read provider response", {
      status: response.status,
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    throw new HttpError(
      502,
      "kyc_failed",
      "Could not read the identity provider response.",
    );
  }

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(responseText);
  } catch {
    console.error("[Veripine] Invalid JSON response", {
      status: response.status,
      contentType,
      responseLength: responseText.length,
    });
    throw new HttpError(
      502,
      "kyc_failed",
      "Identity verification returned an invalid response. Please try again.",
    );
  }

  if (!isRecord(parsedBody)) {
    console.error("[Veripine] Unexpected response format", {
      status: response.status,
      contentType,
    });
    throw new HttpError(
      502,
      "kyc_failed",
      "Identity verification returned an invalid response. Please try again.",
    );
  }

  const body = parsedBody as VeripineResponse;
  if (!response.ok || body.status !== "success") {
    handleVeripineError(response, body, "BVN", sanitizedBvn, contentType);
  }

  if (!isRecord(body.data)) {
    console.error("[Veripine] Successful response has no identity data", {
      httpStatus: response.status,
      providerStatus: body.status,
    });
    throw new HttpError(
      502,
      "kyc_incomplete",
      "The identity provider returned incomplete identity data.",
    );
  }

  const entity = body.data;
  const firstName = optionalString(entity.firstname) ?? "";
  const middleName = optionalString(entity.middlename) ?? "";
  const lastName =
    optionalString(entity.surname) ?? optionalString(entity.lastname) ?? "";
  const fullName = [firstName, middleName, lastName]
    .filter(Boolean)
    .join(" ")
    .trim();

  if (!fullName) {
    console.error("[Veripine] Identity response contains no usable name", {
      httpStatus: response.status,
    });
    throw new HttpError(
      502,
      "kyc_incomplete",
      "The identity provider returned no name for that BVN.",
    );
  }

  return {
    firstName,
    middleName,
    lastName,
    fullName,
    dateOfBirth: optionalString(entity.birthdate),
    phoneNumber: optionalString(entity.telephoneno),
    gender: optionalString(entity.gender),
    photo: optionalString(entity.photo),
    provider: "veripine",
    raw: body,
  };
}

/**
 * Queries the Veripine account balance.
 * Endpoint: GET /api/balance
 * Documentation: https://veripine.com/documentation
 */
export async function getVeripineBalance(): Promise<VeripineBalance> {
  if (!env.VERIPINE_API_KEY) {
    if (env.ALLOW_PROVIDER_MOCKS) {
      return {
        balance: 100000,
        currency: "NGN",
        raw: { mock: true },
      };
    }
    throw new HttpError(
      503,
      "kyc_not_configured",
      "Identity verification is not configured. Set VERIPINE_API_KEY.",
    );
  }

  const url = new URL("/api/balance", env.VERIPINE_BASE_URL);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: {
        "x-api-key": env.VERIPINE_API_KEY,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    console.error("[Veripine] Balance query failed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    throw new HttpError(
      502,
      "kyc_provider_unreachable",
      "Could not reach Veripine balance endpoint.",
    );
  }

  let parsedBody: unknown;
  try {
    parsedBody = await response.json();
  } catch {
    throw new HttpError(
      502,
      "kyc_failed",
      "Veripine balance returned an invalid response.",
    );
  }

  const envelope = (parsedBody ?? {}) as Record<string, unknown>;
  const data = (envelope.data ?? envelope) as Record<string, unknown>;
  const balanceRaw = data.balance ?? envelope.balance ?? 0;
  const balance = typeof balanceRaw === "number" ? balanceRaw : parseFloat(String(balanceRaw)) || 0;
  const currency = typeof data.currency === "string" ? data.currency : "NGN";

  return {
    balance,
    currency,
    raw: parsedBody,
  };
}
