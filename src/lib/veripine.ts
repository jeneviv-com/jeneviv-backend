
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

interface VeripineData {
  firstname?: unknown;
  middlename?: unknown;
  surname?: unknown;
  lastname?: unknown;
  birthdate?: unknown;
  telephoneno?: unknown;
  photo?: unknown;
}

interface VeripineResponse {
  status?: unknown;
  message?: unknown;
  code?: unknown;
  data?: VeripineData;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : null;
}

function safeLogValue(
  value: unknown,
  nin: string,
): string | null {
  if (typeof value !== "string") return null;

  let safeValue = value;

  if (nin) {
    safeValue = safeValue
      .split(nin)
      .join("[REDACTED_NIN]");
  }

  if (env.VERIPINE_API_KEY) {
    safeValue = safeValue
      .split(env.VERIPINE_API_KEY)
      .join("[REDACTED_API_KEY]");
  }

  return safeValue.slice(0, 500);
}

export async function lookupNin(nin: string): Promise<NinIdentity> {
  if (!env.VERIPINE_API_KEY) {
    if (env.ALLOW_PROVIDER_MOCKS) {
      const fullName = env.KYC_MOCK_LEGAL_NAME.trim();
      const parts = fullName.split(/\s+/);

      return {
        firstName: parts[0] ?? "",
        middleName: parts.slice(1, -1).join(" "),
        lastName: parts.length > 1
          ? parts[parts.length - 1] ?? ""
          : "",
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

  const url = new URL(
    "/api/nin-verification",
    env.VERIPINE_BASE_URL,
  );

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
        nin,
        consent: true,
      }),
      signal: AbortSignal.timeout(30000),
    });
  } catch (error) {
    console.error("[Veripine] Network request failed", {
      errorName: error instanceof Error
        ? error.name
        : "UnknownError",
      errorMessage: safeLogValue(
        error instanceof Error
          ? error.message
          : "Unknown network error",
        nin,
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
      errorName: error instanceof Error
        ? error.name
        : "UnknownError",
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
    const providerMessage = safeLogValue(body.message, nin);

    console.error("[Veripine] Provider rejected NIN verification", {
      httpStatus: response.status,
      providerStatus: body.status,
      providerCode: body.code,
      providerMessage,
      contentType,
    });

    if (
      response.status === 404 ||
      body.code === 404 ||
      body.code === "404"
    ) {
      throw new HttpError(
        422,
        "nin_not_found",
        "No identity record was found for that NIN.",
      );
    }

    throw new HttpError(
      502,
      "kyc_failed",
      "Identity verification failed. Please try again.",
    );
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
    optionalString(entity.surname) ??
    optionalString(entity.lastname) ??
    "";

  const fullName = [
    firstName,
    middleName,
    lastName,
  ]
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
